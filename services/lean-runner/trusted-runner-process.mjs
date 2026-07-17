import { createRemoteLibsqlD1Database } from "../database/libsql-d1-adapter.mjs";
import { D1InlineArtifactBucket } from "../artifacts/d1-inline-artifact-store.mjs";
import { D1InlineVerificationReplayEvidenceStore } from "../verification/d1-inline-verification-replay-evidence-store.mjs";
import { D1InlineRunnerBundleResolver } from "./d1-inline-runner-bundle-resolver.mjs";
import { D1InlineRunnerOutputStore } from "./d1-inline-runner-output-store.mjs";
import { D1RunnerLeaseQueue } from "./d1-runner-lease-queue.mjs";
import { D1RunStore } from "./d1-run-store.mjs";
import { createE2BSandboxContainerFactoryFromEnvironment } from "./e2b-sandbox-container.mjs";
import { createModalSandboxContainerFactoryFromEnvironment } from "./modal-sandbox-container.mjs";
import { PinnedRunnerImageRegistry } from "./runner-image-policy.mjs";
import { RunnerContainerExecutionClient } from "./runner-container-execution-client.mjs";
import { RunnerExecutionFinalizer } from "./runner-execution-finalizer.mjs";
import { RunnerExecutionResultSigner } from "./runner-execution-result-signer.mjs";
import { RunnerJobPreflight } from "./runner-job-preflight.mjs";
import {
  RunnerJobAuthenticationError,
  RunnerJobAuthenticator,
  RunnerQueueProtocolError,
} from "./queue.mjs";
import { RunnerWorkspaceStager } from "./runner-workspace-stager.mjs";
import { RunnerWorkspaceTransfer } from "./runner-workspace-transfer.mjs";
import {
  createRunnerQueueExecution,
  importRunnerResultPrivateKey,
} from "./worker.mjs";

export class TrustedRunnerProcessConfigurationError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "TrustedRunnerProcessConfigurationError";
  }
}

/**
 * Poll one durable lease at a time and execute it through an authenticated
 * private Sandbox. This process owns database, provider, and result-signing
 * credentials; the Sandbox receives none of them.
 */
export class TrustedRunnerProcess {
  constructor({
    queue,
    authenticator,
    execute,
    consumerId,
    leaseDurationSeconds = 300,
    heartbeatSeconds = 60,
    retryDelaySeconds = 30,
    maxDeliveryAttempts = 5,
    pollMilliseconds = 1_000,
    now = () => new Date(),
    sleep = wait,
    emit = () => {},
  } = {}) {
    requireQueue(queue);
    if (!authenticator || typeof authenticator.authenticate !== "function") {
      throw new TrustedRunnerProcessConfigurationError("Trusted Runner requires a RunnerJobAuthenticator.");
    }
    if (typeof execute !== "function") {
      throw new TrustedRunnerProcessConfigurationError("Trusted Runner requires an authenticated execution callback.");
    }
    requireIdentifier(consumerId, "RUNNER_CONSUMER_ID");
    requireInteger(leaseDurationSeconds, "Runner lease duration", 30, 3_600);
    requireInteger(heartbeatSeconds, "Runner lease heartbeat", 1, leaseDurationSeconds - 1);
    requireInteger(retryDelaySeconds, "Runner retry delay", 1, 86_400);
    requireInteger(maxDeliveryAttempts, "Runner maximum delivery attempts", 1, 20);
    requireInteger(pollMilliseconds, "Runner poll interval", 100, 60_000);
    if (typeof now !== "function" || typeof sleep !== "function" || typeof emit !== "function") {
      throw new TrustedRunnerProcessConfigurationError("Trusted Runner requires clock, sleep, and audit emitter functions.");
    }
    this.queue = queue;
    this.authenticator = authenticator;
    this.execute = execute;
    this.consumerId = consumerId;
    this.leaseDurationSeconds = leaseDurationSeconds;
    this.heartbeatSeconds = heartbeatSeconds;
    this.retryDelaySeconds = retryDelaySeconds;
    this.maxDeliveryAttempts = maxDeliveryAttempts;
    this.pollMilliseconds = pollMilliseconds;
    this.now = now;
    this.sleep = sleep;
    this.emit = emit;
  }

