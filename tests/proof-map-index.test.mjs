import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  buildProofMapIndex,
  publicationPlainText,
  validateProofMapManifest,
} from "../packages/domain/proof-map-index.mjs";

const base = new URL("../", import.meta.url);
const collection = JSON.parse(await readFile(new URL("data/publications/openai-math.json", base), "utf8"));
const manifest = JSON.parse(await readFile(new URL("data/proof-maps/manifest.json", base), "utf8"));
const lean = JSON.parse(await readFile(new URL("data/proof-maps/lean-coverage.json", base), "utf8"));
const index = buildProofMapIndex(collection, manifest, lean);

test("the proof-map index covers every catalog family exactly once", () => {
  assert.equal(index.entries.length, 372);
  assert.equal(new Set(index.entries.map((entry) => entry.familyNumber)).size, 372);
  for (const family of collection.families) {
    const entry = index.entries.find((candidate) => candidate.familyNumber === family.number);
    assert.ok(entry, `missing family ${family.number}`);
    assert.equal(entry.publicationRoute, `/publications/openai-math/${family.number}`);
    assert.ok(entry.route.startsWith("/proof-evolution/"));
    assert.equal(entry.proofweaveReplay, "not_run");
    assert.ok(!("proofSteps" in entry));
    assert.ok(!("leanDeclarations" in entry));
  }
});

test("the coverage summary is truthful and statuses are explicit", () => {
  assert.equal(index.summary.families, 372);
  assert.equal(index.summary.manuscripts, 719);
  assert.equal(index.summary.scopeDocuments, 242);
  assert.equal(index.summary.scopeFamilies, 242);
  assert.equal(index.summary.comparatorLinks, 426);
  assert.equal(index.summary.formalizedManuscripts, 339);
  assert.equal(index.summary.proofweaveReplays, 0);
  assert.equal(index.summary.leanFamilies, 242);
  assert.equal(index.summary.leanSolutionModules, 426);
  assert.equal(index.summary.leanTheoremNames, 536);
  assert.deepEqual(index.statusCounts, { deep: 4, draft: 0, scaffold: 368 });
  assert.equal(index.entries.filter((entry) => entry.status === "scaffold").every((entry) => entry.reviewStatus === "not_started"), true);
  assert.equal(index.entries.filter((entry) => entry.status !== "scaffold").every((entry) => entry.reviewStatus === "unreviewed"), true);
});

test("the curated families have the expected routes and labels", () => {
  const byNumber = new Map(index.entries.map((entry) => [entry.familyNumber, entry]));
  assert.equal(byNumber.get("003").status, "deep");
  assert.equal(byNumber.get("003").route, "/proof-evolution/landau-siegel");
  assert.equal(byNumber.get("003").statusLabel, "Deep argument map");
  for (const number of ["032", "084", "159"]) {
    assert.equal(byNumber.get(number).status, "deep");
    assert.equal(byNumber.get(number).route, `/proof-evolution/openai-math/${number}`);
    assert.equal(byNumber.get(number).statusLabel, "Deep argument map");
    assert.equal(byNumber.get(number).reviewStatus, "unreviewed");
  }
  assert.equal(byNumber.get("001").status, "scaffold");
  assert.equal(byNumber.get("001").route, "/proof-evolution/openai-math/001");
  assert.equal(byNumber.get("001").statusLabel, "Metadata scaffold");
  assert.match(byNumber.get("001").nextStep, /Extract theorem\/lemma statements/);
  assert.equal(byNumber.get("238").lean.status, "extracted");
  assert.equal(byNumber.get("238").lean.comparators, 13);
  assert.equal(byNumber.get("238").lean.solutions, 13);
  assert.equal(byNumber.get("238").lean.theoremNames, 15);
  assert.equal(byNumber.get("001").lean.status, "none");
});

test("claim snippets are plain text and carry no markup or TeX delimiters", () => {
  for (const entry of index.entries) {
    assert.ok(entry.claimSnippet.length > 0);
    assert.ok(!/<\/?[a-z][^>]*>/i.test(entry.claimSnippet), `markup leaked into ${entry.familyNumber}`);
    assert.ok(!entry.claimSnippet.includes("$"), `TeX delimiter leaked into ${entry.familyNumber}`);
    assert.ok(entry.claimSnippet.length <= 241);
  }
  assert.equal(publicationPlainText('<i>plain</i> $`x^2`$ and $$y$$'), "plain x^2 and y");
});

test("subjects preserve the catalog family totals", () => {
  assert.equal(index.subjects.length, 17);
  assert.equal(index.subjects.reduce((total, subject) => total + subject.families, 0), 372);
  const statuses = index.subjects.reduce((total, subject) => total + subject.deep + subject.draft + subject.scaffold, 0);
  assert.equal(statuses, 372);
});

test("the manifest rejects unknown families, duplicates, and bad routes", () => {
  const unknown = JSON.parse(JSON.stringify(manifest));
  unknown.deep.push({ familyNumber: "999", route: "/proof-evolution/openai-math/999", label: "Unknown" });
  assert.throws(() => validateProofMapManifest(unknown, collection), /unknown family 999/);

  const duplicate = JSON.parse(JSON.stringify(manifest));
  duplicate.draft.push({ familyNumber: "003", route: "/proof-evolution/openai-math/003", label: "Duplicate" });
  assert.throws(() => validateProofMapManifest(duplicate, collection), /more than one curated status/);

  const badRoute = JSON.parse(JSON.stringify(manifest));
  badRoute.deep[0].route = "/publications/openai-math/003";
  assert.throws(() => validateProofMapManifest(badRoute, collection), /route must be/);
});

test("the index refuses to invent proof structure for scaffolds", () => {
  for (const entry of index.entries.filter((candidate) => candidate.status === "scaffold")) {
    assert.equal(entry.manifestLabel, null);
    assert.match(entry.nextStep, /Extract theorem\/lemma statements|build the argument map/);
    assert.equal(entry.formalizedManuscripts >= 0, true);
  }
});
