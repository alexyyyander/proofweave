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
