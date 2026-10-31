import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLeanSourceFetcher, leanSourceCachePath } from "../scripts/lib/proof-map-lean-cache.mjs";

const repository = "openai/math";
const revisionA = "a".repeat(40);
const revisionB = "b".repeat(40);

function textResponse(text) {
  return { status: 200, ok: true, text: async () => text };
}

async function fixtureCache(t) {
  const cacheDir = await mkdtemp(join(tmpdir(), "pw-proof-map-lean-cache-"));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  return cacheDir;
}

function fetcherFor({ cacheDir, revision, text, calls }) {
  return createLeanSourceFetcher({
    cacheDir,
    repository,
    revision,
    rawBase: `https://raw.example/${repository}/${revision}/lean/`,
    fetchImpl: async (url) => {
      calls.push(url);
      return textResponse(text);
    },
  });
}

test("Lean source cache cannot reuse bytes from a different revision", async (t) => {
  const cacheDir = await fixtureCache(t);
  const calls = [];
  const first = await fetcherFor({ cacheDir, revision: revisionA, text: "theorem old_result", calls })("Demo.lean");
  const second = await fetcherFor({ cacheDir, revision: revisionB, text: "theorem new_result", calls })("Demo.lean");

  assert.equal(first.text, "theorem old_result");
  assert.equal(second.text, "theorem new_result");
  assert.equal(calls.length, 2);
  assert.notEqual(
    leanSourceCachePath({ cacheDir, repository, revision: revisionA, path: "Demo.lean" }),
    leanSourceCachePath({ cacheDir, repository, revision: revisionB, path: "Demo.lean" }),
  );
});

test("Lean source cache reuses only the same revision and ignores legacy unbound entries", async (t) => {
  const cacheDir = await fixtureCache(t);
  const calls = [];
  const legacyPath = join(cacheDir, "Demo.lean");
  await writeFile(legacyPath, "theorem legacy_result", "utf8");

  const fetchText = fetcherFor({ cacheDir, revision: revisionA, text: "theorem current_result", calls });
  const fresh = await fetchText("Demo.lean");
  const cached = await fetchText("Demo.lean");

  assert.equal(fresh.text, "theorem current_result");
  assert.equal(fresh.cached, false);
  assert.equal(cached.text, "theorem current_result");
  assert.equal(cached.cached, true);
  assert.equal(calls.length, 1);
  assert.equal(await readFile(legacyPath, "utf8"), "theorem legacy_result");
});
