import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
const workerRoot = new URL("../dist/server/", import.meta.url);
const anonymousPaths = [
  "/",
  "/explore",
  "/explore/erdos-865-k2",
  "/demo",
];
const ordinaryEntryPaths = [
  "/",
  "/sign-in?return_to=%2Fworkbench%3Ftarget%3Derdos-865-k2%23research-launcher",
  "/explore/erdos-865-k2",
  "/workbench?target=erdos-865-k2",
  "/demo",
];
const authHeaders = {
  "oai-authenticated-user-email": "ordinary-user@example.test",
  "oai-authenticated-user-full-name": "Ordinary%20User",
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
};

let normalWorker;
let readOnlyWorker;
let storageUnavailableWorker;

before(async () => {
  normalWorker = await createWorker();
  await applyMigrations(await normalWorker.getD1Database("DB"));

  readOnlyWorker = await createWorker({
    bindings: { PROOFWEAVE_CONTROL_PLANE_MODE: "read_only" },
  });
  await applyMigrations(await readOnlyWorker.getD1Database("DB"));

  storageUnavailableWorker = await createWorker({ includeDatabase: false });
});

after(async () => {
  await Promise.all([
    normalWorker?.dispose(),
    readOnlyWorker?.dispose(),
    storageUnavailableWorker?.dispose(),
  ]);
});

test("an anonymous visitor can browse the public research journey without an account", async () => {
  for (const pathname of anonymousPaths) {
    const response = await render(normalWorker, pathname);
    assert.equal(response.status, 200, `${pathname} should remain publicly readable`);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    assert.doesNotMatch(
      await response.text(),
      /you must sign in to (?:view|read)|authentication required to (?:view|read)/i,
      `${pathname} should not imply that public reading requires an account`,
    );
  }

  const detail = await render(normalWorker, "/explore/erdos-865-k2");
  const detailText = defaultVisibleText(await detail.text());
  assert.match(detailText, /Erdős Problem 865: k = 2 variant/i);
  assert.match(detailText, /Pinned Lean statement/i);
  assert.match(detailText, /Source correspondence/i);
});

test("a selected target survives start, sign-in, and the ChatGPT handoff", async () => {
  const start = await render(normalWorker, "/start?target=erdos-865-k2", {
    redirect: "manual",
  });
  assert.equal(start.status, 307);
  assert.equal(
    new URL(start.headers.get("location")).pathname +
      new URL(start.headers.get("location")).search +
      new URL(start.headers.get("location")).hash,
    "/workbench?target=erdos-865-k2#research-launcher",
  );

  const workbench = await render(normalWorker, "/workbench?target=erdos-865-k2");
  const workbenchHtml = await workbench.text();
  assert.match(workbenchHtml, /Erdős Problem 865: k = 2 variant/i);
  assert.match(workbenchHtml, /exact target and source revision stay selected after sign-in/i);
  assert.match(
    workbenchHtml,
    /href="\/sign-in\?return_to=%2Fworkbench%3Ftarget%3Derdos-865-k2%23research-launcher"/i,
  );

  const signIn = await render(
    normalWorker,
    "/sign-in?return_to=%2Fworkbench%3Ftarget%3Derdos-865-k2%23research-launcher",
  );
  const signInHtml = await signIn.text();
  assert.match(
    signInHtml,
    /href="\/signin-with-chatgpt\?return_to=%2Fworkbench%3Ftarget%3Derdos-865-k2%23research-launcher"/i,
  );
});

test("the first-run path uses action language instead of protocol vocabulary", async () => {
  const welcome = defaultVisibleText(await (await render(normalWorker, "/")).text());
  assert.match(welcome, /Explore without an account/i);
  assert.match(welcome, /Watch the proof journey/i);

  const detail = defaultVisibleText(
    await (await render(normalWorker, "/explore/erdos-865-k2")).text(),
  );
  assert.match(detail, /Start with my Agent/i);
  assert.doesNotMatch(detail, /\bStart an Attempt\b/i);

  const workbench = defaultVisibleText(
    await (await render(normalWorker, "/workbench?target=erdos-865-k2")).text(),
  );
  assert.match(workbench, /Sign in to begin/i);
  assert.match(workbench, /Explore first/i);

  const demo = defaultVisibleText(await (await render(normalWorker, "/demo")).text());
  assert.match(demo, /Run the walkthrough/i);
  assert.match(demo, /Start with my Agent/i);
});

test("sign-in makes the available provider and unavailable provider unambiguous", async () => {
  const response = await render(
    normalWorker,
    "/sign-in?return_to=%2Fworkbench%3Ftarget%3Derdos-865-k2%23research-launcher",
  );
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(
    html,
    /class="auth-provider auth-provider-disabled" aria-disabled="true"[\s\S]*Continue with Google[\s\S]*Available after the deployment owner finishes Google OAuth setup[\s\S]*Soon/i,
  );
  assert.doesNotMatch(html, /href="\/auth\/google\/start/i);
  assert.match(
    html,
    /href="\/signin-with-chatgpt\?return_to=[^"]+"[\s\S]*Continue with ChatGPT/i,
  );
});