  async processNext() {
    const claimedAt = timestamp(this.now);
    const delivery = await this.queue.claim({
      consumerId: this.consumerId,
      claimedAt,
      leaseDurationSeconds: this.leaseDurationSeconds,
    });
    if (!delivery) return Object.freeze({ outcome: "idle" });

    if (delivery.lease.deliveryAttempt > this.maxDeliveryAttempts) {
      await this.queue.deadLetter({
        runId: delivery.message.runId,
        leaseId: delivery.lease.id,
        deadLetteredAt: timestamp(this.now),
        errorCode: "delivery_attempts_exhausted",
      });
      const result = Object.freeze({
        outcome: "dead_lettered",
        deliveryAttempt: delivery.lease.deliveryAttempt,
        errorCode: "delivery_attempts_exhausted",
      });
      this.emitAudit(result);
      return result;
    }

    const heartbeat = createLeaseHeartbeat({
      queue: this.queue,
      delivery,
      leaseDurationSeconds: this.leaseDurationSeconds,
      heartbeatMilliseconds: this.heartbeatSeconds * 1_000,
      now: this.now,
      sleep: this.sleep,
    });
    try {
      const authenticated = await this.authenticator.authenticate(delivery.message);
      await this.execute(authenticated, {
        beforeFinalize: async () => {
          // Stop concurrent renewal before taking the final fence. A stale
          // process that lost this lease can finish isolated computation, but
          // it cannot sign or persist that computation as Runner evidence.
          await heartbeat.stop();
          await this.queue.renew({
            runId: delivery.message.runId,
            leaseId: delivery.lease.id,
            renewedAt: timestamp(this.now),
            leaseDurationSeconds: this.leaseDurationSeconds,
          });
        },
      });
      await heartbeat.stop();
      await this.queue.acknowledge({
        runId: delivery.message.runId,
        leaseId: delivery.lease.id,
        acknowledgedAt: timestamp(this.now),
      });
      const result = Object.freeze({ outcome: "acknowledged", deliveryAttempt: delivery.lease.deliveryAttempt });
      this.emitAudit(result);
      return result;
    } catch (error) {
      const heartbeatError = await heartbeat.stop().then(() => null, (cause) => cause);
      return this.handleFailure(delivery, heartbeatError ?? error, {
        authenticationFailure: error instanceof RunnerJobAuthenticationError || error instanceof RunnerQueueProtocolError,
      });
    }
  }

  async run({ signal } = {}) {
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      throw new TrustedRunnerProcessConfigurationError("Trusted Runner signal must be an AbortSignal.");
    }
    while (!signal?.aborted) {
      try {
        const result = await this.processNext();
        if (result.outcome === "idle") await this.sleep(this.pollMilliseconds);
      } catch {
        this.emitAudit({ outcome: "control_plane_error", deliveryAttempt: 0, errorCode: "control_plane_error" });
        await this.sleep(this.pollMilliseconds);
      }
    }
  }

  async handleFailure(delivery, error, { authenticationFailure }) {
    const occurredAt = timestamp(this.now);
    const errorCode = authenticationFailure ? "authentication_failed" : privacySafeErrorCode(error);
    try {
      if (authenticationFailure || delivery.lease.deliveryAttempt >= this.maxDeliveryAttempts) {
        await this.queue.deadLetter({
          runId: delivery.message.runId,
          leaseId: delivery.lease.id,
          deadLetteredAt: occurredAt,
          errorCode,
        });
        const result = Object.freeze({
          outcome: "dead_lettered",
          deliveryAttempt: delivery.lease.deliveryAttempt,
          errorCode,
        });
        this.emitAudit(result);
        return result;
      }
      const delaySeconds = Math.min(
        this.retryDelaySeconds * (2 ** Math.max(0, delivery.lease.deliveryAttempt - 1)),
        86_400,
      );
      await this.queue.release({
        runId: delivery.message.runId,
        leaseId: delivery.lease.id,
        releasedAt: occurredAt,
        availableAt: addSeconds(occurredAt, delaySeconds),
        errorCode,
      });
      const result = Object.freeze({
        outcome: "retried",
        deliveryAttempt: delivery.lease.deliveryAttempt,
        retryDelaySeconds: delaySeconds,
        errorCode,
      });
      this.emitAudit(result);
      return result;
    } catch {
      const result = Object.freeze({
        outcome: "lease_lost",
        deliveryAttempt: delivery.lease.deliveryAttempt,
        errorCode: "lease_lost",
      });
      this.emitAudit(result);
      return result;
    }
  }

  emitAudit(result) {
    try {
      const pending = this.emit(Object.freeze({
        schemaVersion: "pw-audit-v1",
        kind: "trusted_runner_delivery",
        component: "trusted_lean_runner",
        occurredAt: timestamp(this.now),
        outcome: result.outcome,
        deliveryAttempt: result.deliveryAttempt,
        ...(result.retryDelaySeconds ? { retryDelaySeconds: result.retryDelaySeconds } : {}),
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      }));
      if (pending && typeof pending.then === "function") Promise.resolve(pending).catch(() => {});
    } catch {
      // Observability never changes a queue delivery outcome.
    }
  }
}

