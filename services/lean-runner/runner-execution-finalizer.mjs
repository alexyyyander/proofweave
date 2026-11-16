export class RunnerExecutionFinalizerError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RunnerExecutionFinalizerError";
  }
}

/**
 * The trusted Worker ordering rule for a Container result:
 *
 * 1. read the active Run;
 * 2. persist hash-checked stdout/stderr to immutable R2/D1 output evidence;
 * 3. sign the exact evidence with the Worker-held operator key;
 * 4. when this Run is a review replay, materialize its citeable replay
 *    evidence before the terminal projection;
 * 5. let D1RunStore accept the signed terminal projection.
 * 6. only after a successful terminal projection, idempotently publish the
 *    exact Bundle's independent verification work.
 *
 * No browser or Container can skip any preceding step. Idempotent retry is
 * delegated to each immutable store, so an interrupted Worker invocation does
 * not produce a second result identity or duplicate verification jobs.
 */
export class RunnerExecutionFinalizer {
  constructor({
    runStore,
    outputStore,
    resultSigner,
    replayEvidenceStore = null,
    verificationJobPublisher = null,
  }) {
    if (!runStore || typeof runStore.find !== "function" || typeof runStore.recordResult !== "function") {
      throw new TypeError("RunnerExecutionFinalizer requires a D1 Run store with find() and recordResult().");
    }
    if (!outputStore || typeof outputStore.persist !== "function") {
      throw new TypeError("RunnerExecutionFinalizer requires immutable Runner output persistence.");
    }
    if (!resultSigner || typeof resultSigner.sign !== "function") {
      throw new TypeError("RunnerExecutionFinalizer requires a trusted Runner result signer.");
    }
    if (replayEvidenceStore !== null && typeof replayEvidenceStore.persist !== "function") {
      throw new TypeError("RunnerExecutionFinalizer replay evidence persistence must expose persist().");
    }
    if (
      verificationJobPublisher !== null
      && typeof verificationJobPublisher.publishJobsForBundle !== "function"
    ) {
      throw new TypeError(
        "RunnerExecutionFinalizer verification job publication must expose publishJobsForBundle().",
      );
    }
    this.runStore = runStore;
    this.outputStore = outputStore;
    this.resultSigner = resultSigner;
    this.replayEvidenceStore = replayEvidenceStore;
    this.verificationJobPublisher = verificationJobPublisher;
  }

  async finalize({ runId, execution, request = null, receivedAt, retryFence = null }) {
    const retryUntil = Date.now() + 90_000;
    const persist = operation => retryImmutableStage(operation, retryFence, retryUntil);
    const run = await persist(() => this.runStore.find(runId));
    if (!run) throw new RunnerExecutionFinalizerError("Container execution has no persisted Run.");
    const outputs = await persist(() => this.outputStore.persist({ run, execution }));
    const result = await this.resultSigner.sign({ execution, run, request });
    const replayEvidence = this.replayEvidenceStore
      ? await persist(() => this.replayEvidenceStore.persist({ run, result, receivedAt }))
      : null;
    const finalizedRun = await persist(() => this.runStore.recordResult(runId, result, receivedAt));
    let verificationMarket = null;
    if (finalizedRun.state === "succeeded" && this.verificationJobPublisher) {
      try {
        verificationMarket = await this.verificationJobPublisher.publishJobsForBundle(
          finalizedRun.artifactBundleHash,
          receivedAt,
        );
      } catch (cause) {
        throw new RunnerExecutionFinalizerError(
          "The successful Runner result is durable, but its verification work could not be published.",
          { cause },
        );
      }
    }
    return Object.freeze({
      run: finalizedRun,
      result,
      outputs,
      replayEvidence,
      verificationMarket,
    });
  }
}

const transientTransportCodes = new Set([
  "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "ETIMEDOUT", "ECONNRESET",
]);

async function retryImmutableStage(operation, retryFence, retryUntil) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!retryFence || attempt >= 3 || Date.now() + 2_000 >= retryUntil || !isTransportError(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
      // A committed write with a lost response is safe here: each store
      // verifies the exact immutable bytes on retry. Revalidate the same
      // lease before touching the control plane again.
      await retryFence();
    }
  }
}

function isTransportError(error) {
  for (let cause = error, depth = 0; cause && depth < 5; cause = cause.cause, depth++) {
    if (cause.message === "fetch failed" || transientTransportCodes.has(cause.code)) return true;
  }
  return false;
}
