import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

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

test("issues owner-scoped MCP tokens and records idempotent provisional progress", async () => {
  const ownerHeaders = {
    "content-type": "application/json",
    "oai-authenticated-user-email": "mathematician@example.test",
    "oai-authenticated-user-full-name": encodeURIComponent("Test Mathematician"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
  const issueResponse = await render("/api/v1/mcp/tokens", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ name: "Codex integration test", expiresInDays: 30 }),
  });
  assert.equal(issueResponse.status, 201);
  const { token: issued } = await issueResponse.json();
  assert.match(issued.token, /^pw_mcp_[a-f0-9]{64}$/);
  assert.equal(issued.name, "Codex integration test");

  const storedToken = await database
    .prepare("SELECT token_hash FROM mcp_access_tokens WHERE id = ?")
    .bind(issued.id)
    .first();
  assert.match(storedToken.token_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(storedToken.token_hash, issued.token);

  const authHeaders = { authorization: `Bearer ${issued.token}` };
  const listResponse = await render("/api/v1/mcp/problems", {
    headers: authHeaders,
  });
  assert.equal(listResponse.status, 200);
  const { records } = await listResponse.json();
  assert.equal(records.length, 4);
  assert.equal(records[0].slug, "erdos-865");

  const attemptPayload = {
    problemSlug: "erdos-865",
    agentLabel: "codex-integration-test",
    idempotencyKey: "attempt-integration-test-001",
  };
  const createResponse = await render("/api/v1/mcp/attempts", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify(attemptPayload),
  });
  assert.equal(createResponse.status, 201);
  const { attempt: createdAttempt } = await createResponse.json();
  assert.equal(createdAttempt.verificationState, "agent_reported_only");
  assert.equal(createdAttempt.events.length, 1);
  assert.equal(createdAttempt.events[0].type, "attempt_created");

  const replayCreateResponse = await render("/api/v1/mcp/attempts", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify(attemptPayload),
  });
  assert.equal(replayCreateResponse.status, 200);
  assert.equal((await replayCreateResponse.json()).idempotentReplay, true);

  const progressPayload = {
    message: "Reduced the finite case to one bounded lemma.",
    progressPercent: 35,
    idempotencyKey: "progress-integration-test-001",
  };
  const progressResponse = await render(
    `/api/v1/mcp/attempts/${createdAttempt.id}/events`,
    {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify(progressPayload),
    },
  );
  assert.equal(progressResponse.status, 201);
  const { event } = await progressResponse.json();
  assert.equal(event.type, "agent_reported");
  assert.equal(event.sequence, 2);

  const replayProgressResponse = await render(
    `/api/v1/mcp/attempts/${createdAttempt.id}/events`,
    {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify(progressPayload),
    },
  );
  assert.equal(replayProgressResponse.status, 200);
  assert.equal((await replayProgressResponse.json()).idempotentReplay, true);

  const attemptResponse = await render(
    `/api/v1/mcp/attempts/${createdAttempt.id}`,
    { headers: authHeaders },
  );
  assert.equal(attemptResponse.status, 200);
  const { attempt } = await attemptResponse.json();
  assert.equal(attempt.lastProgressPercent, 35);
  assert.equal(attempt.events.length, 2);
  assert.equal(attempt.events[1].message, progressPayload.message);

  assert.equal((await render("/api/v1/mcp/problems")).status, 401);
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
