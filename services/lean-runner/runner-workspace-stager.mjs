export class RunnerWorkspaceStagerError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RunnerWorkspaceStagerError";
  }
}

/**
 * Durable Queue executor for the preparation boundary. A transfer failure
 * leaves the D1 Run in `preparing`, so a later Queue delivery can re-send the
 * idempotent private ingress sequence. Only a successful finalization permits
 * the separate transition into `running`.
 */
export class RunnerWorkspaceStager {
  constructor({ preflight, workspaceTransfer, getContainer }) {
    if (!preflight || typeof preflight.claimAuthenticatedMessage !== "function" || typeof preflight.startAfterWorkspaceStaged !== "function") {
      throw new TypeError("RunnerWorkspaceStager requires a RunnerJobPreflight preparation boundary.");
    }
    if (!workspaceTransfer || typeof workspaceTransfer.stage !== "function") {
      throw new TypeError("RunnerWorkspaceStager requires a RunnerWorkspaceTransfer.");
    }
    if (typeof getContainer !== "function") {
      throw new TypeError("RunnerWorkspaceStager requires a private Container resolver.");
    }
    this.preflight = preflight;
    this.workspaceTransfer = workspaceTransfer;
    this.getContainer = getContainer;
  }

  async executeAuthenticatedMessage(message, { preparingAt, startedAt }) {
    const prepared = await this.preflight.claimAuthenticatedMessage(message, { preparingAt });
    if (prepared.action === "skip") return prepared;
    if (prepared.action !== "stage") {
      throw new RunnerWorkspaceStagerError("Runner preflight returned an unsupported workspace action.");
    }
    const container = await this.getContainer(prepared.run.id);
    if (!container || typeof container.fetch !== "function") {
      throw new RunnerWorkspaceStagerError("Runner Container resolver returned no private fetch stub.");
    }
    const transfer = await this.workspaceTransfer.stage({
      run: prepared.run,
      resolvedBundle: prepared.resolvedBundle,
      container,
    });
    const started = await this.preflight.startAfterWorkspaceStaged(message, { startedAt });
    if (started.action === "skip") return started;
    if (started.action !== "execute") {
      throw new RunnerWorkspaceStagerError("Runner preflight did not start after workspace finalization.");
    }
    return Object.freeze({
      action: "execute",
      run: started.run,
      message: started.message,
      image: prepared.image,
      resolvedBundle: prepared.resolvedBundle,
      transfer,
    });
  }
}
