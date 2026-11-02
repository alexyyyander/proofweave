import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  buildProofMapIndex,
  publicationPlainText,
  validateProofMapManifest,
} from "../packages/domain/proof-map-index.mjs";
import { validateDeepProofMap } from "../packages/domain/deep-proof-map.mjs";

const base = new URL("../", import.meta.url);
const collection = JSON.parse(await readFile(new URL("data/publications/openai-math.json", base), "utf8"));
const manifest = JSON.parse(await readFile(new URL("data/proof-maps/manifest.json", base), "utf8"));
const lean = JSON.parse(await readFile(new URL("data/proof-maps/lean-coverage.json", base), "utf8"));
const paper = JSON.parse(await readFile(new URL("data/proof-maps/paper-coverage.json", base), "utf8"));
const index = buildProofMapIndex(collection, manifest, lean, paper);

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
  assert.deepEqual(index.statusCounts, { deep: 346, draft: 0, paper: 1, lean: 18, scaffold: 7 });
  assert.equal(index.summary.paper, 1);
  assert.equal(index.summary.paperStatements, 13629);
  assert.equal(index.summary.paperEdges, 14401);
  assert.equal(index.summary.lean, 18);
  assert.equal(index.summary.scaffold, 7);
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
  assert.equal(byNumber.get("001").status, "deep");
  assert.equal(byNumber.get("001").route, "/proof-evolution/openai-math/001");
  assert.equal(byNumber.get("001").statusLabel, "Deep argument map");
  assert.match(byNumber.get("001").nextStep, /Extend version coverage/);
  assert.deepEqual(byNumber.get("001").paper, { manuscripts: 1, sections: 6, statements: 21, edges: 20 });
  assert.equal(byNumber.get("171").status, "paper");
  assert.equal(byNumber.get("171").statusLabel, "Paper-derived structure");
  assert.equal(byNumber.get("068").status, "scaffold");
  assert.equal(byNumber.get("068").statusLabel, "Metadata scaffold");
  assert.match(byNumber.get("068").nextStep, /Extract theorem\/lemma statements/);
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
  const statuses = index.subjects.reduce((total, subject) => total + subject.deep + subject.draft + subject.paper + subject.lean + subject.scaffold, 0);
  assert.equal(statuses, 372);
});

test("families with a pinned comparator but no curated spine are lean-derived, not deep", () => {
  const byNumber = new Map(index.entries.map((entry) => [entry.familyNumber, entry]));
  const lean = byNumber.get("024");
  assert.equal(lean.status, "lean");
  assert.equal(lean.statusLabel, "Lean-derived structure");
  assert.equal(lean.route, "/proof-evolution/openai-math/024");
  assert.equal(lean.reviewStatus, "unreviewed");
  assert.match(lean.nextStep, /Replace the machine-extracted structure/);
  assert.equal(lean.manifestLabel, null);
  for (const entry of index.entries.filter((candidate) => candidate.status === "lean")) {
    assert.ok(entry.lean.theoremNames > 0, `${entry.familyNumber} must name at least one theorem`);
    assert.equal(entry.reviewStatus, "unreviewed");
  }
  assert.equal(
    index.entries.filter((entry) => entry.status === "deep").length
      + index.entries.filter((entry) => entry.status === "paper").length
      + index.entries.filter((entry) => entry.status === "lean").length
      + index.entries.filter((entry) => entry.status === "scaffold").length,
    372,
  );
});

test("paper-derived structures match the summary and keep resolvable edges", async () => {
  const byNumber = new Map(index.entries.map((entry) => [entry.familyNumber, entry]));
  for (const family of paper.families) {
    const structure = JSON.parse(await readFile(new URL(`data/proof-maps/paper/${family.familyNumber}.json`, base), "utf8"));
    assert.equal(structure.familyNumber, family.familyNumber);
    assert.equal(structure.nodes.length, family.statements, `${family.familyNumber} statement count`);
    assert.equal(structure.edges.length, family.edges, `${family.familyNumber} edge count`);
    assert.equal(byNumber.get(family.familyNumber).paper.statements, family.statements);
    const ids = new Set(structure.nodes.map((node) => node.id));
    assert.equal(ids.size, structure.nodes.length, `${family.familyNumber} duplicate node ids`);
    for (const node of structure.nodes) {
      assert.ok(node.label.length > 0, `${family.familyNumber} node label`);
      assert.ok(node.manuscript, `${family.familyNumber} node manuscript`);
    }
    for (const edge of structure.edges) {
      assert.ok(ids.has(edge.from), `${family.familyNumber} edge starts at an unknown node`);
      assert.ok(ids.has(edge.to), `${family.familyNumber} edge ends at an unknown node`);
    }
  }
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

test("every generated deep map satisfies the deep contract and stays acyclic", async () => {
  const files = (await readdir(new URL("data/proof-maps/deep", base))).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 345);
  for (const file of files) {
    const data = JSON.parse(await readFile(new URL(`data/proof-maps/deep/${file}`, base), "utf8"));
    validateDeepProofMap(data, collection, lean);
    for (const strategy of data.strategies) {
      const ids = new Set(strategy.nodes.map((node) => node.id));
      for (const node of strategy.nodes) {
        for (const dependency of node.dependsOn) {
          assert.ok(ids.has(dependency), `${file}: node ${node.id} depends on an unknown node`);
        }
      }
    }
  }
});
