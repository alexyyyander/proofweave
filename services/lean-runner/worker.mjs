import { D1InlineRunnerBundleResolver } from "./d1-inline-runner-bundle-resolver.mjs";
import { D1InlineRunnerOutputStore } from "./d1-inline-runner-output-store.mjs";
import { D1RunStore } from "./d1-run-store.mjs";
import { RunnerContainerExecutionClient } from "./runner-container-execution-client.mjs";
import { RunnerExecutionFinalizer } from "./runner-execution-finalizer.mjs";
import { RunnerExecutionResultSigner } from "./runner-execution-result-signer.mjs";
import { D1InlineVerificationReplayEvidenceStore } from "../verification/d1-inline-verification-replay-evidence-store.mjs";
import { PinnedRunnerImageRegistry } from "./runner-image-policy.mjs";
import { RunnerJobPreflight } from "./runner-job-preflight.mjs";
import { RunnerWorkspaceStager } from "./runner-workspace-stager.mjs";
import { RunnerWorkspaceTransfer } from "./runner-workspace-transfer.mjs";
import { D1InlineArtifactBucket } from "../artifacts/d1-inline-artifact-store.mjs";
import { consumeCloudflareRunnerBatch } from "./cloudflare-queues.mjs";
import { RunnerJobAuthenticator } from "./queue.mjs";
import {
  createStructuredQueueAudit,
  emitStructuredConsole,
} from "../../packages/observability/structured-audit.mjs";

export class RunnerWorkerConfigurationError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RunnerWorkerConfigurationError";
  }
}

/**
 * Private Cloudflare Queue consumer for the Lean Runner. There is deliberately
 * no public control endpoint: a signed queue envelope is the only path that
 * can reach the Container. Every queue delivery is re-authenticated, bound to
 * its D1 Run, staged into the named private Container, and finalized only
 * after stdout/stderr persistence and Worker-held result signing succeed.
 */
export function createLeanRunnerWorker({
  now = () => new Date(),
  createRuntime = createRunnerRuntime,
  audit = null,
} = {}) {
  if (typeof now !== "function") throw new TypeError("Lean Runner Worker requires a clock function.");
  if (typeof createRuntime !== "function") throw new TypeError("Lean Runner Worker requires a runtime factory.");
  if (audit !== null && typeof audit.handle !== "function") {
    throw new TypeError("Lean Runner Worker audit boundary must expose handle().");
  }
  return Object.freeze({
    async fetch() {
      return new Response("Not found", { status: 404 });
    },
    async queue(batch, env) {
      const executeBatch = async () => {
        const runtime = await createRuntime({ env, now });
        return consumeCloudflareRunnerBatch({
          batch,
          authenticator: runtime.authenticator,
          execute: runtime.execute,
          retryDelaySeconds: runtime.retryDelaySeconds,
        });
      };
      if (!audit) return executeBatch();
      return audit.handle({
        delivered: Array.isArray(batch?.messages) ? batch.messages.length : 0,
        handler: executeBatch,
      });
    },
  });
}

/** Build short-lived, request-local control-plane adapters from Worker bindings. */
export async function createRunnerRuntime({
  env,
  now = () => new Date(),
  getContainerForRun = (runId) => getNamedContainer(env, runId),
}) {
  requireExecutionEnabled(env);
  requireEnvironment(env);
  if (typeof now !== "function") throw new TypeError("Lean Runner runtime requires a clock function.");
  if (typeof getContainerForRun !== "function") throw new TypeError("Lean Runner runtime requires a Container resolver.");

  const imageRegistry = new PinnedRunnerImageRegistry({
    images: parseJsonSetting(env, "RUNNER_APPROVED_IMAGES_JSON"),
  });
  const authenticator = new RunnerJobAuthenticator({
    issuerKeys: parseJsonSetting(env, "RUNNER_CONTROL_PLANE_ISSUER_KEYS_JSON"),
  });
  const runStore = new D1RunStore(env.DB);
  const artifactBucket = new D1InlineArtifactBucket(env.DB);
  const preflight = new RunnerJobPreflight({
    runStore,
    bundleResolver: new D1InlineRunnerBundleResolver({ database: env.DB }),
    imageRegistry,
  });
  const workspaceStager = new RunnerWorkspaceStager({
    preflight,
    workspaceTransfer: new RunnerWorkspaceTransfer({ bucket: artifactBucket }),
    getContainer: getContainerForRun,
  });
  const finalizer = new RunnerExecutionFinalizer({
    runStore,
    outputStore: new D1InlineRunnerOutputStore({ database: env.DB }),
    replayEvidenceStore: new D1InlineVerificationReplayEvidenceStore({ database: env.DB }),
    resultSigner: new RunnerExecutionResultSigner({
      runnerKeyId: requireSetting(env, "RUNNER_RESULT_KEY_ID"),
      runnerPrivateKey: await importRunnerResultPrivateKey(requireSetting(env, "RUNNER_RESULT_PRIVATE_KEY_JWK")),
    }),
  });
  return Object.freeze({
    authenticator,
    retryDelaySeconds: optionalRetryDelay(env.RUNNER_RETRY_DELAY_SECONDS),
    execute: createRunnerQueueExecution({
      workspaceStager,
      imageRegistry,
      getContainerForRun,
      executionClient: new RunnerContainerExecutionClient(),
      finalizer,
      isCancellationRequested: async (runId) => (await runStore.find(runId))?.state === "cancel_requested",
      now,
    }),
  });
}

