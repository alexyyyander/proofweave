import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { delegationPayloadHash, delegationSigningPayload } from "../packages/domain/delegation.mjs";
import { canonicalJson } from "../packages/protocol/canonical-json.mjs";
import { personKeyProofChallengeSigningPayload } from "../packages/protocol/person-key-proof.mjs";
import {
  artifactBundleHash,
  canonicalArtifactBundle,
} from "../packages/protocol/artifact-bundle.mjs";
import {
  contributionReceiptHash,
  createContributionReceipt,
} from "../packages/protocol/contribution-receipt.mjs";
import { createContributionReceiptLifecycleEvent } from "../packages/protocol/contribution-receipt-lifecycle.mjs";
import { D1VerificationStore } from "../services/verification/d1-verification-store.mjs";

const repositoryRoot = new URL("../", import.meta.url);
const migrationsRoot = new URL("../drizzle/", import.meta.url);
const workerRoot = new URL("../dist/server/", import.meta.url);
let miniflare;
let database;
let bucket;
let signedReceiptFixture;
let controlledEvidenceFixture;

before(async () => {
  const entrypoint = fileURLToPath(new URL("index.js", workerRoot));
  const modules = await listJavaScriptModules(workerRoot);

  miniflare = new Miniflare({
    modules: [
      { type: "ESModule", path: entrypoint },
      ...modules
        .filter((modulePath) => modulePath !== entrypoint)
        .map((modulePath) => ({ type: "ESModule", path: modulePath })),
    ],
    modulesRoot: fileURLToPath(workerRoot),
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    r2Buckets: ["ARTIFACTS"],
    serviceBindings: {
      ASSETS: async () => new Response("Not found", { status: 404 }),
    },
  });
  database = await miniflare.getD1Database("DB");
  bucket = await miniflare.getR2Bucket("ARTIFACTS");
  await applyMigrations(database);
});

after(async () => {
  await miniflare?.dispose();
});

async function render(pathname = "/", init = {}) {
  return miniflare.dispatchFetch(
    `http://localhost${pathname}`,
    {
      ...init,
      headers: { accept: "text/html", ...(init.headers ?? {}) },
    },
  );
}

async function applyMigrations(d1, onlySeed = false) {
  const filenames = (await readdir(migrationsRoot))
    .filter((filename) => filename.endsWith(".sql"))
    .filter((filename) => !onlySeed || filename.includes("seed_formal_conjectures"))
    .sort();

  for (const filename of filenames) {
    const migration = await readFile(new URL(filename, migrationsRoot), "utf8");
    const statements = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await d1.prepare(statement).run();
    }
  }
}

async function insertSignedReceiptFixture() {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const issuerPublicKey = Buffer.from(
    await crypto.subtle.exportKey("raw", keyPair.publicKey),
  ).toString("base64url");
  const hash = (character) => `sha256:${character.repeat(64)}`;
  const baseReceipt = {
    protocolVersion: "pw-contribution-receipt-v1",
    beneficiary: {
      personId: "person:fixture-owner",
      agentId: "agent:fixture-prover",
      delegationCertificateId: "delegation:fixture-prover",
    },
    attempt: {
      id: "attempt:fixture-public",
      personId: "person:fixture-owner",
      agentId: "agent:fixture-prover",
      delegationCertificateId: "delegation:fixture-prover",
      problemRevisionId: "revision:fixture-public",
    },
    target: { declaration: "Fixture.PublicLemma", statementHash: hash("a") },
    artifactBundleHash: hash("b"),
    run: {
      id: "run:fixture-public",
      requestHash: hash("c"),
      resultHash: hash("d"),
      status: "succeeded",
      kernelStatus: "accepted",
    },
    claims: [
      fixtureClaim("bundle_reproducible", "attestation:fixture-bundle", "agent:fixture-reviewer", "delegation:fixture-reviewer", hash("b"), hash("e")),
      fixtureClaim("kernel_accepted", "attestation:fixture-kernel", "agent:fixture-reviewer", "delegation:fixture-reviewer", hash("b"), hash("f")),
      fixtureClaim("project_accepted", "attestation:fixture-project", "agent:fixture-curator", "delegation:fixture-curator", hash("b"), hash("0")),
    ],
    policyVersion: "pw-receipt-policy-v1",
    issuerKeyId: "issuer:fixture",
    issuerPublicKey,
  };
  const upstreamReceipt = await createContributionReceipt({
    receipt: {
      ...baseReceipt,
      id: "receipt:upstream-public-fixture",
      kind: "formalization",
      bundle: { manifestHash: hash("b"), dependencyReceipts: [] },
      issuedAt: "2026-07-12T23:59:00Z",
    },
    issuerPrivateKey: keyPair.privateKey,
  });
  const upstreamReceiptHash = await contributionReceiptHash(upstreamReceipt);
  const receipt = await createContributionReceipt({
    receipt: {
      ...baseReceipt,
      id: "receipt:public-fixture",
      kind: "lemma",
      bundle: {
        manifestHash: hash("b"),
        dependencyReceipts: [{ receiptId: upstreamReceipt.id, receiptHash: upstreamReceiptHash }],
      },
      issuedAt: "2026-07-13T00:00:00Z",
    },
    issuerPrivateKey: keyPair.privateKey,
  });
  const receiptHash = await contributionReceiptHash(receipt);
  const lifecycleEvent = await createContributionReceiptLifecycleEvent({
    event: {
      protocolVersion: "pw-contribution-receipt-lifecycle-event-v1",
      id: "receipt-event:public-fixture-retracted",
      receiptId: receipt.id,
      eventType: "retracted",
      reasonHash: hash("9"),
      occurredAt: "2026-07-13T00:01:00Z",
      issuerKeyId: receipt.issuerKeyId,
      issuerPublicKey: receipt.issuerPublicKey,
    },
    issuerPrivateKey: keyPair.privateKey,
  });

  await seedReceiptEvidenceFixture({ receipt, receiptHash, upstreamReceipt, upstreamReceiptHash, lifecycleEvent, hash });

  return { receipt, receiptHash, upstreamReceipt, upstreamReceiptHash, lifecycleEvent };
}

async function getSignedReceiptFixture() {
  signedReceiptFixture ??= insertSignedReceiptFixture();
  return signedReceiptFixture;
}

async function getControlledEvidenceFixture() {
  controlledEvidenceFixture ??= insertControlledEvidenceFixture();
  return controlledEvidenceFixture;
}

