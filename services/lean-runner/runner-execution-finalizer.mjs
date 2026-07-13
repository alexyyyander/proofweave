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
 * 4. let D1RunStore accept the signed terminal projection.
 *
 * No browser or Container can skip any preceding step. Idempotent retry is
 * delegated to each immutable store, so an interrupted Worker invocation does
 * not produce a second result identity.
 */
export class RunnerExecutionFinalizer {
  constructor({ runStore, outputStore, resultSigner }) {
    if (!runStore || typeof runStore.find !== "function" || typeof runStore.recordResult !== "function") {
      throw new TypeError("RunnerExecutionFinalizer requires a D1 Run store with find() and recordResult().");
    }
    if (!outputStore || typeof outputStore.persist !== "function") {
      throw new TypeError("RunnerExecutionFinalizer requires immutable Runner output persistence.");
    }
    if (!resultSigner || typeof resultSigner.sign !== "function") {
      throw new TypeError("RunnerExecutionFinalizer requires a trusted Runner result signer.");
    }
    this.runStore = runStore;
    this.outputStore = outputStore;
    this.resultSigner = resultSigner;
  }

  async finalize({ runId, execution, receivedAt }) {
    const run = await this.runStore.find(runId);
    if (!run) throw new RunnerExecutionFinalizerError("Container execution has no persisted Run.");
    const outputs = await this.outputStore.persist({ run, execution });
    const result = await this.resultSigner.sign({ execution, run });
    const finalizedRun = await this.runStore.recordResult(runId, result, receivedAt);
    return Object.freeze({ run: finalizedRun, result, outputs });
  }
}