/**
 * Complete one authenticated queue message. A retry that arrives after the
 * workspace has already reached `running` resumes only the private execution
 * and finalization phase; it never creates a second Run or replays a terminal
 * result. While a private execution is active, the Worker polls its durable
 * control-plane state and forwards a cancellation request only to that same
 * named Container. A cancel-requested Run is never restarted by a retry.
 */
export function createRunnerQueueExecution({
  workspaceStager,
  imageRegistry,
  getContainerForRun,
  executionClient,
  finalizer,
  isCancellationRequested = async () => false,
  cancellationPollMilliseconds = 1_000,
  sleep = wait,
  now = () => new Date(),
}) {
  if (!workspaceStager || typeof workspaceStager.executeAuthenticatedMessage !== "function") {
    throw new TypeError("Runner queue execution requires a RunnerWorkspaceStager.");
  }
  if (!imageRegistry || typeof imageRegistry.resolve !== "function") {
    throw new TypeError("Runner queue execution requires an approved image registry.");
  }
  if (typeof getContainerForRun !== "function") {
    throw new TypeError("Runner queue execution requires a private Container resolver.");
  }
  if (!executionClient || typeof executionClient.execute !== "function" || typeof executionClient.cancel !== "function") {
    throw new TypeError("Runner queue execution requires a private execution client.");
  }
  if (!finalizer || typeof finalizer.finalize !== "function") {
    throw new TypeError("Runner queue execution requires a result finalizer.");
  }
  if (typeof isCancellationRequested !== "function") {
    throw new TypeError("Runner queue execution requires a durable cancellation-state reader.");
  }
  if (!Number.isInteger(cancellationPollMilliseconds) || cancellationPollMilliseconds < 50 || cancellationPollMilliseconds > 60_000) {
    throw new TypeError("Runner cancellation polling must be an integer between 50 and 60000 milliseconds.");
  }
  if (typeof sleep !== "function") throw new TypeError("Runner queue execution requires a sleep function.");
  if (typeof now !== "function") throw new TypeError("Runner queue execution requires a clock function.");

  return async function executeAuthenticatedMessage(message, { beforeFinalize = async () => {} } = {}) {
    if (typeof beforeFinalize !== "function") {
      throw new TypeError("Runner queue execution beforeFinalize boundary must be a function.");
    }
    const staged = await workspaceStager.executeAuthenticatedMessage(message, {
      preparingAt: timestamp(now),
      startedAt: timestamp(now),
    });
    if (staged.action === "skip") {
      if (staged.run?.state !== "running") {
        return Object.freeze({ action: "skip", run: staged.run, reason: staged.reason });
      }
      // The previous delivery completed staging and entered running but did not
      // durably finalize. Re-validate the current image allowlist before using
      // the same named private Container to resume that one Run.
      imageRegistry.resolve(message.request);
      return executeAndFinalize({
        run: staged.run,
        message,
        getContainerForRun,
        executionClient,
        finalizer,
        isCancellationRequested,
        cancellationPollMilliseconds,
        sleep,
        now,
        beforeFinalize,
      });
    }
    if (staged.action !== "execute") {
      throw new RunnerWorkerConfigurationError("Runner workspace stager returned an unsupported action.");
    }
    return executeAndFinalize({
      run: staged.run,
      message: staged.message,
      getContainerForRun,
      executionClient,
      finalizer,
      isCancellationRequested,
      cancellationPollMilliseconds,
      sleep,
      now,
      beforeFinalize,
    });
  };
}

