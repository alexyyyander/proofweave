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
  constructor({
    preflight,
    workspaceTransfer,
    getContainer,
    restageRunning = false,
    monotonicNow = () => performance.now(),
    observePhase = () => {},
  }) {
    if (!preflight || typeof preflight.claimAuthenticatedMessage !== "function" || typeof preflight.startAfterWorkspaceStaged !== "function") {
      throw new TypeError("RunnerWorkspaceStager requires a RunnerJobPreflight preparation boundary.");
    }
    if (!workspaceTransfer || typeof workspaceTransfer.stage !== "function") {
      throw new TypeError("RunnerWorkspaceStager requires a RunnerWorkspaceTransfer.");
    }
    if (typeof getContainer !== "function") {
      throw new TypeError("RunnerWorkspaceStager requires a private Container resolver.");
    }
    if (typeof restageRunning !== "boolean") {
      throw new TypeError("RunnerWorkspaceStager restageRunning must be boolean.");
    }
    if (restageRunning && typeof preflight.recoverRunningAuthenticatedMessage !== "function") {
      throw new TypeError("RunnerWorkspaceStager recovery requires a running-Run preflight boundary.");
    }
    if (typeof monotonicNow !== "function" || typeof observePhase !== "function") {
      throw new TypeError("RunnerWorkspaceStager requires clock and phase observation functions.");
    }
    this.preflight = preflight;
    this.workspaceTransfer = workspaceTransfer;
    this.getContainer = getContainer;
    this.restageRunning = restageRunning;
    this.monotonicNow = monotonicNow;
    this.observePhase = observePhase;
  }

  async executeAuthenticatedMessage(message, { preparingAt, startedAt }) {
    let prepared = await measurePhase({
      phase: "runner_preflight",
      monotonicNow: this.monotonicNow,
      observePhase: this.observePhase,
      operation: () => this.preflight.claimAuthenticatedMessage(message, { preparingAt }),
    });
    if (prepared.action === "skip" && prepared.run?.state === "running" && this.restageRunning) {
      prepared = await measurePhase({
        phase: "runner_recovery_preflight",
        monotonicNow: this.monotonicNow,
        observePhase: this.observePhase,
        operation: () => this.preflight.recoverRunningAuthenticatedMessage(message),
      });
    }
    if (prepared.action === "skip") return prepared;
    if (prepared.action !== "stage") {
      throw new RunnerWorkspaceStagerError("Runner preflight returned an unsupported workspace action.");
    }
    const container = await measurePhase({
      phase: "runner_sandbox_ready",
      monotonicNow: this.monotonicNow,
      observePhase: this.observePhase,
      operation: () => this.getContainer(prepared.run.id),
    });
    if (!container || typeof container.fetch !== "function") {
      throw new RunnerWorkspaceStagerError("Runner Container resolver returned no private fetch stub.");
    }
    const transfer = await measurePhase({
      phase: "runner_workspace_transfer",
      monotonicNow: this.monotonicNow,
      observePhase: this.observePhase,
      operation: () => this.workspaceTransfer.stage({
        run: prepared.run,
        resolvedBundle: prepared.resolvedBundle,
        container,
      }),
    });
    if (prepared.run.state === "running") {
      return Object.freeze({
        action: "execute",
        run: prepared.run,
        message: prepared.message,
        image: prepared.image,
        resolvedBundle: prepared.resolvedBundle,
        transfer,
        recovered: true,
      });
    }
    const started = await measurePhase({
      phase: "runner_start_transition",
      monotonicNow: this.monotonicNow,
      observePhase: this.observePhase,
      operation: () => this.preflight.startAfterWorkspaceStaged(message, {
        startedAt: typeof startedAt === "function" ? startedAt() : startedAt,
      }),
    });
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
      recovered: false,
    });
  }
}

async function measurePhase({ phase, monotonicNow, observePhase, operation }) {
  const started = safeMonotonic(monotonicNow);
  try {
    const result = await operation();
    safeMeasureAndObserve(observePhase, phase, started, monotonicNow, "completed");
    return result;
  } catch (error) {
    safeMeasureAndObserve(observePhase, phase, started, monotonicNow, "failed");
    throw error;
  }
}

function safeMeasureAndObserve(observer, phase, started, monotonicNow, outcome) {
  if (started === null) return;
  const ended = safeMonotonic(monotonicNow);
  if (ended === null) return;
  safeObserve(observer, phase, Math.max(0, Math.min(86_400_000, Math.round(ended - started))), outcome);
}

function safeMonotonic(monotonicNow) {
  try {
    const value = monotonicNow();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function safeObserve(observer, phase, durationMs, outcome) {
  try {
    const pending = observer(Object.freeze({ phase, durationMs, outcome }));
    if (pending && typeof pending.then === "function") Promise.resolve(pending).catch(() => {});
  } catch {
    // Optional phase telemetry never changes Run preparation.
  }
}
