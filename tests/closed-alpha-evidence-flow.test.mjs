import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { D1R2ArtifactStore } from "../services/artifacts/d1-r2-artifact-store.mjs";
import { D1RunStore } from "../services/lean-runner/d1-run-store.mjs";
import { D1R2RunnerOutputStore } from "../services/lean-runner/d1-r2-runner-output-store.mjs";
import { RunnerExecutionFinalizer } from "../services/lean-runner/runner-execution-finalizer.mjs";
import { RunnerExecutionResultSigner } from "../services/lean-runner/runner-execution-result-signer.mjs";
import { D1VerificationStore } from "../services/verification/d1-verification-store.mjs";
import { D1ContributionReceiptIssuerKeyStore } from "../services/receipts/d1-contribution-receipt-issuer-key-store.mjs";
import { D1ContributionReceiptStore } from "../services/receipts/d1-contribution-receipt-store.mjs";
import {
  artifactBundleSigningPayload,
  artifactBundleSigningPayloadHash,
} from "../packages/protocol/artifact-bundle.mjs";
import { canonicalJson } from "../packages/protocol/canonical-json.mjs";
import {
  verificationAttestationPayloadHash,
  verificationAttestationSigningPayload,
} from "../packages/protocol/verification-attestation.mjs";
import { verifyContributionReceiptSignature } from "../packages/protocol/contribution-receipt.mjs";

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
    artifacts.putObject({ bytes: "fresh workspace replay", filename: "bundle-reproducible.txt", contentType: "text/plain" }),
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
  const reviewInputs = [
    ["bundle_reproducible", "bob", reviewEvidence[0]],
    ["kernel_accepted", "bob", reviewEvidence[1]],
    ["project_accepted", "carol", reviewEvidence[2]],
  ];
  for (const [claimType, reviewer, evidence] of reviewInputs) {
    const assignmentId = `assignment:closed-alpha:${claimType}`;
    await verification.assign({
      id: assignmentId,
      artifactBundleManifestHash: staged.bundle.manifestHash,
      claimType,
      verifierPersonId: `person:${reviewer}`,
      assignedAt: "2026-07-13T00:00:05Z",
    });
    await verification.accept(assignmentId, `person:${reviewer}`, "2026-07-13T00:00:06Z");
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

  const issuerKeys = new D1ContributionReceiptIssuerKeyStore(database);
  await issuerKeys.registerInitial({
    id: "issuer:closed-alpha",
    publicKey: keys.issuer.publicKey,
    activatedAt: "2026-07-13T00:00:00Z",
  });
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
    [
      `INSERT INTO agent_attempts (
        id, person_id, problem_revision_id, agent_id, delegation_certificate_id,
        delegation_scope, agent_label, idempotency_key, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["attempt:closed-alpha", "person:alice", "revision:closed-alpha", "agent:alice-prover", "delegation:alice-prover", "prove", "Alice prover", "closed-alpha-attempt", "2026-07-13T00:00:00Z"],
    ],
    ["INSERT INTO runner_keys (id, public_key, fingerprint) VALUES (?, ?, ?)", ["runner-key:closed-alpha", fixtureKeys.runner.publicKey, sha("9")]],
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

async function signedBundle({ archive, patch, lakeManifest, keys: fixtureKeys }) {
  const bundle = {
    protocolVersion: "pw-artifact-bundle-v2",
    id: "bundle:closed-alpha-evidence-flow",
    attemptId: "attempt:closed-alpha",
    problemRevisionId: "revision:closed-alpha",
    target: { declaration: "Proofweave.ClosedAlpha.target", statementHash: sha("d") },
    workspace: {
      archive: { objectKey: archive.objectKey, contentHash: archive.contentHash, format: "tar.zst", maxExpandedBytes: 64 * 1024 * 1024, maxFileCount: 10_000, symlinkPolicy: "forbidden" },
      patch: { objectKey: patch.objectKey, contentHash: patch.contentHash, format: "unified-diff", strip: 1, allowFuzz: false },
      tree: { hash: sha("e"), algorithm: "pw-tree-v1", state: "after_patch_and_lake_manifest" },
      lakeManifest: { objectKey: lakeManifest.objectKey, contentHash: lakeManifest.contentHash, destination: "lake-manifest.json" },
    },
    environment: { leanToolchain: "leanprover/lean4:v4.27.0", mathlibRevision: "closed-alpha" },
    entryCommand: ["lake", "env", "lean", "Proofweave/ClosedAlpha.lean"],
    dependencyReceipts: [],
    agentEvent: {
      eventId: "agent-event:closed-alpha-evidence-flow",
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

async function signedAttestation({ claimType, assignmentId, artifactBundleHash, evidenceHash, reviewer, keys: fixtureKeys }) {
  const role = reviewer === "bob" ? "reviewer" : "curator";
  const attestation = {
    protocolVersion: "pw-verification-attestation-v1",
    id: `attestation:closed-alpha:${claimType}`,
    assignmentId,
    artifactBundleHash,
    claimType,
    verifierPersonId: `person:${reviewer}`,
    verifierAgentId: `agent:${reviewer}-${role}`,
    delegationCertificateId: `delegation:${reviewer}-${role}`,
    verifierAgentPublicKey: fixtureKeys[reviewer].publicKey,
    decision: "attested",
    evidenceHash,
    attestedAt: "2026-07-13T00:00:07Z",
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

function base64Url(value) {
  const binary = String.fromCharCode(...new Uint8Array(value));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
