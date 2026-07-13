import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zlib from "node:zlib";
import { Miniflare } from "miniflare";
import { D1R2ArtifactStore } from "../services/artifacts/d1-r2-artifact-store.mjs";
import { D1R2RunnerBundleResolver } from "../services/lean-runner/d1-r2-runner-bundle-resolver.mjs";
import { D1RunStore } from "../services/lean-runner/d1-run-store.mjs";
import { D1R2RunnerOutputStore } from "../services/lean-runner/d1-r2-runner-output-store.mjs";
import { RunnerContainerExecutionClient } from "../services/lean-runner/runner-container-execution-client.mjs";
import { RunnerExecutionFinalizer } from "../services/lean-runner/runner-execution-finalizer.mjs";
import { RunnerExecutionResultSigner } from "../services/lean-runner/runner-execution-result-signer.mjs";
import { PinnedRunnerImageRegistry } from "../services/lean-runner/runner-image-policy.mjs";
import { RunnerWorkspaceTransfer } from "../services/lean-runner/runner-workspace-transfer.mjs";
import { ContainerLeanExecutor } from "../services/lean-runner/container-lean-executor.mjs";
import { createContainerWorkspaceHttpHandler } from "../services/lean-runner/container-workspace-runtime.mjs";
import { D1VerificationStore } from "../services/verification/d1-verification-store.mjs";
import { D1R2VerificationReplayEvidenceStore } from "../services/verification/d1-r2-verification-replay-evidence-store.mjs";
import { D1ContributionReceiptIssuerKeyStore } from "../services/receipts/d1-contribution-receipt-issuer-key-store.mjs";
import { D1ContributionReceiptStore } from "../services/receipts/d1-contribution-receipt-store.mjs";
import {
  artifactBundleSigningPayload,
  artifactBundleSigningPayloadHash,
} from "../packages/protocol/artifact-bundle.mjs";
import { canonicalJson } from "../packages/protocol/canonical-json.mjs";
import { createLeanRunnerRequest, leanRunnerRequestHash } from "../packages/protocol/lean-runner.mjs";
import { runnerKeyFingerprint } from "../packages/protocol/runner-key-registry.mjs";
import {
  verificationAttestationPayloadHash,
  verificationAttestationSigningPayload,
} from "../packages/protocol/verification-attestation.mjs";
import { verifyContributionReceiptSignature } from "../packages/protocol/contribution-receipt.mjs";
import { workspaceTreeHash } from "../packages/protocol/workspace-tree.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
let miniflare;
let database;
let bucket;
let keys;

before(async () => {
  keys = await createKeyFixture();
  miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
    r2Buckets: ["ARTIFACTS"],
  });
  database = await miniflare.getD1Database("DB");
  bucket = await miniflare.getR2Bucket("ARTIFACTS");
  await applyMigrations(database);
  await seedDelegatedPeopleAndAttempt(database, keys);
  await seedLocalLeanAttempt(database);
});

after(async () => {
  await miniflare?.dispose();
});

