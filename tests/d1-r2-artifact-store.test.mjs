import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { D1R2ArtifactStore } from "../services/artifacts/d1-r2-artifact-store.mjs";
import {
  D1InlineArtifactBucket,
  D1InlineArtifactStore,
  maxInlineArtifactObjectBytes,
} from "../services/artifacts/d1-inline-artifact-store.mjs";
import {
  artifactBundleSigningPayload,
  artifactBundleSigningPayloadHash,
} from "../packages/protocol/artifact-bundle.mjs";
import { canonicalJson } from "../packages/protocol/canonical-json.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
let miniflare;
let database;
let bucket;
let agentKeyPair;
let agentPublicKey;

before(async () => {
  agentKeyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  agentPublicKey = base64Url(await crypto.subtle.exportKey("raw", agentKeyPair.publicKey));
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
  await seedAttempt(database, agentPublicKey);
});

after(async () => {
  await miniflare?.dispose();
});

test("stages a signed Artifact Bundle only after immutable R2/D1 evidence is present", async () => {
  const store = new D1R2ArtifactStore({ database, bucket });
  const archive = await store.putObject({
    bytes: "source archive fixture",
    filename: "source.tar.zst",
    contentType: "application/zstd",
  });
  const patch = await store.putObject({
    bytes: "normalized patch fixture",
    filename: "normalized.patch",
    contentType: "text/plain",
  });
  const lakeManifest = await store.putObject({
    bytes: '{"packages":[]}',
    filename: "lake-manifest.json",
    contentType: "application/json",
  });
  assert.equal((await store.putObject({
    bytes: "source archive fixture",
    filename: "source.tar.zst",
    contentType: "application/zstd",
  })).created, false);

  const bundle = await signedBundle({ archive, patch, lakeManifest });
  const staged = await store.stageBundle(bundle);
  const repeated = await store.stageBundle(bundle);
  assert.equal(staged.created, true);
  assert.equal(repeated.created, false);
  assert.match(staged.bundle.manifestHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal((await bucket.get(staged.bundle.manifestKey)).customMetadata.sha256, staged.bundle.manifestHash);
  assert.equal((await store.findBundle(staged.bundle.manifestHash)).agentEventId, "agent-event:artifact-store-test");
  const provisional = await database
    .prepare(
      `SELECT id, kind, state, beneficiary_person_id, beneficiary_agent_id,
              beneficiary_delegation_certificate_id, attempt_id,
              problem_revision_id, artifact_bundle_manifest_hash, agent_event_id,
              agent_event_occurred_at, recorded_at
       FROM provisional_contributions
       WHERE artifact_bundle_manifest_hash = ?`,
    )
    .bind(staged.bundle.manifestHash)
    .first();
  assert.deepEqual(
    {
      id: provisional.id,
      kind: provisional.kind,
      state: provisional.state,
      personId: provisional.beneficiary_person_id,
      agentId: provisional.beneficiary_agent_id,
      certificateId: provisional.beneficiary_delegation_certificate_id,
      attemptId: provisional.attempt_id,
      revisionId: provisional.problem_revision_id,
      manifestHash: provisional.artifact_bundle_manifest_hash,
      eventId: provisional.agent_event_id,
      eventOccurredAt: provisional.agent_event_occurred_at,
    },
    {
      id: `provisional-evidence:${staged.bundle.manifestHash}`,
      kind: "evidence_bundle",
      state: "bundle_staged",
      personId: "person:artifact-store-test",
      agentId: "agent:artifact-store-test",
      certificateId: "delegation:artifact-store-test",
      attemptId: bundle.attemptId,
      revisionId: bundle.problemRevisionId,
      manifestHash: staged.bundle.manifestHash,
      eventId: bundle.agentEvent.eventId,
      eventOccurredAt: bundle.agentEvent.occurredAt,
    },
  );
  assert.ok(Date.parse(provisional.recorded_at));
  assert.equal(
    (await database.prepare("SELECT COUNT(*) AS count FROM provisional_contributions WHERE artifact_bundle_manifest_hash = ?").bind(staged.bundle.manifestHash).first()).count,
    1,
  );

  await assert.rejects(
    store.stageBundle({
      ...bundle,
      target: { ...bundle.target, declaration: "Proofweave.Artifact.tampered" },
    }),
    /Agent signature or payload hash is invalid/,
  );
  await assert.rejects(
    database.prepare("UPDATE artifact_objects SET content_type = ? WHERE content_hash = ?").bind("changed", archive.contentHash).run(),
    /artifact objects are immutable/,
  );
  await assert.rejects(
    database.prepare("UPDATE artifact_bundles SET canonical_manifest = ? WHERE id = ?").bind("{}", bundle.id).run(),
    /artifact bundles are immutable/,
  );
  await assert.rejects(
    database.prepare("UPDATE provisional_contributions SET state = ? WHERE id = ?").bind("bundle_staged", provisional.id).run(),
    /provisional contributions are immutable/,
  );
  await assert.rejects(
    database.prepare("DELETE FROM provisional_contributions WHERE id = ?").bind(provisional.id).run(),
    /provisional contributions cannot be deleted/,
  );

});

test("stages a signed v2 workspace manifest through the same immutable object gate", async () => {
  const store = new D1R2ArtifactStore({ database, bucket });
  const archive = await store.putObject({
    bytes: "source archive v2 fixture",
    filename: "source.tar.zst",
    contentType: "application/zstd",
  });
  const patch = await store.putObject({
    bytes: "normalized patch v2 fixture",
    filename: "normalized.patch",
    contentType: "text/plain",
  });
  const lakeManifest = await store.putObject({
    bytes: '{"packages":[]}',
    filename: "lake-manifest.json",
    contentType: "application/json",
  });
  const bundle = await signedBundleV2({ archive, patch, lakeManifest });

  const staged = await store.stageBundle(bundle);
  assert.equal(staged.created, true);
  assert.equal((await store.findBundle(staged.bundle.manifestHash)).id, bundle.id);
});

test("stages bounded evidence in D1 alone when R2 is not enabled", async () => {
  const store = new D1InlineArtifactStore({ database });
  const archive = await store.putObject({ bytes: "inline archive fixture", filename: "source.tar.zst", contentType: "application/zstd" });
  const patch = await store.putObject({ bytes: "inline patch fixture", filename: "normalized.patch", contentType: "text/plain" });
  const lakeManifest = await store.putObject({ bytes: '{"packages":[]}', filename: "lake-manifest.json", contentType: "application/json" });
  const bundle = await signedBundleV2({ archive, patch, lakeManifest });
  bundle.id = "bundle:artifact-store-inline";
  bundle.agentEvent.eventId = "agent-event:artifact-store-inline";
  bundle.agentEvent.payloadHash = await artifactBundleSigningPayloadHash(bundle);
  bundle.agentEvent.signature = base64Url(await crypto.subtle.sign(
    "Ed25519",
    agentKeyPair.privateKey,
    new TextEncoder().encode(canonicalJson(artifactBundleSigningPayload(bundle))),
  ));

  const staged = await store.stageBundle(bundle);
  const manifest = await new D1InlineArtifactBucket(database).get(staged.bundle.manifestKey);
  assert.equal(manifest.customMetadata.sha256, staged.bundle.manifestHash);
  assert.equal(new TextDecoder().decode(await manifest.arrayBuffer()), canonicalJson(bundle));
  await assert.rejects(
    store.putObject({ bytes: new Uint8Array(maxInlineArtifactObjectBytes + 1), filename: "oversize.bin", contentType: "application/octet-stream" }),
    /closed-alpha limit/,
  );
});

test("rejects an Artifact Bundle event after its signer key is revoked", async () => {
  const store = new D1R2ArtifactStore({ database, bucket });
  const archive = await store.putObject({ bytes: "source archive after revocation", filename: "source.tar.zst", contentType: "application/zstd" });
  const patch = await store.putObject({ bytes: "normalized patch after revocation", filename: "normalized.patch", contentType: "text/plain" });
  const lakeManifest = await store.putObject({ bytes: '{"packages":[]}', filename: "lake-manifest.json", contentType: "application/json" });
  await database
    .prepare("INSERT INTO person_key_revocations (id, person_key_id, owner_person_id, revoked_at, reason) VALUES (?, ?, ?, ?, ?)")
    .bind(
      "person-key-revocation:artifact-store-test",
      "person-key:artifact-store-test",
      "person:artifact-store-test",
      "2026-07-13T00:00:00Z",
      "Device replaced.",
    )
    .run();
  const bundle = await signedBundleV2({ archive, patch, lakeManifest });
  bundle.id = "bundle:artifact-store-after-key-revocation";
  bundle.agentEvent.eventId = "agent-event:artifact-store-after-key-revocation";
  bundle.agentEvent.occurredAt = "2026-07-13T00:00:01Z";
  bundle.agentEvent.payloadHash = await artifactBundleSigningPayloadHash(bundle);
  bundle.agentEvent.signature = base64Url(
    await crypto.subtle.sign(
      "Ed25519",
      agentKeyPair.privateKey,
      new TextEncoder().encode(canonicalJson(artifactBundleSigningPayload(bundle))),
    ),
  );
  await assert.rejects(store.stageBundle(bundle), /outside its valid delegation period/);
});

async function signedBundle({ archive, patch, lakeManifest }) {
  const bundle = {
    protocolVersion: "pw-artifact-bundle-v1",
    id: "bundle:artifact-store-test",
    attemptId: "attempt:artifact-store-test",
    problemRevisionId: "revision:artifact-store-test",
    target: { declaration: "Proofweave.Artifact.target", statementHash: sha("a") },
    source: {
      archiveKey: archive.objectKey,
      archiveHash: archive.contentHash,
      treeHash: sha("b"),
      patchKey: patch.objectKey,
      patchHash: patch.contentHash,
    },
    environment: {
      leanToolchain: "leanprover/lean4:v4.27.0",
      lakeManifestKey: lakeManifest.objectKey,
      lakeManifestHash: lakeManifest.contentHash,
      mathlibRevision: "a3a10db0e9d6",
    },
    entryCommand: ["lake", "env", "lean", "Proofweave/Artifact.lean"],
    dependencyReceipts: [],
    agentEvent: {
      eventId: "agent-event:artifact-store-test",
      occurredAt: "2026-07-13T00:00:00Z",
      payloadHash: sha("0"),
      agentPublicKey,
      signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    },
    policy: { requireNoSorry: true, allowedAxioms: [] },
  };
  bundle.agentEvent.payloadHash = await artifactBundleSigningPayloadHash(bundle);
  bundle.agentEvent.signature = base64Url(
    await crypto.subtle.sign(
      "Ed25519",
      agentKeyPair.privateKey,
      new TextEncoder().encode(canonicalJson(artifactBundleSigningPayload(bundle))),
    ),
  );
  return bundle;
}

async function signedBundleV2({ archive, patch, lakeManifest }) {
  const bundle = {
    protocolVersion: "pw-artifact-bundle-v2",
    id: "bundle:artifact-store-v2-test",
    attemptId: "attempt:artifact-store-test",
    problemRevisionId: "revision:artifact-store-test",
    target: { declaration: "Proofweave.Artifact.v2Target", statementHash: sha("7") },
    workspace: {
      archive: {
        objectKey: archive.objectKey,
        contentHash: archive.contentHash,
        format: "tar.zst",
        maxExpandedBytes: 64 * 1024 * 1024,
        maxFileCount: 10_000,
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
        hash: sha("8"),
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
      leanToolchain: "leanprover/lean4:v4.27.0",
      mathlibRevision: "a3a10db0e9d6",
    },
    entryCommand: ["lake", "env", "lean", "Proofweave/ArtifactV2.lean"],
    dependencyReceipts: [],
    agentEvent: {
      eventId: "agent-event:artifact-store-v2-test",
      occurredAt: "2026-07-13T00:00:00Z",
      payloadHash: sha("0"),
      agentPublicKey,
      signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    },
    policy: { requireNoSorry: true, allowedAxioms: [] },
  };
  bundle.agentEvent.payloadHash = await artifactBundleSigningPayloadHash(bundle);
  bundle.agentEvent.signature = base64Url(
    await crypto.subtle.sign(
      "Ed25519",
      agentKeyPair.privateKey,
      new TextEncoder().encode(canonicalJson(artifactBundleSigningPayload(bundle))),
    ),
  );
  return bundle;
}

async function seedAttempt(d1, publicKey) {
  const statements = [
    [
      "INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)",
      ["person:artifact-store-test", "proofweave", "artifact-store-test", "Artifact Store Test", "2026-07-13T00:00:00Z"],
    ],
    [
      `INSERT INTO source_snapshots (
        id, upstream_name, source_url, revision_tag, revision_commit, retrieved_at,
        content_hash, manifest_hash, source_license, lean_toolchain, mathlib_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["snapshot:artifact-store-test", "fixture", "https://example.test/source", "v1", "abc123", "2026-07-13T00:00:00Z", sha("1"), sha("2"), "MIT", "leanprover/lean4:v4.27.0", "abc123"],
    ],
    [
      "INSERT INTO projects (id, slug, kind, title, summary) VALUES (?, ?, ?, ?, ?)",
      ["project:artifact-store-test", "artifact-store-test", "frontier", "Artifact Store", "Fixture project"],
    ],
    [
      `INSERT INTO problem_revisions (
        id, project_id, source_snapshot_id, target_key, slug, revision_number,
        title, domain, research_status, informal_statement, lean_statement
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["revision:artifact-store-test", "project:artifact-store-test", "snapshot:artifact-store-test", "artifact-store-target", "artifact-store-target", 1, "Artifact target", "logic", "research_open", "fixture", "theorem fixture : True := by trivial"],
    ],
    [
      "INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)",
      ["person-key:artifact-store-test", "person:artifact-store-test", "person-key", sha("3")],
    ],
    [
      "INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)",
      ["agent:artifact-store-test", "person:artifact-store-test", "Artifact Agent", publicKey, sha("4")],
    ],
    [
      `INSERT INTO delegation_certificates (
        id, owner_person_id, agent_id, person_key_id, agent_public_key,
        scopes_json, valid_from, valid_until, beneficiary_person_id,
        protocol_version, payload_hash, canonical_payload, person_signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["delegation:artifact-store-test", "person:artifact-store-test", "agent:artifact-store-test", "person-key:artifact-store-test", publicKey, '["prove"]', "2026-07-01T00:00:00Z", "2027-07-01T00:00:00Z", "person:artifact-store-test", "pw-delegation-v1", sha("5"), "{}", "signature"],
    ],
    [
      `INSERT INTO agent_attempts (
        id, person_id, problem_revision_id, agent_id, delegation_certificate_id,
        delegation_scope, agent_label, idempotency_key, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["attempt:artifact-store-test", "person:artifact-store-test", "revision:artifact-store-test", "agent:artifact-store-test", "delegation:artifact-store-test", "prove", "Artifact Agent", "attempt-artifact-store-test", "2026-07-13T00:00:00Z"],
    ],
  ];
  for (const [statement, values] of statements) {
    await d1.prepare(statement).bind(...values).run();
  }
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
