import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { delegationSigningPayload } from "../packages/domain/delegation.mjs";
import { canonicalJson } from "../packages/protocol/canonical-json.mjs";

const repositoryRoot = new URL("../", import.meta.url);
const migrationsRoot = new URL("../drizzle/", import.meta.url);
const workerRoot = new URL("../dist/server/", import.meta.url);
let miniflare;
let database;

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
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('person_keys', 'agents', 'delegation_certificates', 'delegation_revocations') ORDER BY name",
    )
    .all();
  assert.deepEqual(
    tables.results.map((row) => row.name),
    ["agents", "delegation_certificates", "delegation_revocations", "person_keys"],
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

  const progressResponse = await render(`/api/v1/mcp/attempts/${attempt.id}/events`, {
    method: "POST",
    headers: { authorization: `Bearer ${testToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: "This must not be recorded after revocation.",
      progressPercent: 1,
      idempotencyKey: "delegation-progress-after-revocation",
    }),
  });
  assert.equal(progressResponse.status, 412);
});

test("keeps the production frontend free of the deleted starter preview", async () => {
  const [page, layout, packageJson, workbench, legacyContent] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(
      new URL("../app/workbench/workbench-sections.tsx", import.meta.url),
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
  assert.match(workbench, /Local preview/);
  assert.match(workbench, /Illustrative only/);
  assert.match(workbench, /Independent review/);
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