test("a local evidence-chain fixture reaches a signed receipt without crossing trust boundaries", async () => {
  const artifacts = new D1R2ArtifactStore({ database, bucket });
  const archive = await artifacts.putObject({
    bytes: "closed-alpha fixture source archive",
    filename: "source.tar.zst",
    contentType: "application/zstd",
  });
  const patch = await artifacts.putObject({
    bytes: "diff --git a/Proofweave/Alpha.lean b/Proofweave/Alpha.lean\n",
    filename: "normalized.patch",
    contentType: "text/x-diff",
  });
  const lakeManifest = await artifacts.putObject({
    bytes: '{"packages":[]}',
    filename: "lake-manifest.json",
    contentType: "application/json",
  });
  const reviewEvidence = await Promise.all([
    artifacts.putObject({ bytes: "kernel accepted fixture", filename: "kernel-accepted.txt", contentType: "text/plain" }),
    artifacts.putObject({ bytes: "project acceptance fixture", filename: "project-accepted.txt", contentType: "text/plain" }),
  ]);
  const bundle = await signedBundle({ archive, patch, lakeManifest, keys });
  const staged = await artifacts.stageBundle(bundle);
  assert.equal(staged.created, true);
  assert.equal((await artifacts.loadBundleForDispatch(staged.bundle.manifestHash))?.bundle.id, bundle.id);

  const runStore = new D1RunStore(database);
  const queued = await runStore.queue({
    id: "run:closed-alpha-evidence-flow",
    attemptId: bundle.attemptId,
    idempotencyKey: "closed-alpha-evidence-flow",
    requestHash: sha("a"),
    artifactBundleHash: staged.bundle.manifestHash,
    queuedAt: "2026-07-13T00:00:01Z",
  });
  assert.equal(queued.created, true);
  await runStore.prepare(queued.run.id, "2026-07-13T00:00:02Z");
  const running = await runStore.start(queued.run.id, "2026-07-13T00:00:03Z");

  const stdout = new TextEncoder().encode("Lean fixture compiled without sorry.\n");
  const stderr = new Uint8Array();
  const execution = {
    result: {
      protocolVersion: "pw-lean-runner-v1",
      jobId: running.id,
      attemptId: running.attemptId,
      requestHash: running.requestHash,
      status: "succeeded",
      exitCode: 0,
      startedAt: "2026-07-13T00:00:03Z",
      finishedAt: "2026-07-13T00:00:04Z",
      kernelStatus: "accepted",
      checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
      artifacts: {
        manifestHash: staged.bundle.manifestHash,
        stdoutHash: await sha256Bytes(stdout),
        stderrHash: await sha256Bytes(stderr),
      },
    },
    stdout,
    stderr,
    outputTruncated: false,
    workspaceTreeHash: bundle.workspace.tree.hash,
  };
  const finalizer = new RunnerExecutionFinalizer({
    runStore,
    outputStore: new D1R2RunnerOutputStore({ database, bucket }),
    resultSigner: new RunnerExecutionResultSigner({
      runnerKeyId: "runner-key:closed-alpha",
      runnerPrivateKey: keys.runner.privateKey,
    }),
  });
  const finalized = await finalizer.finalize({
    runId: running.id,
    execution,
    receivedAt: "2026-07-13T00:00:04Z",
  });
  assert.equal(finalized.run.state, "succeeded");
  assert.equal(finalized.result.kernelStatus, "accepted");
  assert.equal(finalized.outputs.stdout.created, true);

  const verification = new D1VerificationStore(database);
  const replayAssignmentId = "assignment:closed-alpha:bundle_reproducible";
  await verification.assign({
    id: replayAssignmentId,
    artifactBundleManifestHash: staged.bundle.manifestHash,
    claimType: "bundle_reproducible",
    verifierPersonId: "person:bob",
    assignedAt: "2026-07-13T00:00:05Z",
  });
  await verification.accept(replayAssignmentId, "person:bob", "2026-07-13T00:00:06Z");
  const replayQueued = await runStore.queue({
    id: "run:closed-alpha-fresh-replay",
    attemptId: bundle.attemptId,
    idempotencyKey: "closed-alpha-fresh-replay",
    requestHash: sha("b"),
    artifactBundleHash: staged.bundle.manifestHash,
    queuedAt: "2026-07-13T00:00:07Z",
  });
  await database
    .prepare(
      `INSERT INTO verification_replays (
        id, assignment_id, run_id, artifact_bundle_manifest_hash,
        requester_person_id, requester_agent_id, delegation_certificate_id,
        agent_installation_id, idempotency_key, requested_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      "verification-replay:closed-alpha", replayAssignmentId, replayQueued.run.id, staged.bundle.manifestHash,
      "person:bob", "agent:bob-reviewer", "delegation:bob-reviewer",
      "installation:closed-alpha-bob-reviewer", "closed-alpha-fresh-workspace", "2026-07-13T00:00:07Z",
    )
    .run();
  await runStore.prepare(replayQueued.run.id, "2026-07-13T00:00:08Z");
  const replayRunning = await runStore.start(replayQueued.run.id, "2026-07-13T00:00:09Z");
  const replayExecution = {
    ...execution,
    result: {
      ...execution.result,
      jobId: replayRunning.id,
      requestHash: replayRunning.requestHash,
      startedAt: "2026-07-13T00:00:09Z",
      finishedAt: "2026-07-13T00:00:10Z",
    },
  };
  const replayFinalized = await new RunnerExecutionFinalizer({
    runStore,
    outputStore: new D1R2RunnerOutputStore({ database, bucket }),
    replayEvidenceStore: new D1R2VerificationReplayEvidenceStore({ database, bucket }),
    resultSigner: new RunnerExecutionResultSigner({
      runnerKeyId: "runner-key:closed-alpha",
      runnerPrivateKey: keys.runner.privateKey,
    }),
  }).finalize({
    runId: replayRunning.id,
    execution: replayExecution,
    receivedAt: "2026-07-13T00:00:10Z",
  });
  assert.equal(replayFinalized.run.state, "succeeded");
  assert.equal(replayFinalized.replayEvidence?.assignmentId, replayAssignmentId);
  assert.equal(replayFinalized.replayEvidence?.artifactBundleHash, staged.bundle.manifestHash);

  const reviewInputs = [
    ["bundle_reproducible", "bob", { contentHash: replayFinalized.replayEvidence.evidenceHash }, replayAssignmentId],
    ["kernel_accepted", "bob", reviewEvidence[0], "assignment:closed-alpha:kernel_accepted"],
    ["project_accepted", "carol", reviewEvidence[1], "assignment:closed-alpha:project_accepted"],
  ];
  for (const [claimType, reviewer, evidence, assignmentId] of reviewInputs) {
    if (assignmentId !== replayAssignmentId) {
      await verification.assign({
        id: assignmentId,
        artifactBundleManifestHash: staged.bundle.manifestHash,
        claimType,
        verifierPersonId: `person:${reviewer}`,
        assignedAt: "2026-07-13T00:00:05Z",
      });
      await verification.accept(assignmentId, `person:${reviewer}`, "2026-07-13T00:00:06Z");
    }
    const attestation = await signedAttestation({
      claimType,
      assignmentId,
      artifactBundleHash: staged.bundle.manifestHash,
      evidenceHash: evidence.contentHash,
      reviewer,
      keys,
    });
    const recorded = await verification.recordAttestation(attestation);
    assert.equal(recorded.created, true);
    assert.equal((await verification.listEvents(assignmentId)).at(-1)?.eventType, "attestation_recorded");
  }

  await ensureIssuerKey();
  const receipts = new D1ContributionReceiptStore(database);
  const input = {
    id: "receipt:closed-alpha-evidence-flow",
    kind: "lemma",
    artifactBundleManifestHash: staged.bundle.manifestHash,
    runId: finalized.run.id,
    issuedAt: "2026-07-13T00:00:08Z",
    issuerKeyId: "issuer:closed-alpha",
    issuerPublicKey: keys.issuer.publicKey,
    issuerPrivateKey: keys.issuer.privateKey,
  };
  const issued = await receipts.issue(input);
  const replayed = await receipts.issue(input);

  assert.equal(issued.created, true);
  assert.equal(replayed.created, false);
  assert.equal(issued.receipt.beneficiary.personId, "person:alice");
  assert.deepEqual(issued.receipt.claims.map((claim) => claim.claimType), [
    "bundle_reproducible",
    "kernel_accepted",
    "project_accepted",
  ]);
  assert.equal(await verifyContributionReceiptSignature(issued.receipt), true);
  assert.equal((await receipts.get(issued.receipt.id))?.run.resultHash, finalized.run.runnerResultHash);
  assert.deepEqual((await runStore.listEvents(finalized.run.id)).map((event) => event.eventType), [
    "run_queued",
    "workspace_preparation_started",
    "run_started",
    "runner_result_recorded",
  ]);
});

test("a local Lean fixture binds actual execution evidence into the signed receipt path", {
  skip: process.env.PROOFWEAVE_REQUIRE_LOCAL_LEAN !== "1"
    ? "set PROOFWEAVE_REQUIRE_LOCAL_LEAN=1 to run the local Lean evidence fixture"
    : typeof zlib.zstdCompressSync !== "function",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "proofweave-real-alpha-flow-"));
  try {
    const workspace = await createRealLeanWorkspaceFixture();
    const artifacts = new D1R2ArtifactStore({ database, bucket });
    const [archive, patch, lakeManifest] = await Promise.all([
      artifacts.putObject({ bytes: workspace.archive, filename: "source.tar.zst", contentType: "application/zstd" }),
      artifacts.putObject({ bytes: workspace.patch, filename: "normalized.patch", contentType: "text/x-diff; charset=utf-8" }),
      artifacts.putObject({ bytes: workspace.lakeManifest, filename: "lake-manifest.json", contentType: "application/json" }),
    ]);
    const bundle = await signedBundle({
      archive,
      patch,
      lakeManifest,
      keys,
      id: "bundle:closed-alpha-local-lean-flow",
      attemptId: "attempt:closed-alpha-local-lean",
      problemRevisionId: "revision:closed-alpha-local-lean",
      target: {
        declaration: "ProofweaveFixture.true_is_inhabited",
        statementHash: sha("c"),
      },
      workspace: {
        archive: {
          objectKey: archive.objectKey,
          contentHash: archive.contentHash,
          format: "tar.zst",
          maxExpandedBytes: 1024 * 1024,
          maxFileCount: 10,
          symlinkPolicy: "forbidden",
        },
        patch: {
          objectKey: patch.objectKey,
          contentHash: patch.contentHash,
          format: "unified-diff",
          strip: 1,
          allowFuzz: false,
        },
        tree: {
          hash: workspace.treeHash,
          algorithm: "pw-tree-v1",
          state: "after_patch_and_lake_manifest",
        },
        lakeManifest: {
          objectKey: lakeManifest.objectKey,
          contentHash: lakeManifest.contentHash,
          destination: "lake-manifest.json",
        },
      },
      environment: {
        leanToolchain: "leanprover/lean4:v4.30.0",
        mathlibRevision: "fixture-mathlib",
      },
      entryCommand: ["lake", "env", "lean", "ProofweaveFixture.lean"],
      eventId: "agent-event:closed-alpha-local-lean-flow",
    });
    const staged = await artifacts.stageBundle(bundle);
    assert.equal(staged.created, true);

    const imageDigest = `registry.cloudflare.com/proofweave/lean-runner@sha256:${"b".repeat(64)}`;
    const request = await createLeanRunnerRequest({
      jobId: "run:closed-alpha-local-lean-flow",
      idempotencyKey: "closed-alpha-local-lean-flow",
      artifactBundle: bundle,
      imageDigest,
      limits: {
        cpuSeconds: 10,
        wallSeconds: 30,
        memoryMiB: 512,
        diskMiB: 128,
        outputBytes: 1_000_000,
      },
    });
    assert.equal(request.bundle.manifestHash, staged.bundle.manifestHash);
    assert.equal(new PinnedRunnerImageRegistry({
      images: [{
        imageDigest,
        leanToolchain: request.environment.leanToolchain,
        mathlibRevision: request.environment.mathlibRevision,
      }],
    }).resolve(request).imageDigest, imageDigest);

    const resolvedBundle = await new D1R2RunnerBundleResolver({ database, bucket }).resolve(request);
    const runStore = new D1RunStore(database);
    const queued = await runStore.queue({
      id: request.jobId,
      attemptId: request.attemptId,
      idempotencyKey: request.idempotencyKey,
      requestHash: await leanRunnerRequestHash(request),
      artifactBundleHash: staged.bundle.manifestHash,
      queuedAt: "2026-07-13T00:00:01Z",
    });
    const preparing = await runStore.prepare(queued.run.id, "2026-07-13T00:00:02Z");
    let executionInstant = 4;
    const handler = createContainerWorkspaceHttpHandler({
      stagingRoot: join(root, "staging"),
      workspaceRoot: join(root, "workspaces"),
      executor: new ContainerLeanExecutor({
        networkIsolated: true,
        resourceLimitsEnforced: true,
        now: () => new Date(`2026-07-13T00:00:${String(executionInstant++).padStart(2, "0")}Z`),
      }),
    });
    const transfer = await new RunnerWorkspaceTransfer({ bucket }).stage({
      run: preparing,
      resolvedBundle,
      container: { fetch: handler },
    });
    assert.deepEqual(transfer.uploaded, ["sourceArchive", "sourcePatch", "lakeManifest"]);
    const running = await runStore.start(queued.run.id, "2026-07-13T00:00:03Z");
    const execution = await new RunnerContainerExecutionClient().execute({
      container: { fetch: handler },
      run: running,
      request,
    });
    assert.equal(execution.result.status, "succeeded");
    assert.equal(execution.result.kernelStatus, "accepted");
    assert.equal(execution.workspaceTreeHash, workspace.treeHash);
    assert.deepEqual(execution.result.checks, {
      network: "passed",
      noSorry: "passed",
      allowedAxioms: "passed",
      leanBuild: "passed",
    });
    assert.deepEqual(await readdir(join(root, "staging")), []);
    assert.deepEqual(await readdir(join(root, "workspaces")), []);

    const finalized = await new RunnerExecutionFinalizer({
      runStore,
      outputStore: new D1R2RunnerOutputStore({ database, bucket }),
      resultSigner: new RunnerExecutionResultSigner({
        runnerKeyId: "runner-key:closed-alpha",
        runnerPrivateKey: keys.runner.privateKey,
      }),
    }).finalize({
      runId: running.id,
      execution,
      receivedAt: "2026-07-13T00:00:06Z",
    });
    assert.equal(finalized.run.state, "succeeded");
    assert.equal(finalized.result.kernelStatus, "accepted");

    const verification = new D1VerificationStore(database);
    const replayAssignmentId = "assignment:closed-alpha-local-lean:bundle_reproducible";
    await verification.assign({
      id: replayAssignmentId,
      artifactBundleManifestHash: staged.bundle.manifestHash,
      claimType: "bundle_reproducible",
      verifierPersonId: "person:bob",
      assignedAt: "2026-07-13T00:00:07Z",
    });
    await verification.accept(replayAssignmentId, "person:bob", "2026-07-13T00:00:08Z");
    const replayRequest = await createLeanRunnerRequest({
      jobId: "run:closed-alpha-local-lean-fresh-replay",
      idempotencyKey: "closed-alpha-local-lean-fresh-replay",
      artifactBundle: bundle,
      imageDigest,
      limits: request.limits,
    });
    const replayQueued = await runStore.queue({
      id: replayRequest.jobId,
      attemptId: replayRequest.attemptId,
      idempotencyKey: replayRequest.idempotencyKey,
      requestHash: await leanRunnerRequestHash(replayRequest),
      artifactBundleHash: staged.bundle.manifestHash,
      queuedAt: "2026-07-13T00:00:09Z",
    });
    await database
      .prepare(
        `INSERT INTO verification_replays (
          id, assignment_id, run_id, artifact_bundle_manifest_hash,
          requester_person_id, requester_agent_id, delegation_certificate_id,
          agent_installation_id, idempotency_key, requested_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        "verification-replay:closed-alpha-local-lean", replayAssignmentId, replayQueued.run.id, staged.bundle.manifestHash,
        "person:bob", "agent:bob-reviewer", "delegation:bob-reviewer",
        "installation:closed-alpha-bob-reviewer", "closed-alpha-local-lean-fresh-workspace", "2026-07-13T00:00:09Z",
      )
      .run();
    const replayPreparing = await runStore.prepare(replayQueued.run.id, "2026-07-13T00:00:10Z");
    let replayExecutionInstant = 11;
    const replayHandler = createContainerWorkspaceHttpHandler({
      stagingRoot: join(root, "staging"),
      workspaceRoot: join(root, "workspaces"),
      executor: new ContainerLeanExecutor({
        networkIsolated: true,
        resourceLimitsEnforced: true,
        now: () => new Date(`2026-07-13T00:00:${String(replayExecutionInstant++).padStart(2, "0")}Z`),
      }),
    });
    await new RunnerWorkspaceTransfer({ bucket }).stage({
      run: replayPreparing,
      resolvedBundle,
      container: { fetch: replayHandler },
    });
    const replayRunning = await runStore.start(replayQueued.run.id, "2026-07-13T00:00:11Z");
    const replayExecution = await new RunnerContainerExecutionClient().execute({
      container: { fetch: replayHandler },
      run: replayRunning,
      request: replayRequest,
    });
    const replayFinalized = await new RunnerExecutionFinalizer({
      runStore,
      outputStore: new D1R2RunnerOutputStore({ database, bucket }),
      replayEvidenceStore: new D1R2VerificationReplayEvidenceStore({ database, bucket }),
      resultSigner: new RunnerExecutionResultSigner({
        runnerKeyId: "runner-key:closed-alpha",
        runnerPrivateKey: keys.runner.privateKey,
      }),
    }).finalize({
      runId: replayRunning.id,
      execution: replayExecution,
      receivedAt: "2026-07-13T00:00:13Z",
    });
    assert.equal(replayFinalized.replayEvidence?.assignmentId, replayAssignmentId);

    const reviewEvidence = await Promise.all([
      artifacts.putObject({ bytes: "fixture independent kernel inspection", filename: "local-kernel-accepted.txt", contentType: "text/plain" }),
      artifacts.putObject({ bytes: "fixture project acceptance", filename: "local-project-accepted.txt", contentType: "text/plain" }),
    ]);
    for (const [claimType, reviewer, evidence, assignmentId] of [
      ["bundle_reproducible", "bob", { contentHash: replayFinalized.replayEvidence.evidenceHash }, replayAssignmentId],
      ["kernel_accepted", "bob", reviewEvidence[0], "assignment:closed-alpha-local-lean:kernel_accepted"],
      ["project_accepted", "carol", reviewEvidence[1], "assignment:closed-alpha-local-lean:project_accepted"],
    ]) {
      if (assignmentId !== replayAssignmentId) await verification.assign({
        id: assignmentId,
        artifactBundleManifestHash: staged.bundle.manifestHash,
        claimType,
        verifierPersonId: `person:${reviewer}`,
        assignedAt: "2026-07-13T00:00:07Z",
      });
      await verification.accept(assignmentId, `person:${reviewer}`, "2026-07-13T00:00:08Z");
      const attestation = await signedAttestation({
        id: `attestation:closed-alpha-local-lean:${claimType}`,
        claimType,
        assignmentId,
        artifactBundleHash: staged.bundle.manifestHash,
        evidenceHash: evidence.contentHash,
        reviewer,
        keys,
        attestedAt: "2026-07-13T00:00:09Z",
      });
      assert.equal((await verification.recordAttestation(attestation)).created, true);
    }

    await ensureIssuerKey();
    const receipts = new D1ContributionReceiptStore(database);
    const issued = await receipts.issue({
      id: "receipt:closed-alpha-local-lean-flow",
      kind: "lemma",
      artifactBundleManifestHash: staged.bundle.manifestHash,
      runId: finalized.run.id,
      issuedAt: "2026-07-13T00:00:10Z",
      issuerKeyId: "issuer:closed-alpha",
      issuerPublicKey: keys.issuer.publicKey,
      issuerPrivateKey: keys.issuer.privateKey,
    });
    assert.equal(issued.created, true);
    assert.equal(await verifyContributionReceiptSignature(issued.receipt), true);
    assert.deepEqual(issued.receipt.claims.map((claim) => claim.claimType), [
      "bundle_reproducible",
      "kernel_accepted",
      "project_accepted",
    ]);
    assert.deepEqual((await runStore.listEvents(finalized.run.id)).map((event) => event.eventType), [
      "run_queued",
      "workspace_preparation_started",
      "run_started",
      "runner_result_recorded",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function createKeyFixture() {
  const [alice, bob, carol, runner, issuer] = await Promise.all(
    Array.from({ length: 5 }, () => crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])),
  );
  return Object.freeze({
    alice: await toKeyPair(alice),
    bob: await toKeyPair(bob),
    carol: await toKeyPair(carol),
    runner: await toKeyPair(runner),
    issuer: await toKeyPair(issuer),
  });
}

async function toKeyPair(pair) {
  return Object.freeze({
    privateKey: pair.privateKey,
    publicKey: base64Url(await crypto.subtle.exportKey("raw", pair.publicKey)),
  });
}

async function seedDelegatedPeopleAndAttempt(d1, fixtureKeys) {
  const people = ["alice", "bob", "carol"];
  const statements = [
    ...people.map((person) => [
      "INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)",
      [`person:${person}`, "proofweave", person, person[0].toUpperCase() + person.slice(1), "2026-07-13T00:00:00Z"],
    ]),
    [
      `INSERT INTO source_snapshots (
        id, upstream_name, source_url, revision_tag, revision_commit, retrieved_at,
        content_hash, manifest_hash, source_license, lean_toolchain, mathlib_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["snapshot:closed-alpha", "fixture", "https://example.test/source", "v1", "closed-alpha", "2026-07-13T00:00:00Z", sha("1"), sha("2"), "MIT", "leanprover/lean4:v4.27.0", "closed-alpha"],
    ],
    ["INSERT INTO projects (id, slug, kind, title, summary) VALUES (?, ?, ?, ?, ?)", ["project:closed-alpha", "closed-alpha", "frontier", "Closed alpha", "Evidence-flow fixture"]],
    [
      `INSERT INTO problem_revisions (
        id, project_id, source_snapshot_id, target_key, slug, revision_number,
        title, domain, research_status, informal_statement, lean_statement
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["revision:closed-alpha", "project:closed-alpha", "snapshot:closed-alpha", "closed-alpha-target", "closed-alpha-target", 1, "Closed alpha target", "logic", "research_open", "fixture", "theorem fixture : True := by trivial"],
    ],
    ...people.map((person) => [
      "INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)",
      [`person-key:${person}`, `person:${person}`, fixtureKeys[person].publicKey, sha(person === "alice" ? "3" : person === "bob" ? "4" : "5")],
    ]),
    ["INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)", ["agent:alice-prover", "person:alice", "Alice prover", fixtureKeys.alice.publicKey, sha("6")]],
    ["INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)", ["agent:bob-reviewer", "person:bob", "Bob reviewer", fixtureKeys.bob.publicKey, sha("7")]],
    ["INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)", ["agent:carol-curator", "person:carol", "Carol curator", fixtureKeys.carol.publicKey, sha("8")]],
    ...delegationStatements(fixtureKeys),
    ["INSERT INTO oauth_clients (id, client_name, redirect_uris_json) VALUES (?, ?, ?)", ["client:closed-alpha-reviewer", "Closed alpha reviewer", '["https://codex.example.test/callback"]']],
    [
      `INSERT INTO agent_installations (
        id, person_id, agent_id, delegation_certificate_id, client_id, label
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      ["installation:closed-alpha-bob-reviewer", "person:bob", "agent:bob-reviewer", "delegation:bob-reviewer", "client:closed-alpha-reviewer", "Closed alpha reviewer"],
    ],
    [
      `INSERT INTO agent_attempts (
        id, person_id, problem_revision_id, agent_id, delegation_certificate_id,
        delegation_scope, agent_label, idempotency_key, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["attempt:closed-alpha", "person:alice", "revision:closed-alpha", "agent:alice-prover", "delegation:alice-prover", "prove", "Alice prover", "closed-alpha-attempt", "2026-07-13T00:00:00Z"],
    ],
    ["INSERT INTO runner_keys (id, public_key, fingerprint) VALUES (?, ?, ?)", ["runner-key:closed-alpha", fixtureKeys.runner.publicKey, await runnerKeyFingerprint(fixtureKeys.runner.publicKey)]],
  ];
  for (const [statement, values] of statements) await d1.prepare(statement).bind(...values).run();
}

async function seedLocalLeanAttempt(d1) {
  const statements = [
    [
      `INSERT INTO source_snapshots (
        id, upstream_name, source_url, revision_tag, revision_commit, retrieved_at,
        content_hash, manifest_hash, source_license, lean_toolchain, mathlib_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["snapshot:closed-alpha-local-lean", "fixture", "https://example.test/local-lean", "v1", "local-lean", "2026-07-13T00:00:00Z", sha("f"), sha("e"), "MIT", "leanprover/lean4:v4.30.0", "fixture-mathlib"],
    ],
    [
      `INSERT INTO problem_revisions (
        id, project_id, source_snapshot_id, target_key, slug, revision_number,
        title, domain, research_status, informal_statement, lean_statement
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["revision:closed-alpha-local-lean", "project:closed-alpha", "snapshot:closed-alpha-local-lean", "local-lean-target", "local-lean-target", 1, "Local Lean target", "logic", "research_open", "fixture", "theorem true_is_inhabited : True := True.intro"],
    ],
    [
      `INSERT INTO agent_attempts (
        id, person_id, problem_revision_id, agent_id, delegation_certificate_id,
        delegation_scope, agent_label, idempotency_key, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["attempt:closed-alpha-local-lean", "person:alice", "revision:closed-alpha-local-lean", "agent:alice-prover", "delegation:alice-prover", "prove", "Alice prover", "closed-alpha-local-lean-attempt", "2026-07-13T00:00:00Z"],
    ],
  ];
  for (const [statement, values] of statements) await d1.prepare(statement).bind(...values).run();
}

function delegationStatements(fixtureKeys) {
  return [
    ["alice", "prover", "prove"],
    ["bob", "reviewer", "review"],
    ["carol", "curator", "review"],
  ].map(([person, role, scope]) => [
    `INSERT INTO delegation_certificates (
      id, owner_person_id, agent_id, person_key_id, agent_public_key,
      scopes_json, valid_from, valid_until, beneficiary_person_id,
      protocol_version, payload_hash, canonical_payload, person_signature
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `delegation:${person}-${role}`,
      `person:${person}`,
      `agent:${person}-${role}`,
      `person-key:${person}`,
      fixtureKeys[person].publicKey,
      JSON.stringify([scope]),
      "2026-07-01T00:00:00Z",
      "2027-07-01T00:00:00Z",
      `person:${person}`,
      "pw-delegation-v1",
      sha(person === "alice" ? "a" : person === "bob" ? "b" : "c"),
      "{}",
      "signature",
    ],
  ]);
}

async function signedBundle({
  archive,
  patch,
  lakeManifest,
  keys: fixtureKeys,
  id = "bundle:closed-alpha-evidence-flow",
  attemptId = "attempt:closed-alpha",
  problemRevisionId = "revision:closed-alpha",
  target = { declaration: "Proofweave.ClosedAlpha.target", statementHash: sha("d") },
  workspace = null,
  environment = { leanToolchain: "leanprover/lean4:v4.27.0", mathlibRevision: "closed-alpha" },
  entryCommand = ["lake", "env", "lean", "Proofweave/ClosedAlpha.lean"],
  eventId = "agent-event:closed-alpha-evidence-flow",
}) {
  const bundle = {
    protocolVersion: "pw-artifact-bundle-v2",
    id,
    attemptId,
    problemRevisionId,
    target,
    workspace: workspace ?? {
      archive: { objectKey: archive.objectKey, contentHash: archive.contentHash, format: "tar.zst", maxExpandedBytes: 64 * 1024 * 1024, maxFileCount: 10_000, symlinkPolicy: "forbidden" },
      patch: { objectKey: patch.objectKey, contentHash: patch.contentHash, format: "unified-diff", strip: 1, allowFuzz: false },
      tree: { hash: sha("e"), algorithm: "pw-tree-v1", state: "after_patch_and_lake_manifest" },
      lakeManifest: { objectKey: lakeManifest.objectKey, contentHash: lakeManifest.contentHash, destination: "lake-manifest.json" },
    },
    environment,
    entryCommand,
    dependencyReceipts: [],
    agentEvent: {
      eventId,
      occurredAt: "2026-07-13T00:00:00Z",
      payloadHash: sha("0"),
      agentPublicKey: fixtureKeys.alice.publicKey,
      signature: base64Url(new Uint8Array(64)),
    },
    policy: { requireNoSorry: true, allowedAxioms: [] },
  };
  bundle.agentEvent.payloadHash = await artifactBundleSigningPayloadHash(bundle);
  bundle.agentEvent.signature = base64Url(await crypto.subtle.sign(
    "Ed25519",
    fixtureKeys.alice.privateKey,
    new TextEncoder().encode(canonicalJson(artifactBundleSigningPayload(bundle))),
  ));
  return bundle;
}

async function signedAttestation({
  id = null,
  claimType,
  assignmentId,
  artifactBundleHash,
  evidenceHash,
  reviewer,
  keys: fixtureKeys,
  attestedAt = "2026-07-13T00:00:07Z",
}) {
  const role = reviewer === "bob" ? "reviewer" : "curator";
  const attestation = {
    protocolVersion: "pw-verification-attestation-v1",
    id: id ?? `attestation:closed-alpha:${claimType}`,
    assignmentId,
    artifactBundleHash,
    claimType,
    verifierPersonId: `person:${reviewer}`,
    verifierAgentId: `agent:${reviewer}-${role}`,
    delegationCertificateId: `delegation:${reviewer}-${role}`,
    verifierAgentPublicKey: fixtureKeys[reviewer].publicKey,
    decision: "attested",
    evidenceHash,
    attestedAt,
    payloadHash: sha("0"),
    signature: base64Url(new Uint8Array(64)),
  };
  attestation.payloadHash = await verificationAttestationPayloadHash(attestation);
  attestation.signature = base64Url(await crypto.subtle.sign(
    "Ed25519",
    fixtureKeys[reviewer].privateKey,
    new TextEncoder().encode(canonicalJson(verificationAttestationSigningPayload(attestation))),
  ));
  return attestation;
}

async function ensureIssuerKey() {
  const existing = await database
    .prepare("SELECT id, public_key FROM contribution_receipt_issuer_keys WHERE id = ?")
    .bind("issuer:closed-alpha")
    .first();
  if (existing) {
    assert.equal(existing.public_key, keys.issuer.publicKey);
    return;
  }
  await new D1ContributionReceiptIssuerKeyStore(database).registerInitial({
    id: "issuer:closed-alpha",
    publicKey: keys.issuer.publicKey,
    activatedAt: "2026-07-13T00:00:00Z",
  });
}

async function createRealLeanWorkspaceFixture() {
  const fixtureRoot = new URL("./fixtures/lean/core-success/", import.meta.url);
  const finalSource = await readFile(new URL("ProofweaveFixture.lean", fixtureRoot));
  const initialSource = Buffer.from(finalSource.toString("utf8").replace(
    "theorem true_is_inhabited : True := True.intro",
    "theorem true_is_inhabited : True := by\n  trivial",
  ));
  const lakefile = await readFile(new URL("lakefile.toml", fixtureRoot));
  const leanToolchain = await readFile(new URL("lean-toolchain", fixtureRoot));
  const lakeManifest = await readFile(new URL("lake-manifest.json", fixtureRoot));
  const archive = zlib.zstdCompressSync(makeTar([
    { path: "ProofweaveFixture.lean", contents: initialSource },
    { path: "lakefile.toml", contents: lakefile },
    { path: "lean-toolchain", contents: leanToolchain },
    { path: "lake-manifest.json", contents: Buffer.from("{\"placeholder\":true}\n") },
  ]));
  const patch = Buffer.from([
    "diff --git a/ProofweaveFixture.lean b/ProofweaveFixture.lean",
    "index 1111111..2222222 100644",
    "--- a/ProofweaveFixture.lean",
    "+++ b/ProofweaveFixture.lean",
    "@@ -1,6 +1,5 @@",
    " namespace ProofweaveFixture",
    " ",
    "-theorem true_is_inhabited : True := by",
    "-  trivial",
    "+theorem true_is_inhabited : True := True.intro",
    " ",
    " theorem natural_addition_commutes (left right : Nat) : left + right = right + left :=",
    "",
  ].join("\n"));
  const treeHash = await workspaceTreeHash([
    { path: "ProofweaveFixture.lean", mode: 0o644, contentHash: hash(finalSource) },
    { path: "lake-manifest.json", mode: 0o644, contentHash: hash(lakeManifest) },
    { path: "lakefile.toml", mode: 0o644, contentHash: hash(lakefile) },
    { path: "lean-toolchain", mode: 0o644, contentHash: hash(leanToolchain) },
  ]);
  return { archive, patch, lakeManifest, treeHash };
}

async function applyMigrations(d1) {
  const filenames = (await readdir(migrationsRoot)).filter((filename) => filename.endsWith(".sql")).sort();
  for (const filename of filenames) {
    const source = await readFile(new URL(filename, migrationsRoot), "utf8");
    for (const statement of source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await d1.prepare(statement).run();
    }
  }
}

async function sha256Bytes(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}

function hash(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function makeTar(entries) {
  const blocks = [];
  for (const entry of entries) {
    const contents = Buffer.from(entry.contents);
    const header = Buffer.alloc(512);
    writeTarString(header, 0, 100, entry.path);
    writeTarOctal(header, 100, 8, 0o644);
    writeTarOctal(header, 108, 8, 0);
    writeTarOctal(header, 116, 8, 0);
    writeTarOctal(header, 124, 12, contents.length);
    writeTarOctal(header, 136, 12, 0);
    header.fill(32, 148, 156);
    header[156] = "0".charCodeAt(0);
    writeTarString(header, 257, 6, "ustar");
    writeTarString(header, 263, 2, "00");
    const checksum = header.reduce((total, byte) => total + byte, 0);
    writeTarString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
    blocks.push(header, contents);
    const padding = (512 - (contents.length % 512)) % 512;
    if (padding) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function writeTarString(target, offset, length, value) {
  const bytes = Buffer.from(value, "ascii");
  if (bytes.length > length) throw new Error("Tar fixture field is too long.");
  bytes.copy(target, offset);
}

function writeTarOctal(target, offset, length, value) {
  writeTarString(target, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
}

function base64Url(value) {
  const binary = String.fromCharCode(...new Uint8Array(value));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
