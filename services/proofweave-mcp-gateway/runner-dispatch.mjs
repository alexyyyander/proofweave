import { D1R2ArtifactStore, maxArtifactObjectBytes } from "../artifacts/d1-r2-artifact-store.mjs";
import { D1InlineArtifactStore, maxInlineArtifactObjectBytes } from "../artifacts/d1-inline-artifact-store.mjs";
import { D1RunStore } from "../lean-runner/d1-run-store.mjs";
import { RunnerOrchestrator } from "../lean-runner/orchestrator.mjs";
import { PinnedRunnerImageRegistry, RunnerImagePolicyError } from "../lean-runner/runner-image-policy.mjs";
import { normalizeLeanRunnerLimits, runnerEnvironmentKey } from "../../packages/protocol/lean-runner.mjs";
import {
  normalizeRunnerExecutionEnvironments,
  runnerEnvironmentDispatchDecision,
} from "../lean-runner/runner-availability.mjs";
import { isExecutableArtifactBundle } from "../../packages/protocol/artifact-bundle.mjs";

export class RemoteMcpRunnerDispatchConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "RemoteMcpRunnerDispatchConfigurationError";
  }
}

export class RemoteMcpRunnerDispatchValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "RemoteMcpRunnerDispatchValidationError";
  }
}

/**
 * Stable, user-facing refusal for a Run whose exact Lean environment has no
 * approved image, no deployed Runner, or disabled execution. The MCP tool
 * surface prefixes the message with `code` so clients can distinguish this
 * from a transient control-plane failure.
 */
export class RunnerEnvironmentUnavailableError extends Error {
  constructor({ reason, environment, availableEnvironments = [] }) {
    const label = `Lean ${environment.leanToolchain} + Mathlib ${environment.mathlibRevision}`;
    super(reason === "not_approved"
      ? `No approved hosted Runner image exists for ${label}.`
      : reason === "not_deployed"
        ? `No hosted Runner is deployed for ${label}.`
        : `Hosted Runner execution is disabled for ${label}. Prepare locally, or wait for the environment to be enabled.`);
    this.name = "RunnerEnvironmentUnavailableError";
    this.code = "runner_environment_unavailable";
    this.reason = reason;
    this.environment = Object.freeze({
      leanToolchain: environment.leanToolchain,
      mathlibRevision: environment.mathlibRevision,
    });
    this.availableEnvironments = Object.freeze(availableEnvironments.map((entry) => Object.freeze({
      leanToolchain: entry.leanToolchain,
      mathlibRevision: entry.mathlibRevision,
      executionEnabled: entry.executionEnabled,
    })));
  }
}

/**
 * Wake the Runner that serves this exact Lean environment. A configured route
 * wins; the single wake client remains a fallback for tests and single-Runner
 * deployments.
 */
export function selectRunnerWake({ environment, runnerWake = null, runnerWakeRoutes = null }) {
  if (runnerWakeRoutes === null) return runnerWake;
  return runnerWakeRoutes.get(runnerEnvironmentKey(environment)) ?? runnerWake;
}

/**
 * Trusted control-plane bridge from one already-authorized, immutable v2
 * Artifact Bundle to one idempotent Runner Queue request. This class has no
 * HTTP surface: MCP authorization and exact Attempt/Agent binding stay in the
 * gateway store, while this boundary rechecks the staged Bundle and selects an
 * image only from deployment-owned configuration.
 */
