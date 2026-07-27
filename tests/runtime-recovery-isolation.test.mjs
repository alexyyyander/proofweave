import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  runtimeRecoveryIsolationKeyFingerprint,
  runtimeRecoveryIsolationProtocolVersion,
  verifyRuntimeRecoveryIsolationEvidence,
} from "../packages/protocol/runtime-recovery-isolation.mjs";
import {
  expectedGithubRecoverySurfaces,
  inspectRuntimeRecoveryIsolationAtDrillBegin,
  scanGithubRecoverySurfaces,
} from "../scripts/lib/github-recovery-surface-inspector.mjs";

const repositoryFullName = "proofweave/research";
const releaseSha = "c".repeat(40);
const releaseFingerprint = `sha256:${"d".repeat(64)}`;
const observedAt = "2026-07-28T02:00:00.000Z";
const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

test("scanner deterministically covers exactly the reviewed production queue consumers", async () => {
  const first = await scanGithubRecoverySurfaces({ repoRoot });
  const second = await scanGithubRecoverySurfaces({ repoRoot });
  assert.equal(first.hash, second.hash);
  assert.deepEqual(
    first.workflows.map(({ path: workflowPath, role }) => ({ path: workflowPath, role })),
    Object.entries(expectedGithubRecoverySurfaces)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([workflowPath, role]) => ({ path: workflowPath, role })),
  );
  assert.deepEqual(first.workflows, second.workflows);
});

