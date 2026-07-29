import assert from "node:assert/strict";
import test from "node:test";
import { hasAcceptedKernelEvidence } from "../app/workbench/accepted-kernel-evidence.ts";

const accepted = {
  id: "run:accepted",
  attemptId: "attempt:one",
  artifactBundleHash: `sha256:${"a".repeat(64)}`,
  state: "succeeded",
  queuedAt: "2026-07-29T00:00:00Z",
  startedAt: "2026-07-29T00:00:01Z",
  finishedAt: "2026-07-29T00:00:02Z",
  runnerResultHash: `sha256:${"b".repeat(64)}`,
  evidenceState: "recorded",
  result: {
    resultHash: `sha256:${"b".repeat(64)}`,
    receivedAt: "2026-07-29T00:00:03Z",
    summary: {
      status: "succeeded",
      exitCode: 0,
      kernelStatus: "accepted",
      checks: {
        network: "passed",
        noSorry: "passed",
        allowedAxioms: "passed",
        leanBuild: "passed",
      },
    },
  },
};

test("accepts only a recorded successful Run with every Lean policy check", () => {
  assert.equal(hasAcceptedKernelEvidence(accepted), true);
});

test("does not present unreadable or unrecorded evidence as Lean accepted", () => {
  assert.equal(
    hasAcceptedKernelEvidence({ ...accepted, evidenceState: "unreadable" }),
    false,
  );
  assert.equal(
    hasAcceptedKernelEvidence({ ...accepted, evidenceState: "not_recorded" }),
    false,
  );
});

test("does not present failed lifecycle or summary state as Lean accepted", () => {
  assert.equal(
    hasAcceptedKernelEvidence({ ...accepted, state: "failed" }),
    false,
  );
  assert.equal(
    hasAcceptedKernelEvidence({
      ...accepted,
      result: {
        ...accepted.result,
        summary: { ...accepted.result.summary, status: "failed" },
      },
    }),
    false,
  );
});

test("does not present a failed network policy check as Lean accepted", () => {
  assert.equal(
    hasAcceptedKernelEvidence({
      ...accepted,
      result: {
        ...accepted.result,
        summary: {
          ...accepted.result.summary,
          checks: { ...accepted.result.summary.checks, network: "failed" },
        },
      },
    }),
    false,
  );
});
