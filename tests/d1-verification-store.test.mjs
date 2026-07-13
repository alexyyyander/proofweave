import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import {
  D1VerificationStore,
  VerificationStoreCapacityError,
} from "../services/verification/d1-verification-store.mjs";
import { closedAlphaReviewLimits } from "../packages/domain/attempt-policy.mjs";
import {
  verificationAttestationPayloadHash,
  verificationAttestationSigningPayload,
} from "../packages/protocol/verification-attestation.mjs";
import { canonicalJson } from "../packages/protocol/canonical-json.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
let miniflare;
let database;
let reviewerKeyPair;
let reviewerPublicKey;

before(async () => {
  reviewerKeyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  reviewerPublicKey = base64Url(await crypto.subtle.exportKey("raw", reviewerKeyPair.publicKey));
  miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
  });
  database = await miniflare.getD1Database("DB");
  await applyMigrations(database);
  await seedBundle(database, reviewerPublicKey);
});

after(async () => {
  await miniflare?.dispose();
});

test("D1 Verification store enforces different-owner review and persists signed evidence", async () => {
  const store = new D1VerificationStore(database);
  await assert.rejects(
    store.assign({
      id: "assignment:self-review", artifactBundleManifestHash: sha("a"), claimType: "kernel_accepted",
      verifierPersonId: "person:alice", assignedAt: "2026-07-13T00:00:00Z",
    }),
    /cannot independently review their own Attempt/,
  );

  const assigned = await store.assign({
    id: "assignment:bob-review", artifactBundleManifestHash: sha("a"), claimType: "kernel_accepted",
    verifierPersonId: "person:bob", assignedAt: "2026-07-13T00:00:00Z",
  });
  assert.equal(assigned.created, true);
  assert.equal((await store.assign({
    id: "assignment:retry", artifactBundleManifestHash: sha("a"), claimType: "kernel_accepted",
    verifierPersonId: "person:bob", assignedAt: "2026-07-13T00:00:01Z",
  })).created, false);

  const accepted = await store.accept("assignment:bob-review", "person:bob", "2026-07-13T00:00:02Z");
  const attestation = await signedAttestation();
  const recorded = await store.recordAttestation(attestation);
  assert.equal(accepted.status, "accepted");
  assert.equal(recorded.created, true);
  assert.equal((await store.recordAttestation(attestation)).created, false);

  await store.assign({
    id: "assignment:bob-request-changes",
    artifactBundleManifestHash: sha("a"),
    claimType: "statement_faithful",
    verifierPersonId: "person:bob",
    assignedAt: "2026-07-13T00:00:04Z",
  });
  await store.accept("assignment:bob-request-changes", "person:bob", "2026-07-13T00:00:05Z");
  const requestedChanges = await store.recordAttestation(await signedAttestation({
    id: "attestation:bob-request-changes",
    assignmentId: "assignment:bob-request-changes",
    claimType: "statement_faithful",
    decision: "request_changes",
    attestedAt: "2026-07-13T00:00:06Z",
  }));
  assert.equal(requestedChanges.created, true);
  assert.equal(requestedChanges.attestation.decision, "request_changes");
  assert.equal((await store.requireAssignment("assignment:bob-request-changes")).status, "completed");
  const storedRequestChanges = await database
    .prepare("SELECT decision FROM verification_attestations WHERE id = ?")
    .bind("attestation:bob-request-changes")
    .first();
  assert.equal(storedRequestChanges?.decision, "request_changes");

  await store.assign({
    id: "assignment:bob-integrity-flag",
    artifactBundleManifestHash: sha("a"),
    claimType: "bundle_reproducible",
    verifierPersonId: "person:bob",
    assignedAt: "2026-07-13T00:00:07Z",
  });
  await store.accept("assignment:bob-integrity-flag", "person:bob", "2026-07-13T00:00:08Z");
  const integrityFlag = await store.recordAttestation(await signedAttestation({
    id: "attestation:bob-integrity-flag",
    assignmentId: "assignment:bob-integrity-flag",
    claimType: "bundle_reproducible",
    decision: "integrity_flagged",
    attestedAt: "2026-07-13T00:00:09Z",
  }));
  assert.equal(integrityFlag.attestation.decision, "integrity_flagged");
  assert.equal((await store.requireAssignment("assignment:bob-integrity-flag")).status, "completed");

  await database.batch([
    database
      .prepare("INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)")
      .bind(sha("6"), `bundles/sha256/${"6".repeat(64)}/bundle.json`, 2, "application/json"),
    database
      .prepare(
        `INSERT INTO artifact_bundles (
          id, attempt_id, problem_revision_id, manifest_hash, manifest_key,
          canonical_manifest, agent_event_id, agent_event_payload_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        "bundle:verification-positive-replay-required", "attempt:verification", "revision:verification", sha("6"),
        `bundles/sha256/${"6".repeat(64)}/bundle.json`, "{}", "agent-event:verification-positive-replay-required", sha("d"),
      ),
  ]);
  await store.assign({
    id: "assignment:bob-positive-replay-required",
    artifactBundleManifestHash: sha("6"),
    claimType: "bundle_reproducible",
    verifierPersonId: "person:bob",
    assignedAt: "2026-07-13T00:00:10Z",
  });
  await store.accept("assignment:bob-positive-replay-required", "person:bob", "2026-07-13T00:00:11Z");
  await assert.rejects(
    store.recordAttestation(await signedAttestation({
      id: "attestation:bob-positive-replay-required",
      assignmentId: "assignment:bob-positive-replay-required",
      claimType: "bundle_reproducible",
      artifactBundleHash: sha("6"),
      decision: "attested",
      attestedAt: "2026-07-13T00:00:12Z",
    })),
    /bundle_reproducible requires terminal fresh replay evidence/,
  );

  const events = await store.listEvents("assignment:bob-review");
  assert.deepEqual(events.map((event) => event.eventType), [
    "assignment_created",
    "assignment_accepted",
    "attestation_recorded",
  ]);
  await assert.rejects(
    database.prepare("UPDATE verification_assignments SET claim_type = ? WHERE id = ?").bind("novelty_reviewed", "assignment:bob-review").run(),
    /verification assignment identity is immutable/,
  );
  await assert.rejects(
    database.prepare("UPDATE verification_attestations SET decision = ? WHERE id = ?").bind("rejected", attestation.id).run(),
    /verification attestations are immutable/,
  );
});

test("rejects a review attestation after its Person signing key is revoked", async () => {
  const store = new D1VerificationStore(database);
  await store.assign({
    id: "assignment:bob-after-key-revocation",
    artifactBundleManifestHash: sha("a"),
    claimType: "novelty_reviewed",
    verifierPersonId: "person:bob",
    assignedAt: "2026-07-13T00:00:04Z",
  });
  await store.accept("assignment:bob-after-key-revocation", "person:bob", "2026-07-13T00:00:05Z");
  await database
    .prepare("INSERT INTO person_key_revocations (id, person_key_id, owner_person_id, revoked_at, reason) VALUES (?, ?, ?, ?, ?)")
    .bind(
      "person-key-revocation:bob-reviewer",
      "person-key:bob",
      "person:bob",
      "2026-07-13T00:00:06Z",
      "Device replaced.",
    )
    .run();
  await assert.rejects(
    store.recordAttestation(await signedAttestation({
      id: "attestation:bob-after-key-revocation",
      assignmentId: "assignment:bob-after-key-revocation",
      claimType: "novelty_reviewed",
      attestedAt: "2026-07-13T00:00:07Z",
    })),
    /outside valid review delegation authority/,
  );
});

test("D1 review capacity is shared by every review Agent owned by the same Person", async () => {
  const store = new D1VerificationStore(database);
  await database
    .prepare("INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind("person:capacity-reviewer", "proofweave", "capacity-reviewer", "Capacity reviewer", "2026-07-13T00:00:00Z")
    .run();

  const bundleHashes = ["c", "d", "e", "f", "0", "1", "2", "3", "4"].map(sha);
  for (const [index, manifestHash] of bundleHashes.entries()) {
    await database.batch([
      database
        .prepare("INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)")
        .bind(manifestHash, `bundles/sha256/${manifestHash.slice("sha256:".length)}/bundle.json`, 2, "application/json"),
      database
        .prepare(
          `INSERT INTO artifact_bundles (
            id, attempt_id, problem_revision_id, manifest_hash, manifest_key,
            canonical_manifest, agent_event_id, agent_event_payload_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          `bundle:capacity-${index}`, "attempt:verification", "revision:verification", manifestHash,
          `bundles/sha256/${manifestHash.slice("sha256:".length)}/bundle.json`, "{}",
          `agent-event:capacity-${index}`, sha("9"),
        ),
    ]);
  }

  for (let index = 0; index < closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson; index += 1) {
    const result = await store.assign({
      id: `assignment:capacity-${index}`,
      artifactBundleManifestHash: bundleHashes[index],
      claimType: "kernel_accepted",
      verifierPersonId: "person:capacity-reviewer",
      assignedAt: `2026-07-13T00:0${index}:00Z`,
    });
    assert.equal(result.created, true);
  }

  await assert.rejects(
    store.assign({
      id: "assignment:capacity-exhausted",
      artifactBundleManifestHash: bundleHashes.at(-1),
      claimType: "kernel_accepted",
      verifierPersonId: "person:capacity-reviewer",
      assignedAt: "2026-07-13T00:09:00Z",
    }),
    VerificationStoreCapacityError,
  );

  const declined = await store.decline(
    "assignment:capacity-0",
    "person:capacity-reviewer",
    "2026-07-13T00:10:00Z",
  );
  assert.equal(declined.status, "declined");
  const released = await store.assign({
    id: "assignment:capacity-released",
    artifactBundleManifestHash: bundleHashes.at(-1),
    claimType: "kernel_accepted",
    verifierPersonId: "person:capacity-reviewer",
    assignedAt: "2026-07-13T00:11:00Z",
  });
  assert.equal(released.created, true);

  const active = await database
    .prepare("SELECT COUNT(*) AS count FROM verification_assignments WHERE verifier_person_id = ? AND status IN ('assigned', 'accepted')")
    .bind("person:capacity-reviewer")
    .first();
  assert.equal(Number(active?.count), closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson);
  const rejectedEvents = await database
    .prepare("SELECT COUNT(*) AS count FROM verification_assignment_events WHERE assignment_id = ?")
    .bind("assignment:capacity-exhausted")
    .first();
  assert.equal(Number(rejectedEvents?.count), 0);
});