test("scanner fails closed for an unknown queue-consuming workflow", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "proofweave-recovery-surfaces-"));
  try {
    const workflowDirectory = path.join(temporaryRoot, ".github", "workflows");
    await mkdir(workflowDirectory, { recursive: true });
    for (const workflowPath of Object.keys(expectedGithubRecoverySurfaces)) {
      const source = await readFile(path.join(repoRoot, workflowPath));
      await writeFile(path.join(temporaryRoot, workflowPath), source);
    }
    await writeFile(
      path.join(workflowDirectory, "unreviewed-consumer.yml"),
      "name: Unreviewed\njobs:\n  consume:\n    steps:\n      - run: npm run runner:trusted:once\n",
    );
    await assert.rejects(
      scanGithubRecoverySurfaces({ repoRoot: temporaryRoot }),
      (error) => error?.code === "UNKNOWN_QUEUE_CONSUMER",
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("scanner fails closed for an unknown secret-bearing consumer wrapper", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "proofweave-recovery-wrapper-"));
  try {
    const workflowDirectory = path.join(temporaryRoot, ".github", "workflows");
    await mkdir(workflowDirectory, { recursive: true });
    for (const workflowPath of Object.keys(expectedGithubRecoverySurfaces)) {
      const source = await readFile(path.join(repoRoot, workflowPath));
      await writeFile(path.join(temporaryRoot, workflowPath), source);
    }
    await writeFile(
      path.join(workflowDirectory, "unreviewed-wrapper.yml"),
      [
        "name: Unreviewed wrapper",
        "jobs:",
        "  consume:",
        "    env:",
        "      TURSO_DATABASE_URL: ${{ secrets.TURSO_DATABASE_URL }}",
        "      TURSO_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}",
        "      RUNNER_RESULT_PRIVATE_KEY_JWK: ${{ secrets.RUNNER_RESULT_PRIVATE_KEY_JWK }}",
        "    steps:",
        "      - run: ./private-consumer-wrapper",
        "",
      ].join("\n"),
    );
    await assert.rejects(
      scanGithubRecoverySurfaces({ repoRoot: temporaryRoot }),
      (error) => error?.code === "UNKNOWN_QUEUE_CONSUMER",
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("begin inspector signs a complete disabled-and-idle GitHub observation", async () => {
  const fixture = await createFixture();
  const evidence = await inspect(fixture);
  assert.equal(evidence.protocolVersion, runtimeRecoveryIsolationProtocolVersion);
  assert.equal(evidence.productionEligible, false, "injected fetch/time/filesystem fixtures must never claim production");
  assert.equal(evidence.githubObservation.repositoryId, 4242);
  assert.equal(evidence.githubObservation.repositoryFullName, repositoryFullName);
  assert.ok(evidence.githubObservation.workflows.every((workflow) =>
    workflow.state === "disabled_manually"
    && Object.values(workflow.activeRuns).every((count) => count === 0)
  ));
  assert.ok(!JSON.stringify(evidence).includes(fixture.token));
  const trustedOperatorKeys = [{
    keyId: evidence.operatorAttestation.keyId,
    publicKey: evidence.operatorAttestation.publicKey,
    keyFingerprint: evidence.operatorAttestation.keyFingerprint,
  }];
  const verification = await verifyRuntimeRecoveryIsolationEvidence(evidence, {
    trustedOperatorKeys,
    now: new Date("2026-07-28T02:30:00.000Z"),
    expectedReleaseSha: releaseSha,
    expectedReleaseFingerprint: releaseFingerprint,
    expectedCorrelationId: "drill:fixture-01",
  });
  assert.equal(verification.valid, true);
  assert.equal(verification.productionEligible, false);
  assert.equal(
    evidence.operatorAttestation.keyFingerprint,
    await runtimeRecoveryIsolationKeyFingerprint(evidence.operatorAttestation.publicKey),
  );
});

test("begin inspector rejects an enabled workflow", async () => {
  const fixture = await createFixture({ workflowState: "active" });
  await assert.rejects(inspect(fixture), (error) => (
    error?.code === "RECOVERY_WORKFLOW_ENABLED"
    && !error.message.includes(fixture.token)
  ));
});

test("begin inspector rejects every active workflow state", async () => {
  const fixture = await createFixture({ activeState: "queued" });
  await assert.rejects(
    inspect(fixture),
    (error) => error?.code === "ACTIVE_RECOVERY_RUN",
  );
});

test("begin inspector fails closed on GitHub 403 without leaking credentials", async () => {
  const fixture = await createFixture({ forbidden: true });
  await assert.rejects(inspect(fixture), (error) => (
    error?.code === "GITHUB_ACCESS_DENIED"
    && !error.message.includes(fixture.token)
    && !error.message.includes("https://")
  ));
});

test("begin inspector fails closed on malformed GitHub data", async () => {
  const fixture = await createFixture({ malformed: true });
  await assert.rejects(
    inspect(fixture),
    (error) => error?.code === "MALFORMED_GITHUB_RESPONSE",
  );
});

test("begin inspector rejects release-source byte tampering", async () => {
  const fixture = await createFixture({ sourceTamper: true });
  await assert.rejects(
    inspect(fixture),
    (error) => error?.code === "WORKFLOW_SOURCE_MISMATCH",
  );
});

test("offline verifier detects signed-payload tampering", async () => {
  const fixture = await createFixture();
  const evidence = await inspect(fixture);
  const tampered = structuredClone(evidence);
  tampered.release.fingerprint = `sha256:${"e".repeat(64)}`;
  const verification = await verifyRuntimeRecoveryIsolationEvidence(tampered, {
    trustedOperatorKeys: trustedKeys(evidence),
    now: new Date("2026-07-28T02:30:00.000Z"),
  });
  assert.equal(verification.valid, false);
  assert.equal(verification.productionEligible, false);
  assert.equal(verification.reason, "payload_hash_mismatch");
});

test("offline verifier rejects evidence after its bounded TTL", async () => {
  const fixture = await createFixture();
  const evidence = await inspect(fixture);
  const verification = await verifyRuntimeRecoveryIsolationEvidence(evidence, {
    trustedOperatorKeys: trustedKeys(evidence),
    now: new Date("2026-07-28T04:00:00.001Z"),
  });
  assert.equal(verification.valid, false);
  assert.equal(verification.reason, "evidence_expired");
});

test("inspector is begin-only", async () => {
  const fixture = await createFixture();
  await assert.rejects(
    inspectRuntimeRecoveryIsolationAtDrillBegin({
      ...(await inspectionOptions(fixture)),
      phase: "end",
    }),
    (error) => error?.code === "BEGIN_ONLY",
  );
});

async function createFixture({
  workflowState = "disabled_manually",
  activeState = null,
  forbidden = false,
  malformed = false,
  sourceTamper = false,
} = {}) {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const operatorPrivateKeyJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const sources = Object.fromEntries(await Promise.all(
    Object.keys(expectedGithubRecoverySurfaces).map(async (workflowPath) => [
      workflowPath,
      await readFile(path.join(repoRoot, workflowPath)),
    ]),
  ));
  const token = "github-fixture-token-never-output";
  return {
    token,
    operatorPrivateKeyJwk,
    fetchImpl: createFakeGithubFetch({
      token,
      sources,
      workflowState,
      activeState,
      forbidden,
      malformed,
      sourceTamper,
    }),
  };
}

async function inspect(fixture) {
  return inspectRuntimeRecoveryIsolationAtDrillBegin(await inspectionOptions(fixture));
}

async function inspectionOptions(fixture) {
  return {
    phase: "begin",
    githubToken: fixture.token,
    repositoryFullName,
    releaseSha,
    releaseFingerprint,
    correlationId: "drill:fixture-01",
    operatorPrivateKeyJwk: fixture.operatorPrivateKeyJwk,
    operatorKeyId: "release-operator:fixture-01",
    ttlMilliseconds: 2 * 60 * 60 * 1_000,
    fetchImpl: fixture.fetchImpl,
    repoRoot,
    now: new Date(observedAt),
  };
}

function trustedKeys(evidence) {
  return [{
    keyId: evidence.operatorAttestation.keyId,
    publicKey: evidence.operatorAttestation.publicKey,
    keyFingerprint: evidence.operatorAttestation.keyFingerprint,
  }];
}

function createFakeGithubFetch({
  token,
  sources,
  workflowState,
  activeState,
  forbidden,
  malformed,
  sourceTamper,
}) {
  const workflows = Object.keys(expectedGithubRecoverySurfaces)
    .sort()
    .map((workflowPath, index) => ({
      id: 700 + index,
      path: workflowPath,
      state: workflowState,
    }));
  return async (input, init) => {
    assert.equal(init?.headers?.Authorization, `Bearer ${token}`);
    assert.equal(init?.headers?.["X-GitHub-Api-Version"], "2022-11-28");
    if (forbidden) return response({ message: "credential detail must be ignored" }, 403);
    const url = new URL(input);
    if (url.pathname === `/repos/${repositoryFullName}`) {
      return response(malformed ? { id: "not-an-integer" } : {
        id: 4242,
        full_name: repositoryFullName,
      });
    }
    if (url.pathname === `/repos/${repositoryFullName}/actions/workflows`) {
      return response({ total_count: workflows.length, workflows });
    }
    const contentPrefix = `/repos/${repositoryFullName}/contents/`;
    if (url.pathname.startsWith(contentPrefix)) {
      const workflowPath = decodeURIComponent(url.pathname.slice(contentPrefix.length));
      const source = sourceTamper
        ? Buffer.concat([sources[workflowPath], Buffer.from("\n# tampered\n")])
        : sources[workflowPath];
      assert.equal(url.searchParams.get("ref"), releaseSha);
      return response({
        path: workflowPath,
        sha: workflowPath.includes("build-week") ? "a".repeat(40) : "b".repeat(40),
        encoding: "base64",
        content: source.toString("base64"),
      });
    }
    const runMatch = url.pathname.match(new RegExp(
      `^/repos/${repositoryFullName}/actions/workflows/(\\d+)/runs$`,
    ));
    if (runMatch) {
      const status = url.searchParams.get("status");
      const count = status === activeState ? 1 : 0;
      return response({
        total_count: count,
        workflow_runs: count ? [{ id: 999, status }] : [],
      });
    }
    throw new Error("Unexpected fake GitHub URL.");
  };
}

function response(body, status = 200) {
  return {
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}
