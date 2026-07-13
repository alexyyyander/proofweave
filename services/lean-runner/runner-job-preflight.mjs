import { runStates } from "../../packages/domain/run.mjs";
import { normalizeRunnerQueueMessage } from "./queue.mjs";

export class RunnerJobPreflightError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RunnerJobPreflightError";
  }
}

/**
 * Connects an already authenticated Queue envelope to the D1 Run that was
 * durably recorded before dispatch. Resolve the immutable bundle before the
 * Run is claimed so a failed storage check cannot leave a false `running`
 * projection behind.
 */
export class RunnerJobPreflight {
  constructor({ runStore, bundleResolver, imageRegistry }) {
    if (!runStore || typeof runStore.find !== "function" || typeof runStore.start !== "function") {
      throw new TypeError("RunnerJobPreflight requires a Run store with find() and start().");
    }
    if (!bundleResolver || typeof bundleResolver.resolve !== "function") {
      throw new TypeError("RunnerJobPreflight requires a D1/R2 Bundle resolver.");
    }
    if (!imageRegistry || typeof imageRegistry.resolve !== "function") {
      throw new TypeError("RunnerJobPreflight requires an approved Runner image registry.");
    }
    this.runStore = runStore;
    this.bundleResolver = bundleResolver;
    this.imageRegistry = imageRegistry;
  }

  /**
   * This method accepts a message only after RunnerJobAuthenticator has
   * verified its issuer signature. It independently normalizes the envelope
   * so the D1 Run/request/hash relationship is never accepted by reference.
   */
  async claimAuthenticatedMessage(message, { startedAt }) {
    const normalizedMessage = await normalizeRunnerQueueMessage(message);
    const current = await this.requireMatchingRun(normalizedMessage);
    if (current.state !== "queued") {
      return skipped(current);
    }

    const image = this.imageRegistry.resolve(normalizedMessage.request);
    const resolvedBundle = await this.bundleResolver.resolve(normalizedMessage.request);
    let started;
    try {
      started = await this.runStore.start(normalizedMessage.runId, startedAt);
    } catch (cause) {
      // Another Queue delivery may have claimed or cancelled the Run while its
      // immutable Bundle was being read. Never run a second Container in that
      // case; let the original claimant own completion.
      const latest = await this.requireMatchingRun(normalizedMessage);
      if (latest.state !== "queued") return skipped(latest);
      throw new RunnerJobPreflightError("Runner Run could not be atomically claimed.", { cause });
    }
    if (started.state !== "running") {
      throw new RunnerJobPreflightError("Run store returned a non-running Run after a successful claim.");
    }
    return Object.freeze({
      action: "execute",
      run: started,
      message: normalizedMessage,
      image,
      resolvedBundle,
    });
  }

  async requireMatchingRun(message) {
    const run = await this.runStore.find(message.runId);
    if (!run) {
      throw new RunnerJobPreflightError("Authenticated Runner job has no persisted D1 Run.");
    }
    if (!runStates.includes(run.state)) {
      throw new RunnerJobPreflightError("Persisted Runner job has an invalid Run state.");
    }
    if (
      run.id !== message.runId ||
      run.attemptId !== message.request.attemptId ||
      run.requestHash !== message.requestHash ||
      run.artifactBundleHash !== message.request.bundle.manifestHash
    ) {
      throw new RunnerJobPreflightError("Authenticated Runner job does not match its persisted D1 Run evidence.");
    }
    return run;
  }
}

function skipped(run) {
  return Object.freeze({
    action: "skip",
    reason: `run_${run.state}`,
    run,
    message: null,
    image: null,
    resolvedBundle: null,
  });
}