async function executeAndFinalize({
  run,
  message,
  getContainerForRun,
  executionClient,
  finalizer,
  isCancellationRequested,
  cancellationPollMilliseconds,
  sleep,
  now,
  beforeFinalize,
}) {
  const container = await getContainerForRun(run.id);
  if (!container || typeof container.fetch !== "function") {
    throw new RunnerWorkerConfigurationError("Runner Container resolver returned no private fetch stub.");
  }
  const cancellation = createCancellationForwarder({
    runId: run.id,
    isCancellationRequested,
    forward: () => executionClient.cancel({ container, run }),
    pollMilliseconds: cancellationPollMilliseconds,
    sleep,
  });
  let execution;
  try {
    execution = await executionClient.execute({ container, run, request: message.request });
  } catch (cause) {
    // Preserve the primary execution error. The Queue will retry it; an
    // incidental failure while stopping the background state poll must not
    // replace the evidence/transport failure that triggered the retry.
    await cancellation.stop().catch(() => {});
    throw cause;
  }
  // Surface a control-plane or private-cancel failure before finalizing a
  // result. This leaves the Run active and makes Queue retry semantics safe.
  await cancellation.stop();
  // Provider-neutral lease runners fence stale workers here, after private
  // execution/output retrieval but before operator signing or durable result
  // persistence. Cloudflare's binding can retain the default no-op because
  // its Queue delivery acknowledgement owns that provider's retry boundary.
  await beforeFinalize();
  return finalizer.finalize({ runId: run.id, execution, receivedAt: timestamp(now) });
}

/**
 * Poll D1 only while a Container execution is in flight. `stop()` interrupts
 * the wait rather than delaying result finalization by one poll interval.
 */
function createCancellationForwarder({ runId, isCancellationRequested, forward, pollMilliseconds, sleep }) {
  let stopped = false;
  let wake;
  const wakeSignal = new Promise((resolve) => { wake = resolve; });
  const forwarding = (async () => {
    while (!stopped) {
      if (await isCancellationRequested(runId)) {
        if (!stopped) await forward();
        return;
      }
      await Promise.race([sleep(pollMilliseconds), wakeSignal]);
    }
  })();
  return Object.freeze({
    async stop() {
      stopped = true;
      wake();
      await forwarding;
    },
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getNamedContainer(env, runId) {
  if (!env?.LEAN_RUNNER_CONTAINER || typeof env.LEAN_RUNNER_CONTAINER.getByName !== "function") {
    throw new RunnerWorkerConfigurationError("Runner Worker requires a LEAN_RUNNER_CONTAINER binding.");
  }
  return env.LEAN_RUNNER_CONTAINER.getByName(runId);
}

export async function importRunnerResultPrivateKey(serialized) {
  let jwk;
  try {
    jwk = JSON.parse(serialized);
  } catch (cause) {
    throw new RunnerWorkerConfigurationError("RUNNER_RESULT_PRIVATE_KEY_JWK must be valid JSON.", { cause });
  }
  if (!jwk || typeof jwk !== "object" || Array.isArray(jwk) || jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.d !== "string") {
    throw new RunnerWorkerConfigurationError("RUNNER_RESULT_PRIVATE_KEY_JWK must be an Ed25519 private JWK.");
  }
  try {
    return await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
  } catch (cause) {
    throw new RunnerWorkerConfigurationError("RUNNER_RESULT_PRIVATE_KEY_JWK could not be imported for signing.", { cause });
  }
}

function requireEnvironment(env) {
  if (!env || typeof env !== "object" || !env.DB || !env.LEAN_RUNNER_CONTAINER) {
    throw new RunnerWorkerConfigurationError("Runner Worker requires DB and LEAN_RUNNER_CONTAINER bindings.");
  }
}

/**
 * Deployment-owned kill switch. A valid Queue message and all other runtime
 * bindings are insufficient until an operator explicitly enables execution.
 */
function requireExecutionEnabled(env) {
  if (env?.RUNNER_EXECUTION_ENABLED !== "true") {
    throw new RunnerWorkerConfigurationError("Runner Worker requires RUNNER_EXECUTION_ENABLED=true before it can execute Queue deliveries.");
  }
}

function parseJsonSetting(env, key) {
  try {
    return JSON.parse(requireSetting(env, key));
  } catch (cause) {
    if (cause instanceof RunnerWorkerConfigurationError) throw cause;
    throw new RunnerWorkerConfigurationError(`${key} must contain valid JSON.`, { cause });
  }
}

function requireSetting(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new RunnerWorkerConfigurationError(`Runner Worker requires ${key}.`);
  }
  return value;
}

function optionalRetryDelay(value) {
  if (value === undefined || value === null || value === "") return 30;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new RunnerWorkerConfigurationError("RUNNER_RETRY_DELAY_SECONDS must be an integer between 1 and 86400.");
  }
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 86_400) {
    throw new RunnerWorkerConfigurationError("RUNNER_RETRY_DELAY_SECONDS must be an integer between 1 and 86400.");
  }
  return seconds;
}

function timestamp(now) {
  const value = now();
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) throw new RunnerWorkerConfigurationError("Runner Worker clock returned an invalid instant.");
  return instant.toISOString();
}

export default createLeanRunnerWorker({
  audit: createStructuredQueueAudit({
    component: "lean_runner_queue",
    emit: emitStructuredConsole,
  }),
});
