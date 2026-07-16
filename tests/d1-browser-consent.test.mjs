import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { createD1BrowserConsentResolver } from "../services/proofweave-identity/browser-consent.mjs";
import { D1ProofweaveOAuthStore } from "../services/proofweave-identity/d1-oauth-store.mjs";
import { createProofweaveOAuthProvider } from "../services/proofweave-identity/oauth.mjs";
import { createSitesChatGPTSessionResolver } from "../services/proofweave-identity/sites-session.mjs";
import {
  createD1SitesIdentityRuntime,
  SitesIdentityRuntimeConfigurationError,
} from "../services/proofweave-identity/sites-runtime.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
const resource = "https://mcp.example.test/mcp";
const issuer = "https://proofweave.example.test";
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
  await seed(database);
});

after(async () => {
  await miniflare?.dispose();
});

test("browser consent creates a one-time, Person-bound Agent installation and PKCE authorization code", async () => {
  const store = new D1ProofweaveOAuthStore(database);
  const provider = createProofweaveOAuthProvider({
    resource,
    store,
    sessionResolver: {
      async currentSession() { return { personId: "person:browser-consent" }; },
      authorizationRequired() { return new Response("Sign in", { status: 401 }); },
    },
    consentResolver: createD1BrowserConsentResolver({ store }),
  });
  const response = await provider.authorize(new Request(
    `${issuer}/authorize?response_type=code&client_id=codex-browser&redirect_uri=${encodeURIComponent("https://codex.example.test/callback")}&resource=${encodeURIComponent(resource)}&scope=attempt%3Acreate%20catalog%3Aread&state=state-123&code_challenge=pkce-challenge&code_challenge_method=S256`,
  ));
  assert.equal(response.status, 200);
  assert.doesNotMatch(response.headers.get("content-security-policy") ?? "", /script-src/);
  const html = await response.text();
  assert.doesNotMatch(html, /<script/i);
  const challengeId = hiddenValue(html, "challenge_id");
  const csrfToken = hiddenValue(html, "csrf_token");
  const choice = html.match(/<option value="([^"]+)"/i)?.[1];
  assert.ok(choice);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);

  const approved = await provider.authorize(new Request(`${issuer}/authorize`, {
    method: "POST",
    headers: { cookie },
    body: new URLSearchParams({
      challenge_id: challengeId,
      csrf_token: csrfToken,
      agent_choice: decodeHtml(choice),
      decision: "approve",
    }),
  }));
  assert.equal(approved.status, 302);
  const callback = new URL(approved.headers.get("location"));
  assert.equal(callback.searchParams.get("state"), "state-123");
  const code = callback.searchParams.get("code");
  assert.ok(code);

  const exchanged = await store.consumeAuthorizationCode(await sha256(code), new Date().toISOString());
  assert.deepEqual(exchanged?.scopes, ["attempt:create", "catalog:read"]);
  assert.deepEqual(exchanged?.personId, "person:browser-consent");
  assert.match(exchanged?.agentInstallationId ?? "", /^agent-installation:/);

  const replay = await provider.authorize(new Request(`${issuer}/authorize`, {
    method: "POST",
    headers: { cookie },
    body: new URLSearchParams({
      challenge_id: challengeId,
      csrf_token: csrfToken,
      agent_choice: decodeHtml(choice),
      decision: "approve",
    }),
  }));
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).error, "invalid_request");
});

test("browser consent hides an Agent whose delegation does not cover the requested OAuth scope", async () => {
  const store = new D1ProofweaveOAuthStore(database);
  const provider = createProofweaveOAuthProvider({
    resource,
    store,
    sessionResolver: {
      async currentSession() { return { personId: "person:browser-consent" }; },
      authorizationRequired() { return new Response("Sign in", { status: 401 }); },
    },
    consentResolver: createD1BrowserConsentResolver({ store }),
  });
  const response = await provider.authorize(new Request(
    `${issuer}/authorize?response_type=code&client_id=codex-browser&redirect_uri=${encodeURIComponent("https://codex.example.test/callback")}&resource=${encodeURIComponent(resource)}&scope=verification%3Awrite&code_challenge=pkce-challenge&code_challenge_method=S256`,
  ));
  const html = await response.text();
  assert.match(html, /No active Agent can receive these scopes/);
  assert.doesNotMatch(html, /Browser Consent Agent/);
});

test("closed-alpha session bridge redirects unsigned browsers and never creates a Person during OAuth", async () => {
  const observed = [];
  const resolver = createSitesChatGPTSessionResolver({
    store: {
      async findChatGPTPerson(email) {
        observed.push(email);
        return email === "owner@example.test" ? { id: "person:browser-consent", displayName: "Owner" } : null;
      },
      async findAppSessionPerson() { return null; },
    },
  });
  assert.deepEqual(
    await resolver.currentSession(new Request(`${issuer}/authorize`, {
      headers: { "oai-authenticated-user-email": "OWNER@example.test" },
    })),
    { personId: "person:browser-consent", displayName: "Owner" },
  );
  assert.deepEqual(observed, ["owner@example.test"]);
  const unsigned = resolver.authorizationRequired(new Request(`${issuer}/authorize?client_id=codex-browser`));
  assert.equal(unsigned.status, 302);
  assert.equal(
    unsigned.headers.get("location"),
    `${issuer}/sign-in?return_to=%2Fauthorize%3Fclient_id%3Dcodex-browser`,
  );
  assert.equal(
    resolver.authorizationRequired(new Request(`${issuer}/authorize`, {
      headers: { "oai-authenticated-user-email": "not-created@example.test" },
    })).status,
    403,
  );
});

