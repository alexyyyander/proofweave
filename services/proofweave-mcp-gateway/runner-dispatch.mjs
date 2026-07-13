import { D1R2ArtifactStore } from "../artifacts/d1-r2-artifact-store.mjs";
import { D1RunStore } from "../lean-runner/d1-run-store.mjs";
import { RunnerOrchestrator } from "../lean-runner/orchestrator.mjs";
import { PinnedRunnerImageRegistry } from "../lean-runner/runner-image-policy.mjs";
import { normalizeLeanRunnerLimits } from "../../packages/protocol/lean-runner.mjs";
import { artifactBundleV2ProtocolVersion } from "../../packages/protocol/artifact-bundle.mjs";

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
 * Trusted control-plane bridge from one already-authorized, immutable v2
 * Artifact Bundle to one idempotent Runner Queue request. This class has no
 * HTTP surface: MCP authorization and exact Attempt/Agent binding stay in the
 * gateway store, while this boundary rechecks the staged Bundle and selects an
 * image only from deployment-owned configuration.
 */
export class D1RemoteMcpRunnerDispatcher {
  constructor({
    database,
    bucket,
    runnerQueue,
    approvedImages,
    controlPlaneKeyId,
    controlPlanePrivateKeyJwk,
    defaultLimits,
    now = () => new Date(),
  } = {}) {
    if (!database || typeof database.prepare !== "function") {
      throw new RemoteMcpRunnerDispatchConfigurationError("Runner dispatch requires a D1 database binding.");
    }
    if (!bucket || typeof bucket.head !== "function") {
      throw new RemoteMcpRunnerDispatchConfigurationError("Runner dispatch requires an R2 ARTIFACTS binding.");
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

    this.artifactStore = new D1R2ArtifactStore({ database, bucket });
    this.runStore = new D1RunStore(database);
    this.runnerQueue = runnerQueue;
    this.approvedImages = approvedImages;
    this.controlPlaneKeyId = controlPlaneKeyId;
    this.controlPlanePrivateKeyJwk = controlPlanePrivateKeyJwk;
    this.defaultLimits = normalizeLeanRunnerLimits(defaultLimits);
    this.now = now;
    this.controlPlanePrivateKeyPromise = null;
  }

  async queueBundle({ attempt, artifactBundleHash, idempotencyKey }) {
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
    if (loaded.bundle.protocolVersion !== artifactBundleV2ProtocolVersion) {
      throw new RemoteMcpRunnerDispatchValidationError("Runner dispatch requires pw-artifact-bundle-v2 executable workspace evidence.");
    }

    const image = this.approvedImages.resolveEnvironment(loaded.bundle.environment);
    const orchestrator = new RunnerOrchestrator({
      runStore: this.runStore,
      runnerQueue: this.runnerQueue,
      imageDigest: image.imageDigest,
      defaultLimits: this.defaultLimits,
      controlPlaneKeyId: this.controlPlaneKeyId,
      controlPlanePrivateKey: await this.controlPlanePrivateKey(),
    });
    return orchestrator.queueArtifactBundle({
      runId: `run:${crypto.randomUUID()}`,
      idempotencyKey,
      artifactBundle: loaded.bundle,
      queuedAt: isoInstant(this.now()),
    });
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