async function insertControlledEvidenceFixture() {
  const now = "2026-07-13T02:00:00Z";
  const ownerHeaders = {
    "oai-authenticated-user-email": "evidence-owner@example.test",
    "oai-authenticated-user-full-name": "Evidence%20Owner",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
  const reviewerHeaders = {
    "oai-authenticated-user-email": "evidence-reviewer@example.test",
    "oai-authenticated-user-full-name": "Evidence%20Reviewer",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
  const ownerProfile = await render("/api/me/delegation", { headers: ownerHeaders });
  const reviewerProfile = await render("/api/me/delegation", { headers: reviewerHeaders });
  const { profile: owner } = await ownerProfile.json();
  const { profile: reviewer } = await reviewerProfile.json();
  const archive = await putEvidenceObject("archive fixture bytes", "source.tar.zst", "application/zstd");
  const patch = await putEvidenceObject("--- a/Proofweave/Evidence.lean\n+++ b/Proofweave/Evidence.lean\n", "normalized.patch", "text/plain; charset=utf-8");
  const lakeManifest = await putEvidenceObject('{"packages":[]}', "lake-manifest.json", "application/json");
  const hash = (character) => `sha256:${character.repeat(64)}`;
  const bundle = {
    protocolVersion: "pw-artifact-bundle-v1",
    id: "bundle:controlled-evidence",
    attemptId: "attempt:controlled-evidence",
    problemRevisionId: "revision:controlled-evidence",
    target: { declaration: "Proofweave.Evidence.target", statementHash: hash("a") },
    source: {
      archiveKey: archive.objectKey,
      archiveHash: archive.contentHash,
      treeHash: hash("b"),
      patchKey: patch.objectKey,
      patchHash: patch.contentHash,
    },
    environment: {
      leanToolchain: "leanprover/lean4:v4.27.0",
      lakeManifestKey: lakeManifest.objectKey,
      lakeManifestHash: lakeManifest.contentHash,
      mathlibRevision: "fixture-evidence",
    },
    entryCommand: ["lake", "env", "lean", "Proofweave/Evidence.lean"],
    dependencyReceipts: [],
    agentEvent: {
      eventId: "agent-event:controlled-evidence",
      occurredAt: now,
      payloadHash: hash("c"),
      agentPublicKey: base64Url(crypto.getRandomValues(new Uint8Array(32))),
      signature: base64Url(crypto.getRandomValues(new Uint8Array(64))),
    },
    policy: { requireNoSorry: true, allowedAxioms: [] },
  };
  const canonicalManifest = canonicalArtifactBundle(bundle);
  const manifestHash = await artifactBundleHash(bundle);
  const manifest = await putEvidenceObject(canonicalManifest, "bundle.json", "application/json", manifestHash);
  const stdout = await putRunnerOutput("kernel accepted\n", "stdout");
  const stderr = await putRunnerOutput("", "stderr");

  const rows = [
    [
      `INSERT INTO source_snapshots (
        id, upstream_name, source_url, revision_tag, revision_commit, retrieved_at,
        content_hash, manifest_hash, source_license, lean_toolchain, mathlib_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["snapshot:controlled-evidence", "fixture", "https://example.test/evidence", "v1", "evidence-fixture", now, hash("d"), hash("e"), "MIT", "leanprover/lean4:v4.27.0", "fixture-evidence"],
    ],
    ["INSERT INTO projects (id, slug, kind, title, summary) VALUES (?, ?, ?, ?, ?)", ["project:controlled-evidence", "controlled-evidence", "frontier", "Controlled evidence", "Fixture project"]],
    [
      `INSERT INTO problem_revisions (
        id, project_id, source_snapshot_id, target_key, slug, revision_number,
        title, domain, research_status, informal_statement, lean_statement
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["revision:controlled-evidence", "project:controlled-evidence", "snapshot:controlled-evidence", "Proofweave.Evidence.target", "controlled-evidence-target", 1, "Controlled evidence target", "logic", "research_open", "fixture", "theorem target : True := by trivial"],
    ],
    [
      `INSERT INTO agent_attempts (
        id, person_id, problem_revision_id, agent_label, status, idempotency_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["attempt:controlled-evidence", owner.person.id, "revision:controlled-evidence", "Controlled evidence Agent", "submitted", "controlled-evidence-attempt", now, now],
    ],
    [
      `INSERT INTO artifact_bundles (
        id, attempt_id, problem_revision_id, manifest_hash, manifest_key,
        canonical_manifest, agent_event_id, agent_event_payload_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [bundle.id, bundle.attemptId, bundle.problemRevisionId, manifest.contentHash, manifest.objectKey, canonicalManifest, bundle.agentEvent.eventId, bundle.agentEvent.payloadHash],
    ],
    [
      `INSERT INTO runs (
        id, attempt_id, artifact_bundle_hash, request_hash, idempotency_key, state,
        queued_at, started_at, finished_at, runner_result_hash, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["run:controlled-evidence", bundle.attemptId, manifest.contentHash, hash("f"), "controlled-evidence-run", "succeeded", now, now, now, hash("0"), now],
    ],
    ["INSERT INTO run_results (run_id, result_hash, canonical_result, received_at) VALUES (?, ?, ?, ?)", ["run:controlled-evidence", hash("0"), '{"status":"succeeded","kernelStatus":"accepted"}', now]],
    ["INSERT INTO runner_output_artifacts (id, run_id, role, content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?, ?, ?, ?)", ["runner-output:controlled-evidence:stdout", "run:controlled-evidence", "stdout", stdout.contentHash, stdout.objectKey, stdout.byteLength, stdout.contentType]],
    ["INSERT INTO runner_output_artifacts (id, run_id, role, content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?, ?, ?, ?)", ["runner-output:controlled-evidence:stderr", "run:controlled-evidence", "stderr", stderr.contentHash, stderr.objectKey, stderr.byteLength, stderr.contentType]],
    [
      `INSERT INTO verification_assignments (
        id, artifact_bundle_manifest_hash, claim_type, attempt_owner_person_id,
        verifier_person_id, status, assigned_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["assignment:controlled-evidence", manifest.contentHash, "kernel_accepted", owner.person.id, reviewer.person.id, "assigned", now, now],
    ],
  ];
  for (const [query, bindings] of rows) await database.prepare(query).bind(...bindings).run();
  return { ownerHeaders, reviewerHeaders, owner, reviewer, attemptId: bundle.attemptId, manifestHash: manifest.contentHash };
}

async function putEvidenceObject(value, filename, contentType, expectedHash = null) {
  const bytes = new TextEncoder().encode(value);
  const contentHash = await sha256Bytes(bytes);
  assert.equal(expectedHash ?? contentHash, contentHash);
  const objectKey = `bundles/sha256/${contentHash.slice("sha256:".length)}/${filename}`;
  await bucket.put(objectKey, bytes, { httpMetadata: { contentType }, customMetadata: { sha256: contentHash } });
  await database.prepare("INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)").bind(contentHash, objectKey, bytes.byteLength, contentType).run();
  return { contentHash, objectKey, byteLength: bytes.byteLength, contentType };
}

async function putRunnerOutput(value, role) {
  const bytes = new TextEncoder().encode(value);
  const contentHash = await sha256Bytes(bytes);
  const objectKey = `runner-results/sha256/${contentHash.slice("sha256:".length)}/${role}.log`;
  const contentType = "text/plain; charset=utf-8";
  await bucket.put(objectKey, bytes, { httpMetadata: { contentType }, customMetadata: { sha256: contentHash } });
  return { contentHash, objectKey, byteLength: bytes.byteLength, contentType };
}

async function insertPublicDelegationFixture() {
  const now = "2026-07-13T00:00:00Z";
  const ownerKeys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const agentKeys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const ownerPublicKey = base64Url(await crypto.subtle.exportKey("raw", ownerKeys.publicKey));
  const agentPublicKey = base64Url(await crypto.subtle.exportKey("raw", agentKeys.publicKey));
  const certificate = {
    id: "delegation:public-fixture",
    ownerPersonId: "person:public-delegation",
    agentId: "agent:public-delegation",
    agentPublicKey,
    scopes: ["prove", "formalize"],
    validFrom: "2026-01-01T00:00:00Z",
    validUntil: "2027-01-01T00:00:00Z",
    attributionPolicy: {
      beneficiaryPersonId: "person:public-delegation",
      mode: "agent_delegated",
    },
  };
  const canonicalPayload = canonicalJson(delegationSigningPayload(certificate));
  const personSignature = base64Url(
    await crypto.subtle.sign(
      "Ed25519",
      ownerKeys.privateKey,
      new TextEncoder().encode(canonicalPayload),
    ),
  );
  const payloadHash = await delegationPayloadHash(certificate);

  const rows = [
    [
      "INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)",
      [certificate.ownerPersonId, "proofweave", "public-delegation", "Private fixture display name", now],
    ],
    [
      "INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)",
      ["person-key:public-delegation", certificate.ownerPersonId, ownerPublicKey, "sha256:public-delegation-key"],
    ],
    [
      "INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)",
      [certificate.agentId, certificate.ownerPersonId, "Private fixture agent label", agentPublicKey, "sha256:public-delegation-agent-key"],
    ],
    [
      `INSERT INTO delegation_certificates (
        id, owner_person_id, agent_id, person_key_id, agent_public_key, scopes_json,
        valid_from, valid_until, beneficiary_person_id, protocol_version, payload_hash,
        canonical_payload, person_signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        certificate.id, certificate.ownerPersonId, certificate.agentId,
        "person-key:public-delegation", certificate.agentPublicKey,
        JSON.stringify(["formalize", "prove"]), certificate.validFrom,
        certificate.validUntil, certificate.attributionPolicy.beneficiaryPersonId,
        "pw-delegation-v1", payloadHash, canonicalPayload, personSignature,
      ],
    ],
  ];

  for (const [query, bindings] of rows) {
    await database.prepare(query).bind(...bindings).run();
  }
  return { certificate, canonicalPayload, ownerPublicKey, payloadHash, personSignature };
}

async function seedReceiptEvidenceFixture({ receipt, receiptHash, upstreamReceipt, upstreamReceiptHash, lifecycleEvent, hash }) {
  const now = "2026-07-13T00:00:00Z";
  const rows = [
    [
      `INSERT INTO source_snapshots (
        id, upstream_name, source_url, revision_tag, revision_commit, retrieved_at,
        content_hash, manifest_hash, source_license, lean_toolchain, mathlib_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["snapshot:fixture-public", "fixture", "https://example.test/fixture", "v1", "fixture-public", now, hash("1"), hash("2"), "MIT", "leanprover/lean4:v4.27.0", "fixture"],
    ],
    ["INSERT INTO projects (id, slug, kind, title, summary) VALUES (?, ?, ?, ?, ?)", ["project:fixture-public", "fixture-public", "frontier", "Fixture", "Fixture"]],
    [
      `INSERT INTO problem_revisions (
        id, project_id, source_snapshot_id, target_key, slug, revision_number,
        title, domain, research_status, informal_statement, lean_statement
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [receipt.attempt.problemRevisionId, "project:fixture-public", "snapshot:fixture-public", "fixture-target", "fixture-target", 1, "Fixture target", "logic", "research_open", "fixture", "theorem public_fixture : True := by trivial"],
    ],
    ["INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)", [receipt.beneficiary.personId, "proofweave", "fixture-owner", "Fixture owner", now]],
    ["INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)", ["person-key:fixture-owner", receipt.beneficiary.personId, "fixture-person-key", hash("3")]],
    ["INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)", [receipt.beneficiary.agentId, receipt.beneficiary.personId, "Fixture prover", "fixture-agent-key", hash("4")]],
    [
      `INSERT INTO delegation_certificates (
        id, owner_person_id, agent_id, person_key_id, agent_public_key, scopes_json,
        valid_from, valid_until, beneficiary_person_id, protocol_version, payload_hash,
        canonical_payload, person_signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [receipt.beneficiary.delegationCertificateId, receipt.beneficiary.personId, receipt.beneficiary.agentId, "person-key:fixture-owner", "fixture-agent-key", '["formalize","prove"]', now, "2027-07-13T00:00:00Z", receipt.beneficiary.personId, "pw-delegation-v1", hash("5"), "{}", "fixture-signature"],
    ],
    [
      `INSERT INTO agent_attempts (
        id, person_id, problem_revision_id, agent_id, delegation_certificate_id,
        agent_label, status, idempotency_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [receipt.attempt.id, receipt.attempt.personId, receipt.attempt.problemRevisionId, receipt.attempt.agentId, receipt.attempt.delegationCertificateId, "Fixture prover", "active", "fixture-attempt", now, now],
    ],
    ["INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)", [receipt.artifactBundleHash, "bundles/fixture-public.json", 1, "application/json"]],
    [
      `INSERT INTO artifact_bundles (
        id, attempt_id, problem_revision_id, manifest_hash, manifest_key,
        canonical_manifest, agent_event_id, agent_event_payload_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["bundle:fixture-public", receipt.attempt.id, receipt.attempt.problemRevisionId, receipt.artifactBundleHash, "bundles/fixture-public.json", "{}", "agent-event:fixture-public", hash("6")],
    ],
    [
      `INSERT INTO runs (
        id, attempt_id, artifact_bundle_hash, request_hash, idempotency_key, state,
        queued_at, finished_at, runner_result_hash, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [receipt.run.id, receipt.attempt.id, receipt.artifactBundleHash, receipt.run.requestHash, "fixture-run", "succeeded", now, now, receipt.run.resultHash, now],
    ],
    ["INSERT INTO run_results (run_id, result_hash, canonical_result, received_at) VALUES (?, ?, ?, ?)", [receipt.run.id, receipt.run.resultHash, "{}", now]],
  ];

  for (const [query, bindings] of rows) {
    await database.prepare(query).bind(...bindings).run();
  }
  for (const [record, recordHash] of [[upstreamReceipt, upstreamReceiptHash], [receipt, receiptHash]]) {
    await database
      .prepare(
        `INSERT INTO contribution_receipts (
          id, kind, beneficiary_person_id, beneficiary_agent_id,
          beneficiary_delegation_certificate_id, attempt_id, problem_revision_id,
          artifact_bundle_manifest_hash, run_id, receipt_hash, canonical_receipt,
          payload_hash, issuer_key_id, issuer_public_key, issuer_signature, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.id, record.kind, record.beneficiary.personId, record.beneficiary.agentId,
        record.beneficiary.delegationCertificateId, record.attempt.id,
        record.attempt.problemRevisionId, record.artifactBundleHash, record.run.id,
        recordHash, canonicalJson(record), record.payloadHash, record.issuerKeyId,
        record.issuerPublicKey, record.issuerSignature, record.issuedAt,
      )
      .run();
  }
  await database
    .prepare(
      `INSERT INTO contribution_receipt_dependency_edges (
        downstream_receipt_id, upstream_receipt_id, upstream_receipt_hash,
        declared_by_bundle_manifest_hash, recorded_at
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      receipt.id, upstreamReceipt.id, upstreamReceiptHash,
      receipt.artifactBundleHash, receipt.issuedAt,
    )
    .run();
  await database
    .prepare(
      `INSERT INTO contribution_receipt_lifecycle_events (
        id, receipt_id, event_type, replacement_receipt_id, reason_hash,
        occurred_at, issuer_key_id, issuer_public_key, canonical_payload,
        payload_hash, issuer_signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      lifecycleEvent.id, lifecycleEvent.receiptId, lifecycleEvent.eventType,
      lifecycleEvent.replacementReceiptId, lifecycleEvent.reasonHash,
      lifecycleEvent.occurredAt, lifecycleEvent.issuerKeyId,
      lifecycleEvent.issuerPublicKey, canonicalJson(lifecycleEvent),
      lifecycleEvent.payloadHash, lifecycleEvent.issuerSignature,
    )
    .run();
}

function fixtureClaim(
  claimType,
  verificationAttestationId,
  reviewerAgentId,
  reviewerDelegationCertificateId,
  artifactBundleHash,
  verificationAttestationHash,
) {
  return {
    claimType,
    verificationAttestationId,
    verificationAttestationHash,
    artifactBundleHash,
    reviewerPersonId: "person:fixture-reviewer",
    reviewerAgentId,
    reviewerDelegationCertificateId,
    decision: "attested",
  };
}

async function listJavaScriptModules(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedModules = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isDirectory()) {
        return listJavaScriptModules(new URL(`${entry.name}/`, directory));
      }

      return entry.name.endsWith(".js")
        ? [fileURLToPath(new URL(entry.name, directory))]
        : [];
    }),
  );

  return nestedModules.flat();
}

test("server-renders the Proofweave welcome page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(
    html,
    /<title>Proofweave — Advance mathematics through your agent<\/title>/i,
  );
  assert.match(html, /Advance mathematics through your agent/i);
  assert.match(html, /Explore open mathematics/i);
  assert.match(html, /Contribution receipt/i);
});

test("serves the public research paths", async () => {
  const expectedPageContent = new Map([
    ["/explore", /Frontier mathematics, made inspectable/i],
    ["/explore/erdos-865", /Erdős Problem 865/i],
    ["/how-it-works", /Participation is personal\. Verification is public/i],
    ["/workbench", /Your research agent/i],
    ["/integrations", /Connect your research agent without sharing a secret/i],
    ["/receipt/abc-l1", /Receipt not issued/i],
    ["/delegations/abc-l1", /Delegation not found/i],
  ]);

  for (const [pathname, expectedContent] of expectedPageContent) {
    const response = await render(pathname);
    assert.equal(response.status, 200, `${pathname} should respond with 200`);
    assert.match(
      await response.text(),
      expectedContent,
      `${pathname} should render its heading`,
    );
  }

  const detail = await render("/explore/erdos-865");
  const detailHtml = await detail.text();
  assert.match(detailHtml, /Open an accountable Attempt/i);
  assert.match(detailHtml, /workbench\?target=erdos-865#attempt-queue/i);
});

test("does not present a receipt preview as signed public evidence", async () => {
  const response = await render("/api/receipts/abc-l1");
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: { code: "not_found", message: "Contribution Receipt not found." },
  });
  const dependencies = await render("/api/receipts/abc-l1/dependencies");
  assert.equal(dependencies.status, 404);
  assert.deepEqual(await dependencies.json(), {
    error: { code: "not_found", message: "Contribution Receipt not found." },
  });
  const lifecycle = await render("/api/receipts/abc-l1/lifecycle");
  assert.equal(lifecycle.status, 404);
  assert.deepEqual(await lifecycle.json(), {
    error: { code: "not_found", message: "Contribution Receipt not found." },
  });
});

test("imports the pinned catalog idempotently and serves provenance through the API", async () => {
  await applyMigrations(database, true);

  const counts = await database
    .prepare(
      "SELECT (SELECT COUNT(*) FROM problem_revisions) AS problems, (SELECT COUNT(*) FROM verification_claims) AS claims, (SELECT COUNT(*) FROM catalog_imports) AS imports",
    )
    .first();
  assert.deepEqual(counts, { problems: 4, claims: 20, imports: 1 });

  const catalogResponse = await render("/api/catalog");
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.equal(catalog.records.length, 4);
  assert.equal(catalog.records[0].slug, "erdos-865");
  assert.equal(catalog.records[0].source.revisionTag, "bench-v1-lean4.27.0");
  assert.equal(catalog.records[0].source.leanToolchain, "leanprover/lean4:v4.27.0");
  assert.equal(catalog.records[0].claims.length, 5);
  assert.ok(catalog.records[0].displayStatuses.includes("No Proofweave attestation"));

  const recordResponse = await render("/api/catalog/erdos-865");
  assert.equal(recordResponse.status, 200);
  const { record } = await recordResponse.json();
  assert.equal(record.declaration.qualifiedName, "Erdos865.erdos_865");
  assert.match(record.declaration.sourceContentHash, /^sha256:[a-f0-9]{64}$/);
});

test("renders only a hash-checked, issuer-signed receipt from D1", async () => {
  const { receipt, receiptHash, upstreamReceipt, upstreamReceiptHash, lifecycleEvent } = await getSignedReceiptFixture();

  const response = await render(`/api/receipts/${receipt.id}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /immutable/i);
  assert.deepEqual(await response.json(), { receipt, receiptHash });

  const page = await render(`/receipt/${receipt.id}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Reusable lemma/i);
  assert.match(html, new RegExp(receiptHash));
  assert.match(html, /Open verified JSON/i);
  assert.match(html, /Upstream evidence used by this contribution/i);
  assert.match(html, new RegExp(upstreamReceipt.target.declaration));
  assert.match(html, /Open dependency JSON/i);
  assert.match(html, /This receipt was retracted; the original evidence remains inspectable/i);
  assert.match(html, /Open lifecycle JSON/i);

  const index = await render("/api/receipts");
  assert.equal(index.status, 200);
  assert.match(index.headers.get("cache-control") ?? "", /max-age=120/i);
  assert.doesNotMatch(index.headers.get("cache-control") ?? "", /immutable/i);
  const indexBody = await index.json();
  assert.deepEqual(indexBody.receipts.map((entry) => [entry.id, entry.lifecycleStatus]), [
    [receipt.id, "retracted"],
    [upstreamReceipt.id, "issued"],
  ]);
  const indexPage = await render("/receipts");
  assert.equal(indexPage.status, 200);
  assert.match(await indexPage.text(), /Verified contributions, not activity counts/i);

  const dependencies = await render(`/api/receipts/${receipt.id}/dependencies`);
  assert.equal(dependencies.status, 200);
  assert.match(dependencies.headers.get("cache-control") ?? "", /immutable/i);
  assert.deepEqual(await dependencies.json(), {
    receiptId: receipt.id,
    dependencies: [{
      receiptId: upstreamReceipt.id,
      receiptHash: upstreamReceiptHash,
      kind: upstreamReceipt.kind,
      target: upstreamReceipt.target,
      issuedAt: upstreamReceipt.issuedAt,
      recordedAt: receipt.issuedAt,
    }],
  });

  const lifecycle = await render(`/api/receipts/${receipt.id}/lifecycle`);
  assert.equal(lifecycle.status, 200);
  assert.match(lifecycle.headers.get("cache-control") ?? "", /immutable/i);
  assert.deepEqual(await lifecycle.json(), {
    receiptId: receipt.id,
    events: [lifecycleEvent],
  });
});

test("scopes closed-alpha review assignments to the assigned Person and preserves decisions", async () => {
  const { receipt } = await getSignedReceiptFixture();
  const reviewerHeaders = {
    "oai-authenticated-user-email": "reviewer@example.test",
    "oai-authenticated-user-full-name": "Review%20Person",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
  const profileResponse = await render("/api/me/delegation", { headers: reviewerHeaders });
  assert.equal(profileResponse.status, 200);
  const { profile } = await profileResponse.json();

  await new D1VerificationStore(database).assign({
    id: "assignment:rendered-review",
    artifactBundleManifestHash: receipt.artifactBundleHash,
    claimType: "kernel_accepted",
    verifierPersonId: profile.person.id,
    assignedAt: "2026-07-13T00:00:00Z",
  });

  assert.equal((await render("/api/me/review-assignments")).status, 401);
  const listResponse = await render("/api/me/review-assignments", { headers: reviewerHeaders });
  assert.equal(listResponse.status, 200);
  const { assignments } = await listResponse.json();
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].id, "assignment:rendered-review");
  assert.equal(assignments[0].attempt.id, receipt.attempt.id);
  assert.doesNotMatch(JSON.stringify(assignments[0]), /person:fixture-owner|Fixture owner/i);

  const detailResponse = await render("/api/me/review-assignments/assignment:rendered-review", { headers: reviewerHeaders });
  assert.equal(detailResponse.status, 200);
  const { review: detail } = await detailResponse.json();
  assert.deepEqual(detail.events.map((event) => event.eventType), ["assignment_created"]);

  const page = await render("/reviews", { headers: reviewerHeaders });
  assert.equal(page.status, 200);
  const pageHtml = await page.text();
  assert.match(pageHtml, /Review another person’s evidence\./i);
  assert.match(pageHtml, /View audit trail/i);

  const acceptResponse = await render("/api/me/review-assignments/assignment:rendered-review/accept", {
    method: "POST",
    headers: reviewerHeaders,
  });
  assert.equal(acceptResponse.status, 200);
  const { review: accepted } = await acceptResponse.json();
  assert.equal(accepted.assignment.status, "accepted");
  assert.deepEqual(accepted.events.map((event) => event.eventType), ["assignment_created", "assignment_accepted"]);

  const repeatedAccept = await render("/api/me/review-assignments/assignment:rendered-review/accept", {
    method: "POST",
    headers: reviewerHeaders,
  });
  assert.equal(repeatedAccept.status, 200);
  assert.equal((await repeatedAccept.json()).review.assignment.status, "accepted");

  const declineAfterAccept = await render("/api/me/review-assignments/assignment:rendered-review/decline", {
    method: "POST",
    headers: reviewerHeaders,
  });
  assert.equal(declineAfterAccept.status, 409);

  const otherPersonHeaders = {
    "oai-authenticated-user-email": "other-reviewer@example.test",
  };
  const hiddenFromOtherPerson = await render("/api/me/review-assignments/assignment:rendered-review", { headers: otherPersonHeaders });
  assert.equal(hiddenFromOtherPerson.status, 404);
});

test("limits Bundle and Runner evidence to the Attempt owner or assigned reviewer", async () => {
  const fixture = await getControlledEvidenceFixture();
  assert.equal((await render(`/api/me/evidence/bundles/${encodeURIComponent(fixture.manifestHash)}`)).status, 401);

  const ownerRecord = await render(`/api/me/evidence/bundles/${encodeURIComponent(fixture.manifestHash)}`, { headers: fixture.ownerHeaders });
  assert.equal(ownerRecord.status, 200);
  assert.match(ownerRecord.headers.get("cache-control") ?? "", /private, no-store/i);
  const { evidence: ownerEvidence } = await ownerRecord.json();
  assert.equal(ownerEvidence.summary.accessRole, "attempt_owner");
  assert.equal(ownerEvidence.bundle.manifestHash, fixture.manifestHash);
  assert.deepEqual(ownerEvidence.bundle.artifacts.map((artifact) => artifact.id), ["bundle-manifest", "sourceArchive", "sourcePatch", "lakeManifest"]);
  assert.deepEqual(ownerEvidence.runs[0].outputs.map((artifact) => artifact.id), [
    "run:run:controlled-evidence:stderr",
    "run:run:controlled-evidence:stdout",
  ]);
  assert.doesNotMatch(JSON.stringify(ownerEvidence), new RegExp(fixture.owner.person.id));

  const ownerIndex = await render("/evidence", { headers: fixture.ownerHeaders });
  assert.equal(ownerIndex.status, 200);
  assert.match(await ownerIndex.text(), /Your Attempt/i);

  const ownerPatch = await render(`/api/me/evidence/bundles/${encodeURIComponent(fixture.manifestHash)}/artifacts/sourcePatch`, { headers: fixture.ownerHeaders });
  assert.equal(ownerPatch.status, 200);
  assert.match(ownerPatch.headers.get("content-disposition") ?? "", /normalized\.patch/i);
  assert.match(ownerPatch.headers.get("cache-control") ?? "", /private, no-store/i);
  assert.equal(await ownerPatch.text(), "--- a/Proofweave/Evidence.lean\n+++ b/Proofweave/Evidence.lean\n");

  const reviewerRecord = await render(`/api/me/evidence/bundles/${encodeURIComponent(fixture.manifestHash)}`, { headers: fixture.reviewerHeaders });
  assert.equal(reviewerRecord.status, 200);
  const { evidence: reviewerEvidence } = await reviewerRecord.json();
  assert.equal(reviewerEvidence.summary.accessRole, "assigned_reviewer");
  assert.doesNotMatch(JSON.stringify(reviewerEvidence), new RegExp(fixture.owner.person.id));
  assert.doesNotMatch(JSON.stringify(reviewerEvidence), /Evidence Owner/i);
  const reviewerIndex = await render("/evidence", { headers: fixture.reviewerHeaders });
  assert.equal(reviewerIndex.status, 200);
  const reviewerIndexHtml = await reviewerIndex.text();
  assert.match(reviewerIndexHtml, /Assigned independent review/i);
  assert.doesNotMatch(reviewerIndexHtml, /Evidence Owner/i);
  const reviewerLog = await render(`/api/me/evidence/bundles/${encodeURIComponent(fixture.manifestHash)}/artifacts/${encodeURIComponent("run:run:controlled-evidence:stdout")}`, { headers: fixture.reviewerHeaders });
  assert.equal(reviewerLog.status, 200);
  assert.equal(await reviewerLog.text(), "kernel accepted\n");

  const reviewerPage = await render(`/evidence/${encodeURIComponent(fixture.manifestHash)}`, { headers: fixture.reviewerHeaders });
  assert.equal(reviewerPage.status, 200);
  const reviewerHtml = await reviewerPage.text();
  assert.match(reviewerHtml, /Assigned review · controlled evidence/i);
  assert.match(reviewerHtml, /Downloading an object does not perform a fresh runner replay/i);
  assert.doesNotMatch(reviewerHtml, new RegExp(fixture.owner.person.id));
  assert.doesNotMatch(reviewerHtml, /Evidence Owner/i);

  const otherHeaders = { "oai-authenticated-user-email": "evidence-other@example.test" };
  assert.equal((await render(`/api/me/evidence/bundles/${encodeURIComponent(fixture.manifestHash)}`, { headers: otherHeaders })).status, 404);
  assert.equal((await render(`/api/me/evidence/bundles/${encodeURIComponent(fixture.manifestHash)}/artifacts/sourcePatch`, { headers: otherHeaders })).status, 404);
});

test("serves a privacy-minimal, signature-checked public delegation record", async () => {
  const fixture = await insertPublicDelegationFixture();

  const response = await render(`/api/delegations/${fixture.certificate.id}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /max-age=300/i);
  assert.doesNotMatch(response.headers.get("cache-control") ?? "", /immutable/i);
  const { delegation } = await response.json();
  assert.equal(delegation.protocolVersion, "pw-delegation-v1");
  assert.deepEqual(delegation.certificate, { ...fixture.certificate, scopes: ["formalize", "prove"] });
  assert.equal(delegation.signer.publicKey, fixture.ownerPublicKey);
  assert.equal(delegation.evidence.payloadHash, fixture.payloadHash);
  assert.equal(delegation.evidence.canonicalPayload, fixture.canonicalPayload);
  assert.equal(delegation.evidence.personSignature, fixture.personSignature);
  assert.equal(delegation.revocation, null);
  assert.doesNotMatch(JSON.stringify(delegation), /Private fixture (display name|agent label)/i);

  const page = await render(`/delegations/${fixture.certificate.id}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Delegation certificate/i);
  assert.match(html, /Open delegation JSON/i);
  assert.doesNotMatch(html, /Private fixture (display name|agent label)/i);

  await database
    .prepare("INSERT INTO delegation_revocations (id, delegation_certificate_id, owner_person_id, revoked_at, reason) VALUES (?, ?, ?, ?, ?)")
    .bind(
      "delegation-revocation:public-fixture",
      fixture.certificate.id,
      fixture.certificate.ownerPersonId,
      "2026-07-13T12:00:00Z",
      "Agent key rotated.",
    )
    .run();
  const revoked = await render(`/api/delegations/${fixture.certificate.id}`);
  assert.deepEqual((await revoked.json()).delegation.revocation, {
    revokedAt: "2026-07-13T12:00:00Z",
    reason: "Agent key rotated.",
  });
  const revokedPage = await render(`/delegations/${fixture.certificate.id}`);
  assert.match(await revokedPage.text(), /Recorded revocation/i);

  await database
    .prepare("INSERT INTO person_key_revocations (id, person_key_id, owner_person_id, revoked_at, reason) VALUES (?, ?, ?, ?, ?)")
    .bind(
      "person-key-revocation:public-fixture",
      "person-key:public-delegation",
      fixture.certificate.ownerPersonId,
      "2026-07-13T13:00:00Z",
      "Device replaced.",
    )
    .run();
  const signerKeyRevoked = await render(`/api/delegations/${fixture.certificate.id}`);
  assert.deepEqual((await signerKeyRevoked.json()).delegation.signer.keyRevocation, {
    revokedAt: "2026-07-13T13:00:00Z",
    reason: "Device replaced.",
  });
  const signerKeyRevokedPage = await render(`/delegations/${fixture.certificate.id}`);
  assert.match(await signerKeyRevokedPage.text(), /Signer key revocation/i);
});

test("retires static MCP tokens before moving to remote OAuth", async () => {
  const tokenResponse = await render("/api/v1/mcp/tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Deprecated local bridge" }),
  });
  assert.equal(tokenResponse.status, 410);
  const tokenBody = await tokenResponse.json();
  assert.equal(tokenBody.error.code, "precondition_failed");
  assert.match(tokenBody.error.message, /remote OAuth MCP gateway/i);

  const activeTokens = await database
    .prepare("SELECT COUNT(*) AS count FROM mcp_access_tokens WHERE revoked_at IS NULL")
    .first();
  assert.equal(activeTokens.count, 0);
  assert.equal((await render("/api/v1/mcp/problems")).status, 401);
});

