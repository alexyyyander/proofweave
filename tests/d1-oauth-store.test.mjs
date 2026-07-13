import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { D1ProofweaveOAuthStore } from "../services/proofweave-identity/d1-oauth-store.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
let miniflare;
let database;

before(async () => {
  miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
  });
  database = await miniflare.getD1Database("DB");
  await applyMigrations(database);
  await seedIdentityRows(database);
});

after(async () => {
  await miniflare?.dispose();
});

test("D1 OAuth store atomically consumes credentials and invalidates an installation after delegation revocation", async () => {
  const store = new D1ProofweaveOAuthStore(database);
  const now = "2026-07-13T12:00:00Z";

  assert.deepEqual(
    await store.findClient("codex-test", "https://codex.example.test/callback"),
    { id: "codex-test", clientName: "Codex test" },
  );
  assert.deepEqual(
    await store.findAgentInstallation(
      "person:oauth-test",
      "installation:oauth-test",
      "codex-test",
    ),
    { id: "installation:oauth-test", delegationScopes: ["formalize", "prove"] },
  );
  assert.equal(
    await store.findAgentInstallation(
      "person:oauth-test",
      "installation:oauth-test",
      "codex-test",
      "review",
    ),
    null,
  );

  await store.issueAuthorizationCode({
    codeHash: "code-hash-1",
    clientId: "codex-test",
    redirectUri: "https://codex.example.test/callback",
    resource: "https://mcp.example.test/mcp",
    personId: "person:oauth-test",
    agentInstallationId: "installation:oauth-test",
    scopes: ["catalog:read", "attempt:create"],
    codeChallenge: "challenge",
    issuedAt: now,
    expiresAt: "2026-07-13T12:05:00Z",
  });
  const code = await store.consumeAuthorizationCode("code-hash-1", now);
  assert.deepEqual(code, {
    clientId: "codex-test",
    redirectUri: "https://codex.example.test/callback",
    resource: "https://mcp.example.test/mcp",
    personId: "person:oauth-test",
    agentInstallationId: "installation:oauth-test",
    scopes: ["catalog:read", "attempt:create"],
    codeChallenge: "challenge",
    expiresAt: "2026-07-13T12:05:00Z",
  });
  assert.equal(await store.consumeAuthorizationCode("code-hash-1", now), null);

  await store.issueTokenPair({
    accessTokenHash: "access-hash-1",
    refreshTokenHash: "refresh-hash-1",
    clientId: "codex-test",
    resource: "https://mcp.example.test/mcp",
    personId: "person:oauth-test",
    agentInstallationId: "installation:oauth-test",
    scopes: ["catalog:read"],
    issuedAt: now,
    accessExpiresAt: "2026-07-13T13:00:00Z",
    refreshExpiresAt: "2026-08-13T12:00:00Z",
  });
  assert.equal(
    (await store.findAccessToken("access-hash-1", "https://mcp.example.test/mcp", now))?.installationActive,
    true,
  );
  await store.issueTokenPair({
    accessTokenHash: "access-hash-review-1",
    refreshTokenHash: "refresh-hash-review-1",
    clientId: "codex-test",
    resource: "https://mcp.example.test/mcp",
    personId: "person:oauth-test",
    agentInstallationId: "installation:oauth-test",
    scopes: ["verification:write"],
    issuedAt: now,
    accessExpiresAt: "2026-07-13T13:00:00Z",
    refreshExpiresAt: "2026-08-13T12:00:00Z",
  });
  assert.equal(
    (await store.findAccessToken("access-hash-review-1", "https://mcp.example.test/mcp", now))?.installationActive,
    false,
  );
  assert.equal((await store.consumeRefreshToken("refresh-hash-1", now))?.clientId, "codex-test");
  assert.equal(await store.consumeRefreshToken("refresh-hash-1", now), null);

  await database.batch([
    database
      .prepare(
        "INSERT INTO agent_installation_revocations (id, agent_installation_id, owner_person_id, revoked_at, reason) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(
        "agent-installation-revocation:oauth-test",
        "installation:oauth-test",
        "person:oauth-test",
        now,
        "Owner revoked the Codex connection.",
      ),
    database
      .prepare("UPDATE agent_installations SET status = 'revoked', revoked_at = ? WHERE id = ?")
      .bind(now, "installation:oauth-test"),
  ]);
  assert.equal(
    await store.findAgentInstallation("person:oauth-test", "installation:oauth-test", "codex-test"),
    null,
  );
  assert.equal(
    (await store.findAccessToken("access-hash-1", "https://mcp.example.test/mcp", now))?.installationActive,
    false,
  );

  await database
    .prepare(
      "INSERT INTO person_key_revocations (id, person_key_id, owner_person_id, revoked_at, reason) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(
      "person-key-revocation:oauth-test",
      "person-key:oauth-test",
      "person:oauth-test",
      now,
      "Device replaced.",
    )
    .run();
  assert.equal(
    await store.findAgentInstallation("person:oauth-test", "installation:oauth-test", "codex-test"),
    null,
  );
  assert.equal(
    (await store.findAccessToken("access-hash-1", "https://mcp.example.test/mcp", now))?.installationActive,
    false,
  );

  await database
    .prepare(
      "INSERT INTO delegation_revocations (id, delegation_certificate_id, owner_person_id, revoked_at, reason) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(
      "delegation-revocation:oauth-test",
      "delegation:oauth-test",
      "person:oauth-test",
      now,
      "Agent authorization removed.",
    )
    .run();
  assert.equal(
    (await store.findAccessToken("access-hash-1", "https://mcp.example.test/mcp", now))?.installationActive,
    false,
  );
});

