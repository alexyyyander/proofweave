import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalVerificationReplayEvidence,
  normalizeVerificationReplayEvidence,
  verificationReplayEvidenceHash,
} from "../packages/protocol/verification-replay-evidence.mjs";
import { canonicalJson, sha256Canonical } from "../packages/protocol/canonical-json.mjs";

test("canonical fresh replay evidence binds one signed Runner result to its replay identity", async () => {
  const runnerResult = fixtureRunnerResult();
  const evidence = fixtureEvidence({ runnerResultHash: await sha256Canonical(runnerResult), runnerResult });
  const normalized = await normalizeVerificationReplayEvidence(evidence);

  assert.equal(normalized.runnerResult.jobId, "run:fresh-replay");
  assert.equal(normalized.runnerResult.artifacts.manifestHash, sha("a"));
  assert.equal(await verificationReplayEvidenceHash(normalized), await sha256Canonical(normalized));
  assert.equal(await canonicalVerificationReplayEvidence(normalized), canonicalJson(normalized));
});

test("fresh replay evidence refuses a result hash or Run binding mismatch", async () => {
  const runnerResult = fixtureRunnerResult();
  await assert.rejects(
    normalizeVerificationReplayEvidence(fixtureEvidence({ runnerResultHash: sha("f"), runnerResult })),
    /runnerResultHash does not match/,
  );
  await assert.rejects(
    normalizeVerificationReplayEvidence({
      ...fixtureEvidence({ runnerResultHash: await sha256Canonical(runnerResult), runnerResult }),
      runId: "run:other",
    }),
    /does not match its Run or Artifact Bundle/,
  );
});

function fixtureEvidence({ runnerResultHash, runnerResult }) {
  return {
    protocolVersion: "pw-verification-replay-evidence-v1",
    id: "verification-replay-evidence:fresh-replay",
    replayId: "verification-replay:fresh-replay",
    assignmentId: "assignment:fresh-replay",
    runId: "run:fresh-replay",
    artifactBundleHash: sha("a"),
    runnerResultHash,
    runnerResult,
    recordedAt: "2026-07-14T00:00:01Z",
  };
}

function fixtureRunnerResult() {
  return {
    protocolVersion: "pw-lean-runner-v1",
    jobId: "run:fresh-replay",
    attemptId: "attempt:fresh-replay",
    requestHash: sha("b"),
    runnerKeyId: "runner-key:fresh-replay",
    runnerSignature: base64Url(new Uint8Array(64)),
    status: "succeeded",
    exitCode: 0,
    startedAt: "2026-07-14T00:00:00Z",
    finishedAt: "2026-07-14T00:00:01Z",
    kernelStatus: "accepted",
    checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
    artifacts: { manifestHash: sha("a"), stdoutHash: sha("c"), stderrHash: sha("d") },
  };
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}

function base64Url(value) {
  const binary = String.fromCharCode(...value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