test("persists immutable delegated-agent attribution records", async () => {
  const tables = await database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('person_keys', 'person_key_proof_challenges', 'person_key_proof_events', 'person_key_revocations', 'agents', 'delegation_certificates', 'delegation_revocations') ORDER BY name",
    )
    .all();
  assert.deepEqual(
    tables.results.map((row) => row.name),
    ["agents", "delegation_certificates", "delegation_revocations", "person_key_proof_challenges", "person_key_proof_events", "person_key_revocations", "person_keys"],
  );

  const now = "2026-07-13T00:00:00Z";
  await database
    .prepare(
      "INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind("person:delegation-test", "proofweave", "delegation-test", "Delegation Test", now)
    .run();
  await database
    .prepare(
      "INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)",
    )
    .bind("person-key:delegation-test", "person:delegation-test", "person-key", "sha256:person-key")
    .run();
  await database
    .prepare(
      "INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)",
    )
    .bind("agent:delegation-test", "person:delegation-test", "test-agent", "agent-key", "sha256:agent-key")
    .run();
  await database
    .prepare(
      `INSERT INTO delegation_certificates (
        id, owner_person_id, agent_id, person_key_id, agent_public_key,
        scopes_json, valid_from, valid_until, beneficiary_person_id,
        protocol_version, payload_hash, canonical_payload, person_signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      "delegation:immutable-test",
      "person:delegation-test",
      "agent:delegation-test",
      "person-key:delegation-test",
      "agent-key",
      '["formalize"]',
      now,
      "2027-07-13T00:00:00Z",
      "person:delegation-test",
      "pw-delegation-v1",
      "sha256:delegation-test",
      "{}",
      "signature",
    )
    .run();
  await assert.rejects(
    database
      .prepare("UPDATE delegation_certificates SET valid_until = ? WHERE id = ?")
      .bind("2028-07-13T00:00:00Z", "delegation:immutable-test")
      .run(),
    /delegation certificates are immutable/,
  );
  await assert.rejects(
    database
      .prepare("UPDATE agents SET owner_person_id = ? WHERE id = ?")
      .bind("person:catalog-test", "agent:delegation-test")
      .run(),
    /agent owner cannot be changed/,
  );

  await database
    .prepare(
      "INSERT INTO delegation_revocations (id, delegation_certificate_id, owner_person_id, revoked_at, reason) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(
      "delegation-revocation:immutable-test",
      "delegation:immutable-test",
      "person:delegation-test",
      "2026-08-01T00:00:00Z",
      "Owner requested revocation.",
    )
    .run();
  await assert.rejects(
    database
      .prepare("UPDATE delegation_revocations SET reason = ? WHERE id = ?")
      .bind("changed", "delegation-revocation:immutable-test")
      .run(),
    /delegation revocations are immutable/,
  );
  await database
    .prepare("INSERT INTO person_key_revocations (id, person_key_id, owner_person_id, revoked_at, reason) VALUES (?, ?, ?, ?, ?)")
    .bind(
      "person-key-revocation:immutable-test",
      "person-key:delegation-test",
      "person:delegation-test",
      "2026-08-01T00:00:00Z",
      "Device replaced.",
    )
    .run();
  await assert.rejects(
    database
      .prepare("UPDATE person_key_revocations SET reason = ? WHERE id = ?")
      .bind("changed", "person-key-revocation:immutable-test")
      .run(),
    /person key revocations are immutable/,
  );
});

test("registers, signs, and revokes a Person-owned Agent delegation through authenticated APIs", async () => {
  const authHeaders = {
    "oai-authenticated-user-email": "delegation-owner@example.test",
    "oai-authenticated-user-full-name": "Delegation%20Owner",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
  assert.equal((await render("/api/me/delegation")).status, 401);

  const profileResponse = await render("/api/me/delegation", { headers: authHeaders });
  assert.equal(profileResponse.status, 200);
  const { profile } = await profileResponse.json();
  assert.equal(profile.person.displayName, "Delegation Owner");

  const ownerKeys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const ownerPublicKey = base64Url(await crypto.subtle.exportKey("raw", ownerKeys.publicKey));
  const keyResponse = await render("/api/me/keys", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ publicKey: ownerPublicKey }),
  });
  assert.equal(keyResponse.status, 201);
  const { key } = await keyResponse.json();
  assert.equal(key.possessionVerifiedAt, null);

  const challengeResponse = await render(`/api/me/keys/${encodeURIComponent(key.id)}/proof-challenge`, {
    method: "POST",
    headers: authHeaders,
  });
  assert.equal(challengeResponse.status, 201);
  const { challenge } = await challengeResponse.json();
  assert.equal(challenge.personKeyId, key.id);
  assert.equal(challenge.personPublicKey, ownerPublicKey);
  assert.equal(Date.parse(challenge.expiresAt) > Date.parse(challenge.issuedAt), true);

  const invalidProofResponse = await render(`/api/me/keys/${encodeURIComponent(key.id)}/proof`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      challengeId: challenge.id,
      personSignature: base64Url(crypto.getRandomValues(new Uint8Array(64))),
    }),
  });
  assert.equal(invalidProofResponse.status, 403);

  const agentPublicKey = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const agentResponse = await render("/api/me/agents", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      agentId: "urn:pw:agent:delegation-test",
      label: "Delegation test agent",
      publicKey: agentPublicKey,
    }),
  });
  assert.equal(agentResponse.status, 201);

  const certificate = {
    id: "pw:delegation:api-test",
    ownerPersonId: profile.person.id,
    agentId: "urn:pw:agent:delegation-test",
    agentPublicKey,
    scopes: ["formalize", "prove"],
    validFrom: "2026-07-13T00:00:00Z",
    validUntil: "2027-07-13T00:00:00Z",
    attributionPolicy: {
      beneficiaryPersonId: profile.person.id,
      mode: "agent_delegated",
    },
  };
  const signature = base64Url(
    await crypto.subtle.sign(
      "Ed25519",
      ownerKeys.privateKey,
      new TextEncoder().encode(canonicalJson(delegationSigningPayload(certificate))),
    ),
  );
  const missingProofResponse = await render("/api/me/delegations", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ personKeyId: key.id, certificate, personSignature: signature }),
  });
  assert.equal(missingProofResponse.status, 403);
  assert.match((await missingProofResponse.json()).error.message, /Verify possession/i);

  const proofSignature = base64Url(await crypto.subtle.sign(
    "Ed25519",
    ownerKeys.privateKey,
    new TextEncoder().encode(canonicalJson(personKeyProofChallengeSigningPayload(challenge))),
  ));
  const proofResponse = await render(`/api/me/keys/${encodeURIComponent(key.id)}/proof`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ challengeId: challenge.id, personSignature: proofSignature }),
  });
  assert.equal(proofResponse.status, 201);
  const { proof } = await proofResponse.json();
  assert.equal(proof.personKeyId, key.id);

  const repeatedProof = await render(`/api/me/keys/${encodeURIComponent(key.id)}/proof`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ challengeId: challenge.id, personSignature: proofSignature }),
  });
  assert.equal(repeatedProof.status, 200);
  assert.equal((await repeatedProof.json()).idempotentReplay, true);

  const verifiedProfileResponse = await render("/api/me/delegation", { headers: authHeaders });
  const { profile: verifiedProfile } = await verifiedProfileResponse.json();
  assert.equal(verifiedProfile.signingKeys.find((candidate) => candidate.id === key.id).possessionVerifiedAt.length > 0, true);

  const delegationResponse = await render("/api/me/delegations", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      personKeyId: key.id,
      certificate,
      personSignature: signature,
    }),
  });
  assert.equal(delegationResponse.status, 201);
  const { delegation } = await delegationResponse.json();
  assert.equal(delegation.revokedAt, null);
  assert.deepEqual(delegation.scopes, ["formalize", "prove"]);

  // Static token issuance is retired in production. This direct fixture models
  // an already-authenticated control-plane principal so the Attempt repository
  // can prove it binds the persisted delegation rather than an Agent label.
  const testToken = "pw_mcp_delegation_integration_test";
  await database
    .prepare(
      "INSERT INTO mcp_access_tokens (id, person_id, name, token_hash, token_prefix, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      "mcp-token:delegation-integration-test",
      profile.person.id,
      "Integration fixture",
      await sha256(testToken),
      "pw_mcp_delegation",
      "2027-07-13T00:00:00Z",
    )
    .run();
  const attemptResponse = await render("/api/v1/mcp/attempts", {
    method: "POST",
    headers: { authorization: `Bearer ${testToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      problemSlug: "erdos-865",
      agentId: "urn:pw:agent:delegation-test",
      agentLabel: "Delegation test agent",
      delegationCertificateId: certificate.id,
      delegationScope: "prove",
      idempotencyKey: "delegation-attempt-1",
    }),
  });
  assert.equal(attemptResponse.status, 201);
  const { attempt } = await attemptResponse.json();
  assert.equal(attempt.agentId, "urn:pw:agent:delegation-test");
  assert.equal(attempt.delegationCertificateId, certificate.id);
  assert.equal(attempt.delegationScope, "prove");

  const ownerAttemptResponse = await render("/api/me/attempts", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      problemSlug: "erdos-865",
      delegationCertificateId: certificate.id,
      delegationScope: "formalize",
      idempotencyKey: "owner-opened-attempt-1",
    }),
  });
  assert.equal(ownerAttemptResponse.status, 201);
  const { attempt: ownerAttempt, note: ownerAttemptNote } = await ownerAttemptResponse.json();
  assert.equal(ownerAttempt.agentId, "urn:pw:agent:delegation-test");
  assert.equal(ownerAttempt.delegationScope, "formalize");
  assert.match(ownerAttempt.events[0].message, /opened by its owner/i);
  assert.match(ownerAttemptNote, /not an Agent-signed event/i);

  const selectedTargetAttemptResponse = await render("/api/me/attempts", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      problemSlug: "erdos-865-k2",
      delegationCertificateId: certificate.id,
      delegationScope: "prove",
      idempotencyKey: "owner-opened-selected-target-attempt-1",
    }),
  });
  assert.equal(selectedTargetAttemptResponse.status, 201);
  const { attempt: selectedTargetAttempt } = await selectedTargetAttemptResponse.json();
  assert.equal(selectedTargetAttempt.problemSlug, "erdos-865-k2");
  assert.match(selectedTargetAttempt.problemTitle, /k = 2 variant/i);

  const ownerAttemptsResponse = await render("/api/me/attempts", { headers: authHeaders });
  assert.equal(ownerAttemptsResponse.status, 200);
  const { attempts: ownerAttempts } = await ownerAttemptsResponse.json();
  assert.equal(ownerAttempts.some((candidate) => candidate.id === ownerAttempt.id), true);
  assert.equal(ownerAttempts.some((candidate) => candidate.id === attempt.id), true);

  const otherAttemptsResponse = await render("/api/me/attempts", {
    headers: { "oai-authenticated-user-email": "other-owner@example.test" },
  });
  assert.equal(otherAttemptsResponse.status, 200);
  assert.deepEqual((await otherAttemptsResponse.json()).attempts, []);

  const ownerWorkbench = await render("/workbench?target=erdos-865-k2", { headers: authHeaders });
  assert.equal(ownerWorkbench.status, 200);
  const ownerWorkbenchHtml = await ownerWorkbench.text();
  assert.match(ownerWorkbenchHtml, /Open a durable research Attempt/i);
  assert.match(ownerWorkbenchHtml, /Selected catalog target/i);
  assert.match(ownerWorkbenchHtml, /Erdős Problem 865: k = 2 variant/i);
  assert.match(ownerWorkbenchHtml, /Attempt opened by its owner/i);
  assert.match(ownerWorkbenchHtml, /Refresh records/i);

  const guardedKeyRevocation = await render(`/api/me/keys/${encodeURIComponent(key.id)}/revoke`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ reason: "Device replaced.", emergency: false }),
  });
  assert.equal(guardedKeyRevocation.status, 409);
  assert.match((await guardedKeyRevocation.json()).error.message, /another device signing key/i);

  const replacementKeys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const replacementPublicKey = base64Url(await crypto.subtle.exportKey("raw", replacementKeys.publicKey));
  const replacementKeyResponse = await render("/api/me/keys", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ publicKey: replacementPublicKey }),
  });
  assert.equal(replacementKeyResponse.status, 201);
  const { key: replacementKey } = await replacementKeyResponse.json();
  const replacementChallengeResponse = await render(`/api/me/keys/${encodeURIComponent(replacementKey.id)}/proof-challenge`, {
    method: "POST",
    headers: authHeaders,
  });
  assert.equal(replacementChallengeResponse.status, 201);
  const { challenge: replacementChallenge } = await replacementChallengeResponse.json();
  const replacementSignature = base64Url(await crypto.subtle.sign(
    "Ed25519",
    replacementKeys.privateKey,
    new TextEncoder().encode(canonicalJson(personKeyProofChallengeSigningPayload(replacementChallenge))),
  ));
  const replacementProof = await render(`/api/me/keys/${encodeURIComponent(replacementKey.id)}/proof`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ challengeId: replacementChallenge.id, personSignature: replacementSignature }),
  });
  assert.equal(replacementProof.status, 201);

  const keyRevocationResponse = await render(`/api/me/keys/${encodeURIComponent(key.id)}/revoke`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ reason: "Device replaced.", emergency: false }),
  });
  assert.equal(keyRevocationResponse.status, 201);
  const { revocation: keyRevocation } = await keyRevocationResponse.json();
  assert.equal(keyRevocation.personKeyId, key.id);
  assert.equal(keyRevocation.reason, "Device replaced.");
  const repeatedKeyRevocation = await render(`/api/me/keys/${encodeURIComponent(key.id)}/revoke`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ reason: "Device replaced.", emergency: false }),
  });
  assert.equal(repeatedKeyRevocation.status, 200);
  assert.equal((await repeatedKeyRevocation.json()).idempotentReplay, true);
  const revokedKeyProfileResponse = await render("/api/me/delegation", { headers: authHeaders });
  const { profile: revokedKeyProfile } = await revokedKeyProfileResponse.json();
  assert.equal(revokedKeyProfile.signingKeys.find((candidate) => candidate.id === key.id).revokedAt.length > 0, true);
  assert.equal(revokedKeyProfile.signingKeys.find((candidate) => candidate.id === replacementKey.id).possessionVerifiedAt.length > 0, true);

  const progressAfterKeyRevocation = await render(`/api/v1/mcp/attempts/${attempt.id}/events`, {
    method: "POST",
    headers: { authorization: `Bearer ${testToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: "This must not be recorded after signer key revocation.",
      progressPercent: 1,
      idempotencyKey: "delegation-progress-after-key-revocation",
    }),
  });
  assert.equal(progressAfterKeyRevocation.status, 412);

  const emergencyReplacementRevocation = await render(`/api/me/keys/${encodeURIComponent(replacementKey.id)}/revoke`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ reason: "Replacement device compromised.", emergency: true }),
  });
  assert.equal(emergencyReplacementRevocation.status, 201);
  assert.equal((await emergencyReplacementRevocation.json()).revocation.personKeyId, replacementKey.id);

  const revokedResponse = await render("/api/me/delegations/pw:delegation:api-test/revoke", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      reason: "Agent key rotated.",
      revokedAt: new Date().toISOString(),
    }),
  });
  assert.equal(revokedResponse.status, 200);
  assert.equal((await revokedResponse.json()).delegation.revokedAt.length > 0, true);

});

test("keeps the production frontend free of the deleted starter preview", async () => {
  const [page, layout, packageJson, workbench, delegationSetup, browserKeyStore, legacyContent] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(
      new URL("../app/workbench/workbench-sections.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/workbench/DelegationSetup.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/workbench/browser-signing-key.ts", import.meta.url),
      "utf8",
    ),
    access(new URL("../app/lib/content.ts", import.meta.url)).then(
      () => "present",
      () => "absent",
    ),
  ]);

  assert.match(page, /Proofweave/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview|react-loading-skeleton/i);
  assert.doesNotMatch(layout, /codex-preview|_sites-preview/i);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/i);
  assert.match(workbench, /No simulated Agent work is created in this workspace/);
  assert.match(workbench, /Proofweave does not render a sample source file or a fictional compiler result/);
  assert.match(workbench, /Independent review/);
  assert.doesNotMatch(workbench, /Run next bounded step|Illustrative only|Example check result|Local preview/);
  assert.match(delegationSetup, /Set up an accountable research Agent/);
  assert.match(delegationSetup, /Agent private key must stay where the Agent runs/);
  assert.match(delegationSetup, /Replace or revoke key/);
  assert.match(browserKeyStore, /IndexedDB-backed WebCrypto store/);
  assert.match(browserKeyStore, /Remove a locally held private key/);
  assert.doesNotMatch(browserKeyStore, /localStorage/);
  assert.equal(legacyContent, "absent");

  await assert.rejects(
    access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)),
  );
  await assert.rejects(
    access(new URL("public/_sites-preview/SkeletonPreview.tsx", repositoryRoot)),
  );
});

function base64Url(buffer) {
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Bytes(value) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