test("Sites identity accepts a live provider-neutral app session for browser consent", async () => {
  const rawToken = "google-app-session-token";
  await database.prepare(
    `INSERT INTO person_identities (
       id, person_id, provider, provider_subject, email, email_normalized,
       display_name, email_verified_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    "identity:google-browser-consent",
    "person:browser-consent",
    "google",
    "google-subject-browser-consent",
    "owner@example.test",
    "owner@example.test",
    "Google Owner",
    "2026-07-16T00:00:00Z",
    "2026-07-16T00:00:00Z",
  ).run();
  await database.prepare(
    `INSERT INTO app_sessions (
       id, person_id, identity_id, token_hash, expires_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    "session:google-browser-consent",
    "person:browser-consent",
    "identity:google-browser-consent",
    await sha256(rawToken),
    "2099-07-16T00:00:00Z",
    "2026-07-16T00:00:00Z",
  ).run();
  const resolver = createSitesChatGPTSessionResolver({ store: new D1ProofweaveOAuthStore(database) });
  assert.deepEqual(
    await resolver.currentSession(new Request(`${issuer}/authorize`, {
      headers: { cookie: `__Host-pw_session=${rawToken}` },
    })),
    { personId: "person:browser-consent", displayName: "Google Owner" },
  );
});

test("Sites identity exposes dynamic registration only from explicit deployment allowlist JSON", async () => {
  const closed = createD1SitesIdentityRuntime({ database, resource, issuer });
  const closedMetadata = await (await closed.fetch(new Request(`${issuer}/.well-known/oauth-authorization-server`))).json();
  assert.equal(Object.hasOwn(closedMetadata, "registration_endpoint"), false);

  const enabled = createD1SitesIdentityRuntime({
    database,
    resource,
    issuer,
    clientRegistrationAllowlistJson: JSON.stringify([{
      client_name: "Approved Codex",
      redirect_uris: ["https://codex.example.test/callback"],
    }]),
  });
  const enabledMetadata = await (await enabled.fetch(new Request(`${issuer}/.well-known/oauth-authorization-server`))).json();
  assert.equal(enabledMetadata.registration_endpoint, `${issuer}/register`);
  const approvedMetadata = {
    client_name: "Approved Codex",
    redirect_uris: ["https://codex.example.test/callback"],
  };
  const first = await enabled.fetch(clientRegistrationRequest(approvedMetadata));
  assert.equal(first.status, 201);
  const firstClient = await first.json();
  assert.match(firstClient.client_id, /^pw_client:/);
  const replay = await enabled.fetch(clientRegistrationRequest(approvedMetadata));
  assert.equal(replay.status, 201);
  assert.equal((await replay.json()).client_id, firstClient.client_id);
  const rejected = await enabled.fetch(clientRegistrationRequest({
    client_name: "Unapproved client",
    redirect_uris: ["https://attacker.example.test/callback"],
  }));
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).error, "access_denied");
  assert.throws(
    () => createD1SitesIdentityRuntime({
      database,
      resource,
      issuer,
      clientRegistrationAllowlistJson: "not-json",
    }),
    SitesIdentityRuntimeConfigurationError,
  );
  assert.throws(
    () => createD1SitesIdentityRuntime({
      database,
      resource,
      issuer,
      clientRegistrationAllowlistJson: "[]",
    }),
    SitesIdentityRuntimeConfigurationError,
  );
  assert.throws(
    () => createD1SitesIdentityRuntime({
      database,
      resource: `${resource}#fragment`,
      issuer,
    }),
    /MCP_RESOURCE_URL must be an HTTPS URL/,
  );
  assert.throws(
    () => createD1SitesIdentityRuntime({
      database,
      resource,
      issuer: `${issuer}/identity`,
    }),
    /OAuth issuer must be an HTTPS origin/,
  );
});

function clientRegistrationRequest(metadata) {
  return new Request(`${issuer}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(metadata),
  });
}

function hiddenValue(html, name) {
  const value = html.match(new RegExp(`<input type="hidden" name="${name}" value="([^"]+)"`))?.[1];
  assert.ok(value, `expected ${name} hidden field`);
  return value;
}

function decodeHtml(value) {
  return value.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function seed(d1) {
  const statements = [
    [
      "INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)",
      ["person:browser-consent", "chatgpt", "owner@example.test", "Browser Consent Owner", "2026-07-14T00:00:00Z"],
    ],
    [
      "INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)",
      ["person-key:browser-consent", "person:browser-consent", "person-key", "sha256:person-key-browser-consent"],
    ],
    [
      "INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)",
      ["agent:browser-consent", "person:browser-consent", "Browser Consent Agent", "agent-key", "sha256:agent-key-browser-consent"],
    ],
    [
      `INSERT INTO delegation_certificates (
        id, owner_person_id, agent_id, person_key_id, agent_public_key,
        scopes_json, valid_from, valid_until, beneficiary_person_id,
        protocol_version, payload_hash, canonical_payload, person_signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "delegation:browser-consent", "person:browser-consent", "agent:browser-consent", "person-key:browser-consent", "agent-key",
        '["formalize","prove"]', "2026-07-13T00:00:00Z", "2027-07-13T00:00:00Z", "person:browser-consent",
        "pw-delegation-v1", "sha256:delegation-browser-consent", "{}", "signature",
      ],
    ],
    [
      "INSERT INTO oauth_clients (id, client_name, redirect_uris_json) VALUES (?, ?, ?)",
      ["codex-browser", "Codex Browser Test", '["https://codex.example.test/callback"]'],
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
