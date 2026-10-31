import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const workerRoot = new URL("../dist/server", import.meta.url);
const migrationsRoot = new URL("../drizzle/", import.meta.url);
const workerRootPath = fileURLToPath(workerRoot);

const researchWriteAllowlist = JSON.stringify({
  schemaVersion: "pw-research-write-allowlist-v1",
  persons: ["person:external-allowed"],
  agents: ["agent:external-allowed"],
  attempts: [],
  allowNewAttempts: true,
});

const allowedHeaders = {
  "oai-authenticated-user-email": "allowed@example.test",
  "oai-authenticated-user-full-name": "Allowed%20External",
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
};
const deniedHeaders = {
  "oai-authenticated-user-email": "denied@example.test",
  "oai-authenticated-user-full-name": "Denied%20External",
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
};

test("external-user eligibility, workbench guidance, and legal surfaces", async (t) => {
  const entrypoint = path.join(workerRootPath, "index.js");
  const modules = await listJavaScriptModules(workerRootPath);
  const worker = new Miniflare({
    modules: [
      { type: "ESModule", path: entrypoint },
      ...modules.filter((modulePath) => modulePath !== entrypoint).map((modulePath) => ({ type: "ESModule", path: modulePath })),
    ],
    modulesRoot: workerRootPath,
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    bindings: {
      PROOFWEAVE_DEMO_AUTH_ENABLED: "true",
      PROOFWEAVE_CONTROL_PLANE_MODE: "read_write",
      PROOFWEAVE_PARTICIPANT_CONTROL_PLANE_MODE: "read_write",
      PROOFWEAVE_MCP_CONTROL_PLANE_MODE: "read_write",
      PROOFWEAVE_PARTICIPANT_RESEARCH_WRITE_ALLOWLIST_JSON: researchWriteAllowlist,
      PROOFWEAVE_MCP_RESEARCH_WRITE_ALLOWLIST_JSON: researchWriteAllowlist,
    },
    serviceBindings: { ASSETS: async () => new Response("Not found", { status: 404 }) },
  });
  t.after(() => worker.dispose());
  const database = await worker.getD1Database("DB");
  await applyMigrations(database);
  await database.batch([
    database.prepare(
      `INSERT OR IGNORE INTO persons (id, identity_provider, provider_subject, display_name, updated_at)
       VALUES (?, 'chatgpt', ?, ?, ?)`,
    ).bind("person:external-allowed", "allowed@example.test", "Allowed External", "2026-10-27T00:00:00Z"),
    database.prepare(
      `INSERT OR IGNORE INTO persons (id, identity_provider, provider_subject, display_name, updated_at)
       VALUES (?, 'chatgpt', ?, ?, ?)`,
    ).bind("person:external-denied", "denied@example.test", "Denied External", "2026-10-27T00:00:00Z"),
    database.prepare(
      `INSERT OR IGNORE INTO agents (id, owner_person_id, label, public_key, key_fingerprint, status, revoked_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', NULL, ?)`,
    ).bind("agent:external-allowed", "person:external-allowed", "External Agent", "external-public-key", "sha256:external-agent-key", "2026-10-27T00:00:00Z"),
  ]);

  const request = (path, headers = {}) => worker.dispatchFetch(`http://localhost${path}`, {
    headers: { accept: "text/html", ...headers },
  });

  assert.equal((await request("/api/me/research-eligibility", { accept: "application/json" })).status, 401);

  const allowedResponse = await request("/api/me/research-eligibility", { ...allowedHeaders, accept: "application/json" });
  assert.equal(allowedResponse.status, 200);
  const allowed = await allowedResponse.json();
  assert.equal(allowed.eligibility.canWrite, true);
  assert.equal(allowed.eligibility.canCreateAttempt, true);
  assert.equal(allowed.eligibility.personAllowed, true);
  assert.equal(allowed.eligibility.agentsAllowed.allowed, 1);
  assert.equal(allowed.eligibility.reasons.length, 0);
  assert.equal(allowed.policy.verificationStatus, false);

  const deniedResponse = await request("/api/me/research-eligibility", { ...deniedHeaders, accept: "application/json" });
  assert.equal(deniedResponse.status, 200);
  const denied = await deniedResponse.json();
  assert.equal(denied.eligibility.canWrite, false);
  assert.equal(denied.eligibility.canCreateAttempt, false);
  assert.equal(denied.eligibility.reasons.includes("person_not_allowed"), true);
  const deniedJson = JSON.stringify(denied);
  assert.equal(deniedJson.includes("person:external-allowed"), false);
  assert.equal(deniedJson.includes("agent:external-allowed"), false);

  const allowedWorkbench = await request("/workbench", allowedHeaders);
  assert.equal(allowedWorkbench.status, 200);
  assert.match(await allowedWorkbench.text(), /Research writing is open for your Person and Agent/);
  const deniedWorkbench = await request("/workbench", deniedHeaders);
  assert.equal(deniedWorkbench.status, 200);
  const deniedWorkbenchHtml = await deniedWorkbench.text();
  assert.match(deniedWorkbenchHtml, /Your Person is not in the research write window/);
  assert.match(deniedWorkbenchHtml, /Request access/);

  const support = await request("/support");
  assert.equal(support.status, 200);
  assert.match(await support.text(), /security advisory/i);
  const terms = await request("/terms");
  assert.equal(terms.status, 200);
  const termsHtml = await terms.text();
  assert.match(termsHtml, /Content licence/);
  assert.match(termsHtml, /public contributions/i);
  const privacy = await request("/privacy");
  assert.equal(privacy.status, 200);
  const privacyHtml = await privacy.text();
  assert.match(privacyHtml, /Service providers/);
  assert.match(privacyHtml, /Deletion, export/);
  const reviewers = await request("/reviewers");
  assert.equal(reviewers.status, 200);
  assert.match(await reviewers.text(), /same current research write window/);

  const home = await request("/");
  assert.equal(home.status, 200);
  const homeHtml = await home.text();
  for (const link of ['href="/privacy"', 'href="/terms"', 'href="/support"']) assert.ok(homeHtml.includes(link), link);
});

async function listJavaScriptModules(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? listJavaScriptModules(target) : /\.(?:js|mjs)$/.test(entry.name) ? target : [];
  }));
  return files.flat();
}

async function applyMigrations(database) {
  const filenames = (await readdir(migrationsRoot)).filter((filename) => filename.endsWith(".sql")).sort();
  for (const filename of filenames) {
    const migration = await readFile(new URL(filename, migrationsRoot), "utf8");
    const statements = migration.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
    for (const statement of statements) await database.prepare(statement).run();
  }
}