async function signedAttestation({
  id = "attestation:bob-review",
  assignmentId = "assignment:bob-review",
  artifactBundleHash = sha("a"),
  claimType = "kernel_accepted",
  decision = "attested",
  attestedAt = "2026-07-13T00:00:03Z",
} = {}) {
  const attestation = {
    protocolVersion: "pw-verification-attestation-v1",
    id,
    assignmentId,
    artifactBundleHash,
    claimType,
    verifierPersonId: "person:bob",
    verifierAgentId: "agent:bob-reviewer",
    delegationCertificateId: "delegation:bob-reviewer",
    verifierAgentPublicKey: reviewerPublicKey,
    decision,
    evidenceHash: sha("b"),
    attestedAt,
    payloadHash: sha("0"),
    signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  };
  attestation.payloadHash = await verificationAttestationPayloadHash(attestation);
  attestation.signature = base64Url(
    await crypto.subtle.sign(
      "Ed25519",
      reviewerKeyPair.privateKey,
      new TextEncoder().encode(canonicalJson(verificationAttestationSigningPayload(attestation))),
    ),
  );
  return attestation;
}

async function seedBundle(d1, publicKey) {
  const manifestHash = sha("a");
  const evidenceHash = sha("b");
  const statements = [
    ["INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)", ["person:alice", "proofweave", "alice", "Alice", "2026-07-01T00:00:00Z"]],
    ["INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)", ["person:bob", "proofweave", "bob", "Bob", "2026-07-01T00:00:00Z"]],
    [
      `INSERT INTO source_snapshots (id, upstream_name, source_url, revision_tag, revision_commit, retrieved_at, content_hash, manifest_hash, source_license, lean_toolchain, mathlib_revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["snapshot:verification", "fixture", "https://example.test/source", "v1", "abc123", "2026-07-01T00:00:00Z", sha("1"), sha("2"), "MIT", "leanprover/lean4:v4.27.0", "abc123"],
    ],
    ["INSERT INTO projects (id, slug, kind, title, summary) VALUES (?, ?, ?, ?, ?)", ["project:verification", "verification", "frontier", "Verification", "Fixture"]],
    [
      `INSERT INTO problem_revisions (id, project_id, source_snapshot_id, target_key, slug, revision_number, title, domain, research_status, informal_statement, lean_statement)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["revision:verification", "project:verification", "snapshot:verification", "verification-target", "verification-target", 1, "Verification target", "logic", "research_open", "fixture", "theorem fixture : True := by trivial"],
    ],
    [
      "INSERT INTO agent_attempts (id, person_id, problem_revision_id, agent_label, idempotency_key, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["attempt:verification", "person:alice", "revision:verification", "Alice Agent", "attempt-verification", "2026-07-01T00:00:00Z"],
    ],
    ["INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)", [manifestHash, `bundles/sha256/${"a".repeat(64)}/bundle.json`, 2, "application/json"]],
    ["INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)", [evidenceHash, `bundles/sha256/${"b".repeat(64)}/review.json`, 2, "application/json"]],
    [
      `INSERT INTO artifact_bundles (id, attempt_id, problem_revision_id, manifest_hash, manifest_key, canonical_manifest, agent_event_id, agent_event_payload_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["bundle:verification", "attempt:verification", "revision:verification", manifestHash, `bundles/sha256/${"a".repeat(64)}/bundle.json`, "{}", "agent-event:verification", sha("3")],
    ],
    ["INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)", ["agent:bob-reviewer", "person:bob", "Bob reviewer", publicKey, sha("4")]],
    ["INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)", ["person-key:bob", "person:bob", "person-key", sha("5")]],
    [
      `INSERT INTO delegation_certificates (id, owner_person_id, agent_id, person_key_id, agent_public_key, scopes_json, valid_from, valid_until, beneficiary_person_id, protocol_version, payload_hash, canonical_payload, person_signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["delegation:bob-reviewer", "person:bob", "agent:bob-reviewer", "person-key:bob", publicKey, '["review"]', "2026-07-01T00:00:00Z", "2027-07-01T00:00:00Z", "person:bob", "pw-delegation-v1", sha("6"), "{}", "signature"],
    ],
  ];
  for (const [statement, values] of statements) await d1.prepare(statement).bind(...values).run();
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

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}

function base64Url(buffer) {
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