test("D1 OAuth client registration is idempotent for exactly one approved metadata record", async () => {
  const store = new D1ProofweaveOAuthStore(database);
  const metadata = {
    clientName: "Approved Codex",
    redirectUris: ["https://codex.example.test/callback"],
    tokenEndpointAuthMethod: "none",
  };
  const first = await store.registerClient(metadata);
  const replay = await store.registerClient({
    ...metadata,
    redirectUris: [...metadata.redirectUris],
  });
  assert.equal(first.client_id, replay.client_id);
  assert.match(first.client_id, /^pw_client:[a-f0-9]{64}$/);
  assert.deepEqual(
    await store.findClient(first.client_id, "https://codex.example.test/callback"),
    { id: first.client_id, clientName: "Approved Codex" },
  );
  const rows = await database
    .prepare("SELECT COUNT(*) AS count FROM oauth_clients WHERE id = ?")
    .bind(first.client_id)
    .first();
  assert.equal(rows.count, 1);
});

async function seedIdentityRows(d1) {
  const statements = [
    [
      "INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)",
      ["person:oauth-test", "proofweave", "oauth-test", "OAuth Test", "2026-07-13T00:00:00Z"],
    ],
    [
      "INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)",
      ["person-key:oauth-test", "person:oauth-test", "person-key", "sha256:person-key-oauth"],
    ],
    [
      "INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)",
      ["agent:oauth-test", "person:oauth-test", "OAuth Agent", "agent-key", "sha256:agent-key-oauth"],
    ],
    [
      `INSERT INTO delegation_certificates (
        id, owner_person_id, agent_id, person_key_id, agent_public_key,
        scopes_json, valid_from, valid_until, beneficiary_person_id,
        protocol_version, payload_hash, canonical_payload, person_signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "delegation:oauth-test", "person:oauth-test", "agent:oauth-test", "person-key:oauth-test", "agent-key",
        '["formalize","prove"]', "2026-07-13T00:00:00Z", "2027-07-13T00:00:00Z", "person:oauth-test",
        "pw-delegation-v1", "sha256:delegation-oauth", "{}", "signature",
      ],
    ],
    [
      "INSERT INTO oauth_clients (id, client_name, redirect_uris_json) VALUES (?, ?, ?)",
      ["codex-test", "Codex test", '["https://codex.example.test/callback"]'],
    ],
    [
      `INSERT INTO agent_installations (
        id, person_id, agent_id, delegation_certificate_id, client_id, label
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      ["installation:oauth-test", "person:oauth-test", "agent:oauth-test", "delegation:oauth-test", "codex-test", "Codex on test device"],
    ],
  ];

  for (const [statement, values] of statements) {
    await d1.prepare(statement).bind(...values).run();
  }
}

async function applyMigrations(d1) {
  const filenames = (await readdir(migrationsRoot))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  for (const filename of filenames) {
    const source = await readFile(new URL(filename, migrationsRoot), "utf8");
    for (const statement of source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await d1.prepare(statement).run();
    }
  }
}