test("read-only mode never offers a connection write that the service will reject", async () => {
  const response = await render(
    readOnlyWorker,
    "/integrations?target=erdos-865-k2&return_to=%2Fworkbench%3Ftarget%3Derdos-865-k2%23research-launcher",
    { headers: authHeaders },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  const text = defaultVisibleText(html);

  assert.match(text, /Connections are temporarily paused for maintenance/i);
  assert.match(text, /No Agent connection, research task, or evidence write can complete/i);
  assert.match(html, /<button[^>]*disabled[^>]*>Connection temporarily paused<\/button>/i);
  assert.doesNotMatch(text, /Copy setup request/i);
  assert.doesNotMatch(text, /Approve and connect/i);

  const workbench = await render(readOnlyWorker, "/workbench?target=erdos-865-k2", {
    headers: authHeaders,
  });
  assert.equal(workbench.status, 200);
  const workbenchText = defaultVisibleText(await workbench.text());
  assert.match(workbenchText, /Research updates are temporarily paused/i);
  assert.match(workbenchText, /Your selected question is preserved/i);
  assert.doesNotMatch(workbenchText, /\bStart research\b/i);
  assert.doesNotMatch(workbenchText, /\bManage research\b/i);
});

test("missing durable storage fails closed instead of showing sample or writable work", async () => {
  const response = await render(
    storageUnavailableWorker,
    "/workbench?target=erdos-865-k2",
    { headers: authHeaders },
  );
  assert.equal(response.status, 200);
  const text = defaultVisibleText(await response.text());

  assert.match(text, /Research setup is temporarily unavailable/i);
  assert.match(text, /will not substitute an untracked local record/i);
  assert.doesNotMatch(text, /\bStart research\b/i);
  assert.doesNotMatch(text, /Sign and activate delegation/i);
  assert.doesNotMatch(text, /sample (?:Attempt|task|contribution)/i);
});

test("the public demo distinguishes signed-evidence verification from a fresh Lean run", async () => {
  const response = await render(normalWorker, "/demo");
  assert.equal(response.status, 200);
  const text = defaultVisibleText(await response.text());

  assert.match(text, /Re-verify signed evidence/i);
  assert.match(text, /Lean itself is not restarted/i);
  assert.match(text, /It does not start Lean/i);
  assert.match(text, /fresh Lean replay is the separate local end-to-end command/i);
  assert.match(text, /Optional audit path · developers and reviewers/i);
  assert.match(text, /npm run demo:e2e:check/i);

  const verification = await render(normalWorker, "/api/demo/verify", {
    headers: { accept: "application/json" },
  });
  assert.equal(verification.status, 200);
  const payload = await verification.json();
  assert.equal(payload.executionBoundary.signedEvidenceReverified, true);
  assert.equal(payload.executionBoundary.leanReplay, "not_run_by_this_request");
});

test("ordinary entry pages hide operational identifiers and raw Agent tool names by default", async () => {
  const forbidden = [
    /\bidempotency(?: key)?\b/i,
    /\bdelegationCertificateId\b/i,
    /\bdelegation:[a-z0-9:_-]+\b/i,
    /\bcontinue_research\b/i,
    /\binspect_research_graph\b/i,
    /\breport_progress\b/i,
    /\bprepare_workspace_bundle\b/i,
    /\bstage_workspace_bundle\b/i,
    /\brequest_runner_run\b/i,
  ];

  for (const pathname of ordinaryEntryPaths) {
    const response = await render(normalWorker, pathname);
    assert.equal(response.status, 200, `${pathname} should render`);
    const text = defaultVisibleText(await response.text());
    for (const pattern of forbidden) {
      assert.doesNotMatch(
        text,
        pattern,
        `${pathname} should keep ${pattern} behind optional technical details`,
      );
    }
  }
});

async function createWorker({
  bindings = {},
  includeDatabase = true,
} = {}) {
  const entrypoint = fileURLToPath(new URL("index.js", workerRoot));
  const modules = await listJavaScriptModules(workerRoot);
  return new Miniflare({
    modules: [
      { type: "ESModule", path: entrypoint },
      ...modules
        .filter((modulePath) => modulePath !== entrypoint)
        .map((modulePath) => ({ type: "ESModule", path: modulePath })),
    ],
    modulesRoot: fileURLToPath(workerRoot),
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    ...(includeDatabase ? { d1Databases: ["DB"] } : {}),
    bindings,
    serviceBindings: {
      ASSETS: async () => new Response("Not found", { status: 404 }),
    },
  });
}

async function render(worker, pathname = "/", init = {}) {
  return worker.dispatchFetch(`http://localhost${pathname}`, {
    ...init,
    headers: { accept: "text/html", ...(init.headers ?? {}) },
  });
}

async function applyMigrations(database) {
  const filenames = (await readdir(migrationsRoot))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  for (const filename of filenames) {
    const migration = await readFile(new URL(filename, migrationsRoot), "utf8");
    const statements = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await database.prepare(statement).run();
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

function defaultVisibleText(html) {
  return decodeEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<details\b[\s\S]*?<\/details>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function decodeEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}