/** Compose the trusted process from already-created provider adapters. */
export async function createTrustedRunnerRuntime({
  database,
  containerFactory,
  environment = process.env,
  closeDatabase = false,
  now = () => new Date(),
  sleep = wait,
  emit = emitStructuredConsole,
} = {}) {
  requireExecutionEnabled(environment);
  if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function") {
    throw new TrustedRunnerProcessConfigurationError("Trusted Runner runtime requires a D1-compatible database.");
  }
  if (!containerFactory || typeof containerFactory.get !== "function" || typeof containerFactory.close !== "function") {
    throw new TrustedRunnerProcessConfigurationError("Trusted Runner runtime requires a private Sandbox factory.");
  }

  const approvedImages = parseJsonSetting(environment, "RUNNER_APPROVED_IMAGES_JSON");
  const imageRegistry = new PinnedRunnerImageRegistry({ images: approvedImages });
  if (
    typeof containerFactory.imageReference === "string" &&
    (imageRegistry.images.size !== 1 || !imageRegistry.images.has(containerFactory.imageReference))
  ) {
    throw new TrustedRunnerProcessConfigurationError("The Sandbox image must be the single image in the Runner allowlist.");
  }
  const authenticator = new RunnerJobAuthenticator({
    issuerKeys: parseJsonSetting(environment, "RUNNER_CONTROL_PLANE_ISSUER_KEYS_JSON"),
  });
  const queue = new D1RunnerLeaseQueue({ database });
  const runStore = new D1RunStore(database);
  const artifactBucket = new D1InlineArtifactBucket(database);
  const getContainerForRun = (runId) => containerFactory.get(runId);
  const workspaceStager = new RunnerWorkspaceStager({
    preflight: new RunnerJobPreflight({
      runStore,
      bundleResolver: new D1InlineRunnerBundleResolver({ database }),
      imageRegistry,
    }),
    workspaceTransfer: new RunnerWorkspaceTransfer({ bucket: artifactBucket }),
    getContainer: getContainerForRun,
    restageRunning: true,
  });
  const finalizer = new RunnerExecutionFinalizer({
    runStore,
    outputStore: new D1InlineRunnerOutputStore({ database }),
    replayEvidenceStore: new D1InlineVerificationReplayEvidenceStore({ database }),
    resultSigner: new RunnerExecutionResultSigner({
      runnerKeyId: requireSetting(environment, "RUNNER_RESULT_KEY_ID"),
      runnerPrivateKey: await importRunnerResultPrivateKey(requireSetting(environment, "RUNNER_RESULT_PRIVATE_KEY_JWK")),
    }),
  });
  const execute = createRunnerQueueExecution({
    workspaceStager,
    imageRegistry,
    getContainerForRun,
    executionClient: new RunnerContainerExecutionClient(),
    finalizer,
    isCancellationRequested: async (runId) => (await runStore.find(runId))?.state === "cancel_requested",
    now,
  });
  const leaseDurationSeconds = integerSetting(environment, "RUNNER_LEASE_SECONDS", 300, 30, 3_600);
  const process = new TrustedRunnerProcess({
    queue,
    authenticator,
    execute,
    consumerId: requireSetting(environment, "RUNNER_CONSUMER_ID"),
    leaseDurationSeconds,
    heartbeatSeconds: integerSetting(
      environment,
      "RUNNER_LEASE_HEARTBEAT_SECONDS",
      Math.min(60, Math.floor(leaseDurationSeconds / 3)),
      1,
      leaseDurationSeconds - 1,
    ),
    retryDelaySeconds: integerSetting(environment, "RUNNER_RETRY_DELAY_SECONDS", 30, 1, 86_400),
    maxDeliveryAttempts: integerSetting(environment, "RUNNER_MAX_DELIVERY_ATTEMPTS", 5, 1, 20),
    pollMilliseconds: integerSetting(environment, "RUNNER_POLL_MILLISECONDS", 1_000, 100, 60_000),
    now,
    sleep,
    emit,
  });
  return Object.freeze({
    queue,
    process,
    processNext: () => process.processNext(),
    run: (options) => process.run(options),
    async close() {
      try {
        await containerFactory.close();
      } finally {
        if (closeDatabase) database.close?.();
      }
    },
  });
}

/** Select exactly one reviewed Sandbox provider from process secrets. */
export function createTrustedRunnerContainerFactoryFromEnvironment({
  environment = process.env,
  modalClient,
  e2bSandboxApi,
  fetcher = globalThis.fetch,
  sleep = wait,
} = {}) {
  const provider = requireSetting(environment, "PROOFWEAVE_RUNNER_PROVIDER").toLowerCase();
  if (provider === "modal") {
    return createModalSandboxContainerFactoryFromEnvironment({
      environment,
      ...(modalClient ? { client: modalClient } : {}),
      fetcher,
    });
  }
  if (provider === "e2b") {
    return createE2BSandboxContainerFactoryFromEnvironment({
      environment,
      ...(e2bSandboxApi ? { sandboxApi: e2bSandboxApi } : {}),
      fetcher,
      sleep,
    });
  }
  throw new TrustedRunnerProcessConfigurationError("PROOFWEAVE_RUNNER_PROVIDER must be exactly modal or e2b.");
}

