import { runStates } from "../../packages/domain/run.mjs";
import { artifactBundleV2ProtocolVersion } from "../../packages/protocol/artifact-bundle.mjs";
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
 * Run is moved only into retryable `preparing` state while its workspace is
 * transferred. A failed transfer therefore cannot leave a false `running`
 * projection behind.
 */
export class RunnerJobPreflight {
  constructor({ runStore, bundleResolver, imageRegistry }) {
    if (!runStore || typeof runStore.find !== "function" || typeof runStore.prepare !== "function" || typeof runStore.start !== "function") {
      throw new TypeError("RunnerJobPreflight requires a Run store with find(), prepare(), and start().");
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
  async claimAuthenticatedMessage(message, { preparingAt }) {
    const normalizedMessage = await normalizeRunnerQueueMessage(message);
    const current = await this.requireMatchingRun(normalizedMessage);
    if (!["queued", "preparing"].includes(current.state)) {
      return skipped(current);
    }

    const image = this.imageRegistry.resolve(normalizedMessage.request);
    const resolvedBundle = await this.bundleResolver.resolve(normalizedMessage.request);
    if (resolvedBundle?.bundle?.protocolVersion !== artifactBundleV2ProtocolVersion) {
      throw new RunnerJobPreflightError("Only pw-artifact-bundle-v2 may be claimed for isolated execution.");
    }
    let preparing = current;
    if (current.state === "queued") {
      try {
        preparing = await this.runStore.prepare(normalizedMessage.runId, preparingAt);
      } catch (cause) {
        // Another Queue delivery may have begun transfer or cancelled the Run
        // while immutable evidence was being read. Preparing is retryable;
        // only a non-preparing state is a no-op for this delivery.
        const latest = await this.requireMatchingRun(normalizedMessage);
        if (latest.state !== "queued") return latest.state === "preparing"
          ? this.stage(preparingMessage(normalizedMessage, latest, image, resolvedBundle))
          : skipped(latest);
        throw new RunnerJobPreflightError("Runner Run could not begin workspace preparation.", { cause });
      }
    }
    if (preparing.state !== "preparing") {
      throw new RunnerJobPreflightError("Run store returned a non-preparing Run after workspace preparation began.");
    }
    return this.stage(preparingMessage(normalizedMessage, preparing, image, resolvedBundle));
  }

  async startAfterWorkspaceStaged(message, { startedAt }) {
    const normalizedMessage = await normalizeRunnerQueueMessage(message);
    const current = await this.requireMatchingRun(normalizedMessage);
    if (current.state !== "preparing") return skipped(current);
    let started;
    try {
      started = await this.runStore.start(normalizedMessage.runId, startedAt);
    } catch (cause) {
      const latest = await this.requireMatchingRun(normalizedMessage);
      if (latest.state !== "preparing") return skipped(latest);
      throw new RunnerJobPreflightError("Runner Run could not begin after workspace staging.", { cause });
    }
    if (started.state !== "running") {
      throw new RunnerJobPreflightError("Run store returned a non-running Run after workspace staging.");
    }
    return Object.freeze({ action: "execute", run: started, message: normalizedMessage });
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

  stage(value) {
    return Object.freeze({ action: "stage", ...value });
  }
}

function preparingMessage(message, run, image, resolvedBundle) {
  return { run, message, image, resolvedBundle };
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