export class D1RemoteMcpRunnerDispatcher {
  constructor({
    database,
    bucket = null,
    artifactStore = null,
    runnerQueue,
    approvedImages,
    controlPlaneKeyId,
    controlPlanePrivateKeyJwk,
    defaultLimits,
    runnerWake = null,
    runnerWakeRoutes = null,
    executionEnvironments = null,
    now = () => new Date(),
  } = {}) {
    if (!database || typeof database.prepare !== "function") {
      throw new RemoteMcpRunnerDispatchConfigurationError("Runner dispatch requires a D1 database binding.");
    }
    if (artifactStore && typeof artifactStore.loadBundleForDispatch !== "function") {
      throw new RemoteMcpRunnerDispatchConfigurationError("Runner dispatch artifact storage must load staged immutable Bundles.");
    }
    if (!artifactStore && bucket && typeof bucket.head !== "function") {
      throw new RemoteMcpRunnerDispatchConfigurationError("Runner dispatch object storage must expose head().");
    }
    if (!runnerQueue || typeof runnerQueue.enqueue !== "function") {
      throw new RemoteMcpRunnerDispatchConfigurationError("Runner dispatch requires a trusted Runner Queue adapter.");
    }
    if (!(approvedImages instanceof PinnedRunnerImageRegistry)) {
      throw new RemoteMcpRunnerDispatchConfigurationError("Runner dispatch requires an approved Runner image registry.");
    }
    requireIdentifier(controlPlaneKeyId, "Runner control-plane key id");
    requirePrivateEd25519Jwk(controlPlanePrivateKeyJwk);
    if (typeof now !== "function") {
      throw new RemoteMcpRunnerDispatchConfigurationError("Runner dispatch requires a clock function.");
    }
    if (runnerWake !== null && typeof runnerWake?.wake !== "function") {
      throw new RemoteMcpRunnerDispatchConfigurationError("Runner dispatch wake client must expose wake().");
    }
    if (runnerWakeRoutes !== null) {
      if (!(runnerWakeRoutes instanceof Map)) {
        throw new RemoteMcpRunnerDispatchConfigurationError("Runner dispatch wake routes must be a Map keyed by Runner environment.");
      }
      for (const [key, client] of runnerWakeRoutes) {
        if (typeof key !== "string" || key.length === 0 || typeof client?.wake !== "function") {
          throw new RemoteMcpRunnerDispatchConfigurationError("Runner dispatch wake routes require derived environment keys and wake clients.");
        }
      }
    }
    const normalizedExecutionEnvironments = executionEnvironments === null
      ? null
      : normalizeRunnerExecutionEnvironments(executionEnvironments);

    this.artifactStore = artifactStore ?? (bucket
      ? new D1R2ArtifactStore({ database, bucket })
      : new D1InlineArtifactStore({ database }));
    this.runStore = new D1RunStore(database);
    this.runnerQueue = runnerQueue;
    this.approvedImages = approvedImages;
    this.controlPlaneKeyId = controlPlaneKeyId;
    this.controlPlanePrivateKeyJwk = controlPlanePrivateKeyJwk;
    this.defaultLimits = normalizeLeanRunnerLimits(defaultLimits);
    this.runnerWake = runnerWake;
    this.runnerWakeRoutes = runnerWakeRoutes;
    this.executionEnvironments = normalizedExecutionEnvironments;
    // R2-backed evidence can carry the full control-plane object ceiling.
    // The inline D1 fallback keeps the smaller closed-alpha row limit.
    const maximumOutputBytes = bucket ? maxArtifactObjectBytes : maxInlineArtifactObjectBytes;
    if (this.defaultLimits.outputBytes > maximumOutputBytes) {
      throw new RemoteMcpRunnerDispatchConfigurationError(
        `Runner outputBytes must not exceed the ${maximumOutputBytes} byte ${bucket ? "R2" : "D1 inline-alpha"} evidence limit.`,
      );
    }
    this.now = now;
    this.controlPlanePrivateKeyPromise = null;
  }

