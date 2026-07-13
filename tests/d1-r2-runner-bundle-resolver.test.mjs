import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { D1R2ArtifactStore } from "../services/artifacts/d1-r2-artifact-store.mjs";
import {
  D1R2RunnerBundleResolver,
  RunnerBundleResolutionError,
} from "../services/lean-runner/d1-r2-runner-bundle-resolver.mjs";
import { createLeanRunnerRequest } from "../packages/protocol/lean-runner.mjs";
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

test("Runner resolves only the staged canonical bundle and exact immutable object references", async () => {
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
  const bundle = await signedBundle({ archive, patch, lakeManifest });
  const staged = await store.stageBundle(bundle);
  const request = await createLeanRunnerRequest({
    jobId: "run:bundle-resolver-test",
    idempotencyKey: "bundle-resolver-idempotency",
    artifactBundle: bundle,
    imageDigest: `registry.cloudflare.com/proofweave/lean-runner@sha256:${"a".repeat(64)}`,
    limits: { cpuSeconds: 60, wallSeconds: 120, memoryMiB: 2_048, diskMiB: 2_048, outputBytes: 1_000_000 },
  });
  const resolver = new D1R2RunnerBundleResolver({ database, bucket });

  const resolved = await resolver.resolve(request);
  assert.equal(resolved.manifest.contentHash, staged.bundle.manifestHash);
  assert.equal(resolved.bundle.id, bundle.id);
  assert.deepEqual(resolved.objects.sourceArchive, {
    objectKey: archive.objectKey,
    contentHash: archive.contentHash,
    byteLength: archive.byteLength,
    contentType: archive.contentType,
  });
  assert.equal(resolved.objects.lakeManifest.contentHash, lakeManifest.contentHash);

  await assert.rejects(
    resolver.resolve({
      ...request,
      environment: { ...request.environment, mathlibRevision: "substituted-mathlib" },
    }),
    /Lean environment does not match/,
  );
  await assert.rejects(
    resolver.resolve({
      ...request,
      bundle: { ...request.bundle, entryCommand: ["lake", "env", "lean", "Substituted.lean"] },
    }),
    /entry command does not match/,
  );
  await assert.rejects(
    resolver.resolve({
      ...request,
      policy: { ...request.policy, allowedAxioms: ["Classical.choice"] },
    }),
    /policy does not match/,
  );

  const archiveBytes = await (await bucket.get(archive.objectKey)).arrayBuffer();
  await bucket.delete(archive.objectKey);
  await assert.rejects(resolver.resolve(request), /source archive is missing from R2/);
  await bucket.put(archive.objectKey, archiveBytes, {
    httpMetadata: { contentType: archive.contentType },
    customMetadata: { sha256: archive.contentHash },
  });

  const original = new Uint8Array(await (await bucket.get(staged.bundle.manifestKey)).arrayBuffer());
  original[0] = original[0] === 123 ? 124 : 123;
  await bucket.put(staged.bundle.manifestKey, original, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { sha256: staged.bundle.manifestHash },
  });
  await assert.rejects(
    resolver.resolve(request),
    (error) => error instanceof RunnerBundleResolutionError && /content hash/.test(error.message),
  );
});

async function signedBundle({ archive, patch, lakeManifest }) {
  const bundle = {
    protocolVersion: "pw-artifact-bundle-v1",
    id: "bundle:runner-bundle-resolver-test",
    attemptId: "attempt:runner-bundle-resolver-test",
    problemRevisionId: "revision:runner-bundle-resolver-test",
    target: { declaration: "Proofweave.RunnerBundle.target", statementHash: sha("a") },
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
    entryCommand: ["lake", "env", "lean", "Proofweave/RunnerBundle.lean"],
    dependencyReceipts: [],
    agentEvent: {
      eventId: "agent-event:runner-bundle-resolver-test",
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
      ["person:runner-bundle-resolver-test", "proofweave", "runner-bundle-resolver-test", "Runner Bundle Resolver Test", "2026-07-13T00:00:00Z"],
    ],
    [
      `INSERT INTO source_snapshots (
        id, upstream_name, source_url, revision_tag, revision_commit, retrieved_at,
        content_hash, manifest_hash, source_license, lean_toolchain, mathlib_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["snapshot:runner-bundle-resolver-test", "fixture", "https://example.test/source", "v1", "abc123", "2026-07-13T00:00:00Z", sha("1"), sha("2"), "MIT", "leanprover/lean4:v4.27.0", "abc123"],
    ],
    [
      "INSERT INTO projects (id, slug, kind, title, summary) VALUES (?, ?, ?, ?, ?)",
      ["project:runner-bundle-resolver-test", "runner-bundle-resolver-test", "frontier", "Runner Bundle Resolver", "Fixture project"],
    ],
    [
      `INSERT INTO problem_revisions (
        id, project_id, source_snapshot_id, target_key, slug, revision_number,
        title, domain, research_status, informal_statement, lean_statement
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["revision:runner-bundle-resolver-test", "project:runner-bundle-resolver-test", "snapshot:runner-bundle-resolver-test", "runner-bundle-resolver-target", "runner-bundle-resolver-target", 1, "Runner Bundle Resolver target", "logic", "research_open", "fixture", "theorem fixture : True := by trivial"],
    ],
    [
      "INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)",
      ["person-key:runner-bundle-resolver-test", "person:runner-bundle-resolver-test", "person-key", sha("3")],
    ],
    [
      "INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)",
      ["agent:runner-bundle-resolver-test", "person:runner-bundle-resolver-test", "Runner Bundle Resolver Agent", publicKey, sha("4")],
    ],
    [
      `INSERT INTO delegation_certificates (
        id, owner_person_id, agent_id, person_key_id, agent_public_key,
        scopes_json, valid_from, valid_until, beneficiary_person_id,
        protocol_version, payload_hash, canonical_payload, person_signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["delegation:runner-bundle-resolver-test", "person:runner-bundle-resolver-test", "agent:runner-bundle-resolver-test", "person-key:runner-bundle-resolver-test", publicKey, '["prove"]', "2026-07-01T00:00:00Z", "2027-07-01T00:00:00Z", "person:runner-bundle-resolver-test", "pw-delegation-v1", sha("5"), "{}", "signature"],
    ],
    [
      `INSERT INTO agent_attempts (
        id, person_id, problem_revision_id, agent_id, delegation_certificate_id,
        delegation_scope, agent_label, idempotency_key, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["attempt:runner-bundle-resolver-test", "person:runner-bundle-resolver-test", "revision:runner-bundle-resolver-test", "agent:runner-bundle-resolver-test", "delegation:runner-bundle-resolver-test", "prove", "Runner Bundle Resolver Agent", "attempt-runner-bundle-resolver-test", "2026-07-13T00:00:00Z"],
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