/** Create the remote libSQL + selected Sandbox deployment adapters. */
export async function createTrustedRunnerRuntimeFromEnvironment({
  environment = process.env,
  modalClient,
  e2bSandboxApi,
  fetcher = globalThis.fetch,
  now = () => new Date(),
  sleep = wait,
  emit = emitStructuredConsole,
} = {}) {
  requireExecutionEnabled(environment);
  const database = createRemoteLibsqlD1Database({
    url: requireSetting(environment, "TURSO_DATABASE_URL"),
    authToken: requireSetting(environment, "TURSO_AUTH_TOKEN"),
  });
  try {
    const containerFactory = createTrustedRunnerContainerFactoryFromEnvironment({
      environment,
      modalClient,
      e2bSandboxApi,
      fetcher,
      sleep,
    });
    return await createTrustedRunnerRuntime({
      database,
      containerFactory,
      environment,
      closeDatabase: true,
      now,
      sleep,
      emit,
    });
  } catch (error) {
    database.close();
    throw error;
  }
}

function createLeaseHeartbeat({
  queue,
  delivery,
  leaseDurationSeconds,
  heartbeatMilliseconds,
  now,
  sleep,
}) {
  let stopped = false;
  let heartbeatFailure = null;
  let wake;
  const wakeSignal = new Promise((resolve) => { wake = resolve; });
  const running = (async () => {
    while (!stopped) {
      await Promise.race([sleep(heartbeatMilliseconds), wakeSignal]);
      if (stopped) return;
      await queue.renew({
        runId: delivery.message.runId,
        leaseId: delivery.lease.id,
        renewedAt: timestamp(now),
        leaseDurationSeconds,
      });
    }
  })().catch((error) => {
    heartbeatFailure = error;
  });
  return Object.freeze({
    async stop() {
      stopped = true;
      wake();
      await running;
      if (heartbeatFailure) throw heartbeatFailure;
    },
  });
}

function requireQueue(value) {
  const operations = ["claim", "renew", "acknowledge", "release", "deadLetter"];
  if (!value || operations.some((operation) => typeof value[operation] !== "function")) {
    throw new TrustedRunnerProcessConfigurationError("Trusted Runner requires a durable lease queue.");
  }
}

function requireExecutionEnabled(environment) {
  if (environment?.RUNNER_EXECUTION_ENABLED !== "true") {
    throw new TrustedRunnerProcessConfigurationError("Trusted Runner requires RUNNER_EXECUTION_ENABLED=true before it can execute leases.");
  }
}

function parseJsonSetting(environment, key) {
  const serialized = requireSetting(environment, key);
  if (serialized.length > 32_768) {
    throw new TrustedRunnerProcessConfigurationError(`${key} exceeds its deployment value limit.`);
  }
  try {
    return JSON.parse(serialized);
  } catch (cause) {
    throw new TrustedRunnerProcessConfigurationError(`${key} must be valid JSON.`, { cause });
  }
}

function requireSetting(environment, key) {
  const value = environment?.[key];
  if (typeof value !== "string" || !value.trim() || value.length > 32_768 || /\0/.test(value)) {
    throw new TrustedRunnerProcessConfigurationError(`Trusted Runner requires ${key}.`);
  }
  return value;
}

function integerSetting(environment, key, fallback, minimum, maximum) {
  const value = environment?.[key];
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new TrustedRunnerProcessConfigurationError(`${key} must be an integer between ${minimum} and ${maximum}.`);
  }
  const number = Number(value);
  requireInteger(number, key, minimum, maximum);
  return number;
}

function requireInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TrustedRunnerProcessConfigurationError(`${label} must be between ${minimum} and ${maximum}.`);
  }
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{2,191}$/.test(value)) {
    throw new TrustedRunnerProcessConfigurationError(`${label} must be a bounded identifier.`);
  }
}

function privacySafeErrorCode(error) {
  const name = typeof error?.name === "string" ? error.name : "execution_error";
  const normalized = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  const bounded = normalized.slice(0, 56);
  return /^[a-z][a-z0-9_]{2,63}$/.test(bounded) ? bounded : "execution_error";
}

function timestamp(now) {
  const value = now();
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new TrustedRunnerProcessConfigurationError("Trusted Runner clock returned an invalid instant.");
  }
  return instant.toISOString();
}

function addSeconds(value, seconds) {
  return new Date(Date.parse(value) + seconds * 1_000).toISOString();
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}

function emitStructuredConsole(record) {
  console.log(JSON.stringify(record));
}
