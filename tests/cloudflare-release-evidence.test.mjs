import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import { LibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import { applyProofweaveMigrations, loadProofweaveMigrations } from "../services/database/libsql-migrations.mjs";
import { bindCloudflareReleaseEvidence as bind, inspectCloudflareReleaseEvidence as inspect, releaseEvidenceHash } from "../scripts/lib/cloudflare-release-evidence.mjs";
import { releaseFixture } from "./fixtures/cloudflare-release-evidence.mjs";

test("binds separate Cloudflare, Runner, E2B and Sites bridge identities while paused", async () => {
  const fixture = await releaseFixture({ production: true });
  const result = await bind(fixture);
  assert.equal(result.runnerState, "paused");
  assert.equal(result.migrationHead, "0049_add_catalog_browse_index.sql");
  assert.notEqual(fixture.manifest.cloudflare.sourceRevision, fixture.manifest.runner.revision);
  assert.notEqual(fixture.manifest.runner.sitesVersion, fixture.manifest.loginBridge.sitesVersion);
  assert.equal(fixture.observation.cloudflare.capabilities.releaseDiagnostics.sitesVersion, null);
});

test("accepts a Git-bound candidate without replacing its SHA by a snapshot digest", async () => {
  const f = await releaseFixture();
  f.manifest.cloudflare.sourceKind = "git_commit"; f.manifest.cloudflare.sourceRevision = "d".repeat(40);
  f.observation.cloudflare.capabilities.releaseDiagnostics.sourceRevision = f.manifest.cloudflare.sourceRevision;
  f.observation.cloudflare.deployment.sourceRevision = f.manifest.cloudflare.sourceRevision;
  f.expectedManifestHash = releaseEvidenceHash(f.manifest);
  await bind(f);
});

test("checks a real libSQL ledger using the migration verifier and bounded 0039 alias", async t => {
  const client = createClient({ url: ":memory:" }); t.after(() => client.close());
  const database = new LibsqlD1Database(client);
  await applyProofweaveMigrations({ database, migrations: await loadProofweaveMigrations(), now: () => new Date("2026-07-29T09:00:00Z") });
  const f = await releaseFixture();
  f.observation.database.ledger = structuredClone((await database.prepare("SELECT * FROM _proofweave_migrations ORDER BY name").all()).results);
  f.manifest.database.ledgerDigest = releaseEvidenceHash(f.observation.database.ledger);
  f.expectedManifestHash = releaseEvidenceHash(f.manifest); await bind(f);
  const row = f.observation.database.ledger[39]; row.sha256 = "03f7f5819c18255fb8264b8fe3c0c4c4d7458dd050b7bd1a6b8a8249cefe001c"; row.statement_count = 12;
  f.manifest.database.ledgerDigest = releaseEvidenceHash(f.observation.database.ledger);
  f.expectedManifestHash = releaseEvidenceHash(f.manifest); await bind(f);
  row.sha256 = "0".repeat(64);
  await assert.rejects(bind(f), /integrity mismatch/);
});

test("rejects unreviewed or missing manifest hashes", async () => {
  const f = await releaseFixture();
  await assert.rejects(bind({ ...f, expectedManifestHash: undefined }), /REVIEWED_MANIFEST_HASH_REQUIRED/);
  f.manifest.runner.revision = "b".repeat(40);
  await assert.rejects(bind(f), /REVIEWED_MANIFEST_HASH_MISMATCH/);
});

test("rejects unknown manifest fields, origins, ambiguous source kinds and authority relabeling", async t => {
  const cases = [
    f => { f.manifest.extra = true; },
    f => { f.manifest.cloudflare.sourceKind = "unknown"; },
    f => { f.manifest.cloudflare.sourceKind = "git_commit"; },
    f => { f.manifest.environment.origin += "/"; },
    f => { f.manifest.environment.origin = "http://staging.example"; },
    f => { f.manifest.environment.origin = "https://proofweave.org"; },
    f => { f.manifest.database.fingerprint = "3f9e7934a04a22ec"; },
    f => { f.manifest.environment.kind = "production"; },
    f => { f.manifest.loginBridge.origin = f.manifest.runner.origin; },
    f => { delete f.manifest.e2b.templateBuildId; },
  ];
  for (const [i, mutate] of cases.entries()) await t.test(String(i), async () => {
    const f = await releaseFixture(); mutate(f); f.expectedManifestHash = releaseEvidenceHash(f.manifest);
    await assert.rejects(bind(f));
  });
});

test("rejects component, policy, database and frozen-surface drift", async t => {
  const cases = [
    ["Cloudflare origin", f => { f.observation.cloudflare.origin = "https://other.example"; }],
    ["source", f => { f.observation.cloudflare.capabilities.releaseDiagnostics.sourceRevision = "0".repeat(64); }],
    ["deployment", f => { f.observation.cloudflare.deployment.id = "unknown"; }],
    ["artifact", f => { f.observation.cloudflare.deployment.artifactDigest = "sha256:" + "0".repeat(64); }],
    ["fake Sites identity", f => { f.observation.cloudflare.capabilities.releaseDiagnostics.sitesVersion = "204"; }],
    ["unknown diagnostics key", f => { f.observation.cloudflare.capabilities.releaseDiagnostics.extra = true; }],
    ["degraded", f => { f.observation.cloudflare.capabilities.releaseDiagnostics.state = "degraded"; }],
    ["failure code", f => { f.observation.cloudflare.capabilities.releaseDiagnostics.failureCode = "failed"; }],
    ["Runner SHA", f => { f.observation.runner.health.revision = "b".repeat(40); }],
    ["Runner Sites label", f => { f.observation.runner.health.releaseDiagnostics.sitesVersion = "204"; }],
    ["Render deployment", f => { f.observation.runner.deployment.id = "dep-other"; }],
    ["auto deploy", f => { f.observation.runner.deployment.autoDeploy = "yes"; }],
    ["execution", f => { f.observation.runner.health.executionEnabled = true; }],
    ["template build", f => { f.observation.runner.health.runnerPolicy.templateBuildId = "other"; }],
    ["image", f => { f.observation.runner.health.runnerPolicy.sandboxImageApproved = false; }],
    ["toolchain", f => { f.observation.runner.health.runnerPolicy.approvedImages[0].leanToolchain = "other"; }],
    ["Mathlib", f => { f.observation.runner.health.runnerPolicy.approvedImages[0].mathlibRevision = "0".repeat(40); }],
    ["E2B provider build", f => { f.observation.e2b.templateBuildId = "unknown-build"; }],
    ["unknown approved image", f => { f.observation.runner.health.runnerPolicy.approvedImages.push({ ...f.observation.runner.health.runnerPolicy.approvedImages[0], imageDigest: "registry.example/runner@sha256:" + "9".repeat(64) }); }],
    ["bridge SHA", f => { f.observation.loginBridge.sourceRevision = "c".repeat(40); }],
    ["bridge version", f => { f.observation.loginBridge.sitesVersion = "192"; }],
    ["bridge artifact", f => { f.observation.loginBridge.artifactDigest = "sha256:" + "0".repeat(64); }],
    ["database", f => { f.observation.database.fingerprint = "fedcba9876543210"; }],
    ["participant", f => { f.observation.cloudflare.capabilities.participantOperations.writesEnabled = true; }],
    ["MCP", f => { f.observation.cloudflare.capabilities.mcpOperations.mode = "read_write"; }],
    ["missing config", f => { f.observation.cloudflare.capabilities.globalControlPlaneOperations.explicitlyConfigured = false; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const f = await releaseFixture(); mutate(f); await assert.rejects(bind(f));
  });
});

test("rejects missing, altered, unknown and truncated migration identities even if their digest is pinned", async t => {
  const cases = [
    rows => { rows.pop(); },
    rows => { rows[49].statement_count = 37; },
    rows => { rows[49].sha256 = "0".repeat(64); },
    rows => { rows[49].name = "0049_other.sql"; },
    rows => { rows.push({ ...rows[49], name: "0050_unknown.sql" }); },
    rows => { rows.splice(39, 1); },
    rows => { rows[49].applied_at = "invalid"; },
    rows => { rows[49].applied_at = "2026-07-29T12:00:00Z"; },
  ];
  for (const [i, mutate] of cases.entries()) await t.test(String(i), async () => {
    const f = await releaseFixture(); mutate(f.observation.database.ledger);
    f.manifest.database.ledgerDigest = releaseEvidenceHash(f.observation.database.ledger);
    f.expectedManifestHash = releaseEvidenceHash(f.manifest); await assert.rejects(bind(f));
  });
});

test("public inspection performs only fixed GETs and binds independently supplied provider records", async () => {
  const f = await releaseFixture(); const calls = [];
  const result = await inspect({ ...f, providerObservation: f.observation, fetcher: async (url, init) => {
    calls.push([url, init]);
    return Response.json(url.endsWith("/healthz") ? f.observation.runner.health : f.observation.cloudflare.capabilities);
  } });
  assert.equal(result.binding.runnerState, "paused");
  assert.equal(result.boundary.executionAuthorized, false);
  assert.deepEqual(calls.map(([u]) => u).sort(), ["https://runner.example/healthz", "https://staging.example/api/mcp/capabilities"]);
  for (const [, options] of calls) { assert.equal(options.method, "GET"); assert.equal(options.redirect, "error"); assert.ok(options.signal); assert.equal(options.body, undefined); }
});

test("public inspection rejects redirect, non-JSON, large or bad responses", async t => {
  const responses = [
    () => new Response(null, { status: 302 }),
    () => new Response("{}", { headers: { "content-type": "text/html" } }),
    () => new Response(" ".repeat(65537), { headers: { "content-type": "application/json" } }),
    () => new Response("{", { headers: { "content-type": "application/json" } }),
    () => { throw Error("network unavailable"); },
  ];
  for (const [i, response] of responses.entries()) await t.test(String(i), async () => {
    const f = await releaseFixture();
    await assert.rejects(inspect({ ...f, providerObservation: f.observation, fetcher: response }));
  });
  let calls = 0; const f = await releaseFixture();
  await assert.rejects(inspect({ ...f, expectedManifestHash: "bad", fetcher: async () => { calls++; } }));
  assert.equal(calls, 0);
});


test("missing component sections and malformed observation times fail closed", async t => {
  for (const name of ["observedAt", "cloudflare", "runner", "e2b", "loginBridge", "database"]) {
    await t.test(name, async () => { const f = await releaseFixture(); delete f.observation[name]; await assert.rejects(bind(f)); });
  }
  for (const observedAt of ["invalid", "2026-02-31T10:00:00Z", "2026-07-29T10:00:00+00:00"]) {
    const f = await releaseFixture(); f.observation.observedAt = observedAt;
    await assert.rejects(bind(f), /OBSERVATION_TIME_INVALID/);
  }
});

test("async inspection snapshots reviewed inputs instead of accepting caller mutation", async () => {
  const f = await releaseFixture();
  const pending = bind(f);
  f.manifest.runner.revision = "b".repeat(40);
  f.observation.runner.health.executionEnabled = true;
  const result = await pending;
  assert.equal(result.runnerState, "paused");
  assert.notEqual(result.manifestHash, releaseEvidenceHash(f.manifest));
});
