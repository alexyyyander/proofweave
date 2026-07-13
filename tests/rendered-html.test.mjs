import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../", import.meta.url);

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
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

test("keeps the production frontend free of the deleted starter preview", async () => {
  const [page, layout, packageJson, workbench] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(
      new URL("../app/workbench/workbench-sections.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(page, /Proofweave/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview|react-loading-skeleton/i);
  assert.doesNotMatch(layout, /codex-preview|_sites-preview/i);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/i);
  assert.match(workbench, /Local preview/);
  assert.match(workbench, /Illustrative only/);
  assert.match(workbench, /Independent review/);

  await assert.rejects(
    access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)),
  );
  await assert.rejects(
    access(new URL("public/_sites-preview/SkeletonPreview.tsx", repositoryRoot)),
  );
});
