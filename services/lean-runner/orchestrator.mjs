import {
  artifactBundleHash,
  normalizeArtifactBundle,
} from "../../packages/protocol/artifact-bundle.mjs";
import {
  createLeanRunnerRequest,
  leanRunnerRequestHash,
} from "../../packages/protocol/lean-runner.mjs";
import { createRunnerQueueMessage } from "./queue.mjs";

export class RunnerDispatchError extends Error {
  constructor({ runId, cause }) {
    super(`Run ${runId} was recorded but could not be delivered to the runner queue. Retry with the same idempotency key.`);
    this.name = "RunnerDispatchError";
    this.runId = runId;
    this.cause = cause;
  }
}

/**
 * Internal control-plane orchestration only. It binds an already-signed
 * Artifact Bundle to exactly one D1 Run and one signed queue envelope. It does
 * not fetch archives, execute Lean, or expose an HTTP endpoint.
 */
export class RunnerOrchestrator {
  constructor({
    runStore,
    runnerQueue,
    imageDigest,
    defaultLimits,
    controlPlaneKeyId,
    controlPlanePrivateKey,
  }) {
    if (!runStore || typeof runStore.queue !== "function" || typeof runStore.findByAttemptIdempotency !== "function") {
      throw new TypeError("RunnerOrchestrator requires a Run store with queue() and findByAttemptIdempotency().");
    }
    if (!runnerQueue || typeof runnerQueue.enqueue !== "function") {
      throw new TypeError("RunnerOrchestrator requires a RunnerQueue with enqueue().");
    }
    this.runStore = runStore;
    this.runnerQueue = runnerQueue;
    this.imageDigest = imageDigest;
    this.defaultLimits = defaultLimits;
    this.controlPlaneKeyId = controlPlaneKeyId;
    this.controlPlanePrivateKey = controlPlanePrivateKey;
  }

  /**
   * Persist first, then deliver. If delivery fails, the Run remains queued and
   * a retry with the same Attempt/idempotency key safely reuses its identity.
   */
  async queueArtifactBundle({
    runId,
    idempotencyKey,
    artifactBundle,
    queuedAt,
    limits = this.defaultLimits,
    beforeDispatch = null,
  }) {
    if (beforeDispatch !== null && typeof beforeDispatch !== "function") {
      throw new TypeError("RunnerOrchestrator beforeDispatch must be a function when supplied.");
    }
    const normalizedBundle = normalizeArtifactBundle(artifactBundle);
    const existing = await this.runStore.findByAttemptIdempotency(normalizedBundle.attemptId, idempotencyKey);
    // Retries may have lost their generated run ID. The persisted identity wins
    // so the recreated request hash remains exactly the original one.
    const effectiveRunId = existing?.id ?? runId;
    const [request, artifactBundleManifestHash] = await Promise.all([
      createLeanRunnerRequest({
        jobId: effectiveRunId,
        idempotencyKey,
        artifactBundle: normalizedBundle,
        imageDigest: this.imageDigest,
        limits,
      }),
      artifactBundleHash(normalizedBundle),
    ]);
    const requestHash = await leanRunnerRequestHash(request);
    const queued = await this.runStore.queue({
      id: runId,
      attemptId: request.attemptId,
      idempotencyKey,
      requestHash,
      artifactBundleHash: artifactBundleManifestHash,
      queuedAt,
    });
    // Persist any higher-level provenance before a Queue consumer can start
    // the fresh workspace. The callback must itself be idempotent because a
    // delivery retry can revisit an already queued Run.
    if (beforeDispatch) await beforeDispatch(queued.run);
    // A duplicate request must never re-deliver an already leased, running, or
    // terminal Run. Queued records remain safe to resend after provider loss.
    if (queued.run.state !== "queued") {
      return Object.freeze({
        run: queued.run,
        runCreated: queued.created,
        message: null,
        delivery: null,
      });
    }
    const message = await createRunnerQueueMessage({
      runId: queued.run.id,
      request,
      enqueuedAt: queued.run.queuedAt,
      controlPlaneKeyId: this.controlPlaneKeyId,
      controlPlanePrivateKey: this.controlPlanePrivateKey,
    });

    let delivery;
    try {
      delivery = await this.runnerQueue.enqueue(message);
      if (delivery.deliveryState === "dead_letter") {
        if (typeof this.runnerQueue.redrive !== "function") {
          throw new Error("The Runner queue cannot redrive an exhausted immutable delivery.");
        }
        delivery = await this.runnerQueue.redrive({
          runId: queued.run.id,
          redrivenAt: queuedAt,
        });
        if (!delivery.redriven || delivery.deliveryState !== "queued") {
          throw new Error("The exhausted Runner delivery could not be safely redriven.");
        }
      }
    } catch (error) {
      throw new RunnerDispatchError({ runId: queued.run.id, cause: error });
    }
    return Object.freeze({
      run: queued.run,
      runCreated: queued.created,
      message,
      delivery,
    });
  }
}