  async queueBundle({ attempt, artifactBundleHash, idempotencyKey, runId = `run:${crypto.randomUUID()}`, beforeDispatch = null }) {
    requireAttempt(attempt);
    requireSha256(artifactBundleHash, "Artifact Bundle hash");
    requireIdentifier(idempotencyKey, "Runner idempotency key", 160);

    const loaded = await this.artifactStore.loadBundleForDispatch(artifactBundleHash);
    if (!loaded) {
      throw new RemoteMcpRunnerDispatchValidationError("Artifact Bundle was not found in immutable storage.");
    }
    if (loaded.stored.attemptId !== attempt.id || loaded.bundle.attemptId !== attempt.id) {
      throw new RemoteMcpRunnerDispatchValidationError("Artifact Bundle does not belong to the authorized Attempt.");
    }
    if (loaded.bundle.problemRevisionId !== attempt.problemRevisionId) {
      throw new RemoteMcpRunnerDispatchValidationError("Artifact Bundle target does not match the authorized Attempt revision.");
    }
    if (!isExecutableArtifactBundle(loaded.bundle)) {
      throw new RemoteMcpRunnerDispatchValidationError("Runner dispatch requires executable pw-artifact-bundle-v2 or pw-artifact-bundle-v3 workspace evidence.");
    }

    const environmentDecision = runnerEnvironmentDispatchDecision({
      executionEnvironments: this.executionEnvironments,
      environment: loaded.bundle.environment,
    });
    if (!environmentDecision.allowed) {
      throw new RunnerEnvironmentUnavailableError({
        reason: environmentDecision.reason,
        environment: loaded.bundle.environment,
        availableEnvironments: this.executionEnvironments ?? [],
      });
    }
    let image;
    try {
      image = this.approvedImages.resolveEnvironment(loaded.bundle.environment);
    } catch (error) {
      if (!(error instanceof RunnerImagePolicyError)) throw error;
      throw new RunnerEnvironmentUnavailableError({
        reason: "not_approved",
        environment: loaded.bundle.environment,
        availableEnvironments: this.executionEnvironments ?? [],
      });
    }
    const orchestrator = new RunnerOrchestrator({
      runStore: this.runStore,
      runnerQueue: this.runnerQueue,
      imageDigest: image.imageDigest,
      defaultLimits: this.defaultLimits,
      controlPlaneKeyId: this.controlPlaneKeyId,
      controlPlanePrivateKey: await this.controlPlanePrivateKey(),
    });
    const queued = await orchestrator.queueArtifactBundle({
      runId,
      idempotencyKey,
      artifactBundle: loaded.bundle,
      queuedAt: isoInstant(this.now()),
      beforeDispatch,
    });
    const wake = selectRunnerWake({
      environment: loaded.bundle.environment,
      runnerWake: this.runnerWake,
      runnerWakeRoutes: this.runnerWakeRoutes,
    });
    if (!queued.delivery || !wake) return Object.freeze({ ...queued, runnerWake: null });
    try {
      const runnerWake = await wake.wake();
      return Object.freeze({ ...queued, runnerWake });
    } catch (error) {
      const errorCode = privacySafeErrorCode(error);
      return Object.freeze({
        ...queued,
        runnerWake: Object.freeze({
          state: errorCode === "runner_wake_unconfirmed" ? "wake_unconfirmed" : "wake_failed",
          errorCode,
        }),
      });
    }
  }

  async controlPlanePrivateKey() {
    if (!this.controlPlanePrivateKeyPromise) {
      this.controlPlanePrivateKeyPromise = crypto.subtle
        .importKey("jwk", this.controlPlanePrivateKeyJwk, { name: "Ed25519" }, false, ["sign"])
        .catch(() => {
          this.controlPlanePrivateKeyPromise = null;
          throw new RemoteMcpRunnerDispatchConfigurationError("Runner control-plane signing key is not a usable Ed25519 private JWK.");
        });
    }
    return this.controlPlanePrivateKeyPromise;
  }
}

function requireAttempt(value) {
  if (!value || typeof value !== "object") {
    throw new RemoteMcpRunnerDispatchValidationError("Authorized Attempt is required for Runner dispatch.");
  }
  requireIdentifier(value.id, "Attempt id");
  requireIdentifier(value.problemRevisionId, "Attempt problem revision id");
}

function requireIdentifier(value, label, maximum = 240) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new RemoteMcpRunnerDispatchConfigurationError(`${label} must be a bounded identifier.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new RemoteMcpRunnerDispatchValidationError(`${label} must be a sha256:<hex> value.`);
  }
}

function requirePrivateEd25519Jwk(value) {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    value.kty !== "OKP" || value.crv !== "Ed25519" ||
    !base64UrlKeyMaterial(value.x) || !base64UrlKeyMaterial(value.d)
  ) {
    throw new RemoteMcpRunnerDispatchConfigurationError("Runner control-plane signing key must be an Ed25519 private JWK.");
  }
}

function base64UrlKeyMaterial(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function isoInstant(value) {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new RemoteMcpRunnerDispatchConfigurationError("Runner dispatch clock returned an invalid instant.");
  }
  return instant.toISOString();
}

function privacySafeErrorCode(error) {
  if (typeof error?.diagnosticCode === "string" && /^[a-z][a-z0-9_]{2,63}$/.test(error.diagnosticCode)) {
    return error.diagnosticCode;
  }
  return "runner_wake_failed";
}
