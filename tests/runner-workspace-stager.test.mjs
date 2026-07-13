import assert from "node:assert/strict";
import test from "node:test";
import { RunnerWorkspaceStager } from "../services/lean-runner/runner-workspace-stager.mjs";

test("workspace stager starts a Run only after private workspace transfer finalizes", async () => {
  const events = [];
  const run = { id: "run:workspace-stager", state: "preparing" };
  const stager = new RunnerWorkspaceStager({
    preflight: {
      async claimAuthenticatedMessage() {
        events.push("prepare");
        return { action: "stage", run, image: { imageDigest: "image" }, resolvedBundle: { bundle: {} } };
      },
      async startAfterWorkspaceStaged() {
        events.push("start");
        return { action: "execute", run: { ...run, state: "running" }, message: { runId: run.id } };
      },
    },
    workspaceTransfer: {
      async stage({ container }) {
        events.push("transfer");
        assert.equal(typeof container.fetch, "function");
        return { uploaded: ["sourceArchive", "sourcePatch", "lakeManifest"] };
      },
    },
    getContainer: async (runId) => {
      events.push(`container:${runId}`);
      return { fetch: async () => new Response(null, { status: 204 }) };
    },
  });

  const result = await stager.executeAuthenticatedMessage({ runId: run.id }, {
    preparingAt: "2026-07-13T00:00:01Z",
    startedAt: "2026-07-13T00:00:02Z",
  });
  assert.equal(result.action, "execute");
  assert.equal(result.run.state, "running");
  assert.deepEqual(events, ["prepare", "container:run:workspace-stager", "transfer", "start"]);
});

test("a transfer failure never starts the Run and remains retryable through preflight", async () => {
  let startCalls = 0;
  const stager = new RunnerWorkspaceStager({
    preflight: {
      async claimAuthenticatedMessage() {
        return { action: "stage", run: { id: "run:retry", state: "preparing" }, image: {}, resolvedBundle: {} };
      },
      async startAfterWorkspaceStaged() {
        startCalls += 1;
        return { action: "execute" };
      },
    },
    workspaceTransfer: { stage: async () => { throw new Error("interrupted transfer"); } },
    getContainer: async () => ({ fetch: async () => new Response(null, { status: 204 }) }),
  });

  await assert.rejects(
    stager.executeAuthenticatedMessage({ runId: "run:retry" }, {
      preparingAt: "2026-07-13T00:00:01Z",
      startedAt: "2026-07-13T00:00:02Z",
    }),
    /interrupted transfer/,
  );
  assert.equal(startCalls, 0);
});
