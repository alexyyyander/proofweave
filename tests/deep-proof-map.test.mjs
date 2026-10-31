import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { validateDeepProofMap } from "../packages/domain/deep-proof-map.mjs";

const base = new URL("../", import.meta.url);
const collection = JSON.parse(await readFile(new URL("data/publications/openai-math.json", base), "utf8"));
const lean = JSON.parse(await readFile(new URL("data/proof-maps/lean-coverage.json", base), "utf8"));
const manifest = JSON.parse(await readFile(new URL("data/proof-maps/manifest.json", base), "utf8"));
const deep = new Map(await Promise.all(["032", "084", "159"].map(async (number) => [
  number,
  JSON.parse(await readFile(new URL(`data/proof-maps/deep/${number}.json`, base), "utf8")),
])));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("the three deep maps validate against the catalog and Lean coverage", () => {
  for (const [number, data] of deep) {
    assert.equal(validateDeepProofMap(data, collection, lean), data);
    assert.equal(data.familyNumber, number);
    assert.equal(data.status, "deep");
    assert.equal(data.reviewStatus, "unreviewed");
    assert.equal(data.schemaVersion, "pw-deep-proof-map-v1");
  }
});

test("every manifest deep entry outside family 003 has a validated data file", () => {
  const manifestDeep = manifest.deep.filter((entry) => entry.familyNumber !== "003").map((entry) => entry.familyNumber).sort();
  assert.deepEqual(manifestDeep, [...deep.keys()].sort());
  assert.deepEqual(manifest.draft, []);
});

test("032 has one main strategy, cited context without edges, and no invented Lean alignment", () => {
  const data = deep.get("032");
  assert.equal(data.strategies.length, 1);
  assert.equal(data.strategies[0].id, "main");
  assert.equal(data.strategies[0].nodes.length, 14);
  assert.equal(data.leanAlignments.length, 0);
  const contextIds = new Set(["andre-context", "hazama-context"]);
  for (const node of data.strategies[0].nodes.filter((candidate) => contextIds.has(candidate.id))) {
    assert.equal(node.dependsOn.length, 0);
    assert.equal(data.finalEdges.some((edge) => edge.from.endsWith(node.id)), false);
    assert.equal(data.crossEdges.some((edge) => edge.from.endsWith(node.id) || edge.to.endsWith(node.id)), false);
  }
  const main = data.strategies[0].nodes.find((node) => node.id === "main");
  assert.equal(main.kind, "theorem");
  assert.ok(main.detail.includes("cycle-class map"));
  assert.equal(data.relatedManuscripts.length, 4);
});

test("084 keeps the general-q theorem and the dyadic special case separate", () => {
  const data = deep.get("084");
  assert.deepEqual(data.strategies.map((strategy) => strategy.id), ["general", "dyadic"]);
  const general = data.strategies.find((strategy) => strategy.id === "general");
  const dyadic = data.strategies.find((strategy) => strategy.id === "dyadic");
  assert.equal(general.pages, 13);
  assert.equal(dyadic.pages, 16);
  assert.equal(general.nodes.find((node) => node.id === "theorem").fullLabel, "Theorem 1.1 · Every fixed q");
  assert.equal(dyadic.nodes.find((node) => node.id === "theorem").fullLabel, "Theorem 1.1 · Dyadic case");
  assert.ok(data.finalEdges.some((edge) => edge.from === "general:theorem" && edge.label === "every fixed q"));
  assert.ok(data.finalEdges.some((edge) => edge.from === "dyadic:theorem" && edge.label === "q = 1/2 special case"));
  assert.equal(data.leanAlignments.length, 1);
  assert.equal(data.leanAlignments[0].strategyId, "dyadic");
  assert.deepEqual(data.leanAlignments[0].theoremNames, ["OAI.Problem310.dyadic_affine_avoidance"]);
  assert.equal(data.comparisons.length, 1);
  assert.deepEqual(data.comparisons[0].sharedRoles, ["periodic", "windows", "routing", "scales", "assembly", "result"]);
});

test("159 separates the quantitative theorem from its Lean-formalized reciprocal corollary", () => {
  const data = deep.get("159");
  assert.equal(data.strategies.length, 1);
  const nodes = new Map(data.strategies[0].nodes.map((node) => [node.id, node]));
  assert.equal(nodes.get("density").fullLabel, "Theorem 1.1 · Quasipolynomial density bound");
  assert.equal(nodes.get("reciprocal").fullLabel, "Corollary 1.2 · Divergent reciprocal sums");
  assert.deepEqual(nodes.get("density").dependsOn, ["iteration"]);
  assert.deepEqual(nodes.get("reciprocal").dependsOn, ["density"]);
  assert.equal(data.leanAlignments.length, 1);
  assert.equal(data.leanAlignments[0].nodeId, "reciprocal");
  assert.deepEqual(data.leanAlignments[0].theoremNames, ["OAI.Erdos3.manuscriptReciprocalProgressionTheorem"]);
  assert.ok(data.caveats.some((caveat) => caveat.includes("quantitative density bound")));
});

test("the deep validator rejects unknown dependencies and cycles", () => {
  const unknown = clone(deep.get("159"));
  unknown.strategies[0].nodes.find((node) => node.id === "density").dependsOn.push("missing-node");
  assert.throws(() => validateDeepProofMap(unknown, collection, lean), /unknown node missing-node/);

  const cycle = clone(deep.get("084"));
  cycle.strategies[1].nodes.find((node) => node.id === "windows").dependsOn.push("theorem");
  assert.throws(() => validateDeepProofMap(cycle, collection, lean), /dependency cycle/);
});

test("the deep validator rejects an unbacked Lean alignment and a missing final edge", () => {
  const wrongTheorem = clone(deep.get("084"));
  wrongTheorem.leanAlignments[0].theoremNames = ["OAI.Problem310.not_the_dyadic_theorem"];
  assert.throws(() => validateDeepProofMap(wrongTheorem, collection, lean), /not present in comparator/);

  const noFinal = clone(deep.get("084"));
  noFinal.finalEdges = noFinal.finalEdges.filter((edge) => !edge.from.startsWith("dyadic:"));
  assert.throws(() => validateDeepProofMap(noFinal, collection, lean), /has no final edge/);
});

test("the deep validator rejects a cross edge inside one strategy and a result-only role mismatch", () => {
  const sameStrategy = clone(deep.get("084"));
  sameStrategy.crossEdges[0] = { from: "general:theorem", to: "general:periodic", type: "same-role", label: "bad" };
  assert.throws(() => validateDeepProofMap(sameStrategy, collection, lean), /different strategies/);

  const badRole = clone(deep.get("032"));
  badRole.strategies[0].nodes[0].role = "not-a-role";
  assert.throws(() => validateDeepProofMap(badRole, collection, lean), /unknown role/);
});
