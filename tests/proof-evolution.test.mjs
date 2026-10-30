import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  ProofEvolutionValidationError,
  validateArgumentMap,
  validateLeanStructure,
  validateProofEvolution,
} from "../packages/domain/proof-evolution.mjs";

const data = JSON.parse(await readFile(new URL("../data/proof-evolution/landau-siegel.json", import.meta.url), "utf8"));
const leanStructure = JSON.parse(await readFile(new URL("../data/proof-evolution/lean-structure.json", import.meta.url), "utf8"));
const argumentMap = JSON.parse(await readFile(new URL("../data/proof-evolution/argument-map.json", import.meta.url), "utf8"));
const byId = new Map(data.versions.map((version) => [version.id, version]));

function clone() {
  return JSON.parse(JSON.stringify(data));
}

test("the Landau–Siegel proof-evolution dataset validates", () => {
  assert.equal(validateProofEvolution(data), data);
  assert.equal(data.status, "draft");
  assert.equal(data.reviewStatus, "unreviewed");
  assert.equal(data.schemaVersion, "pw-proof-evolution-v1");
});

test("the five requested versions have the verified page counts", () => {
  const expected = new Map([
    ["openai-2026-10-01", 9],
    ["banks-2026-10-11", 19],
    ["kerr-2026-10-15", 6],
    ["green-2026-10-17", 5],
    ["barreto-2026-10-19", 3],
  ]);
  for (const [id, pages] of expected) {
    const version = byId.get(id);
    assert.ok(version, `missing version ${id}`);
    assert.equal(version.pages, pages);
    assert.equal(version.trackId, "same-theorem");
  }
});

test("the same-theorem lineage records simplification and explicitization separately", () => {
  const edges = new Map(data.versionEdges.map((edge) => [`${edge.from}->${edge.to}`, edge]));
  assert.equal(edges.get("openai-2026-10-01->banks-2026-10-11")?.relation, "explicitizes");
  assert.equal(edges.get("openai-2026-10-01->kerr-2026-10-15")?.relation, "simplifies");
  assert.equal(edges.get("openai-2026-10-01->green-2026-10-17")?.relation, "simplifies");
  assert.equal(edges.get("green-2026-10-17->barreto-2026-10-19")?.relation, "simplifies");
  assert.equal(edges.get("barreto-2026-10-19->vandijk-2026-10-20")?.relation, "recombines");
});

test("the stronger quasi-Riemann papers are a separate theorem track, not the old 3-page proof", () => {
  const stronger = data.versions.filter((version) => version.trackId === "stronger-theorem");
  assert.deepEqual(stronger.map((version) => version.pages).sort((a, b) => a - b), [49, 199]);
  const sameTheoremIds = new Set(data.versions.filter((version) => version.trackId === "same-theorem").map((version) => version.id));
  for (const edge of data.versionEdges) {
    assert.ok(sameTheoremIds.has(edge.from), `edge starts outside the same-theorem track: ${edge.from}`);
    assert.ok(sameTheoremIds.has(edge.to), `edge ends outside the same-theorem track: ${edge.to}`);
  }
  assert.match(byId.get("quasi-7-8-2026-09-30").changeSummary, /not the old version/i);
});

test("each requested version names its actual mechanism", () => {
  assert.match(byId.get("openai-2026-10-01").method, /interpolation determinant/i);
  assert.match(byId.get("banks-2026-10-11").method, /explicit constants/i);
  assert.match(byId.get("banks-2026-10-11").summary, /10¹⁰/);
  assert.match(byId.get("kerr-2026-10-15").method, /Masser/i);
  assert.match(byId.get("green-2026-10-17").method, /resultants/i);
  assert.match(byId.get("barreto-2026-10-19").method, /Wronskian/i);
  assert.match(byId.get("barreto-2026-10-19").aiAssistance, /GPT-6 Astra/i);
  assert.match(byId.get("barreto-2026-10-19").changeSummary, /introductory course/i);
  assert.ok(byId.get("barreto-2026-10-19").proofSteps.some((step) => /Wronskian/i.test(step.detail)));
});

test("Lean coverage is explicit and does not pretend the 3-page proof is formalized", () => {
  assert.equal(byId.get("openai-2026-10-01").lean.status, "formalized_upstream");
  assert.equal(byId.get("barreto-2026-10-19").lean.status, "not_formalized");
  assert.equal(byId.get("green-2026-10-17").lean.status, "not_formalized");
  assert.equal(byId.get("quasi-7-8-2026-09-30").lean.status, "formalized_upstream");
  assert.equal(byId.get("quasi-11-12-2026-10-05").lean.status, "not_separately_formalized");
  const formalized = data.versions.filter((version) => version.lean.status === "formalized_upstream").map((version) => version.id).sort();
  assert.deepEqual(formalized, ["openai-2026-10-01", "quasi-7-8-2026-09-30"]);
  assert.match(byId.get("openai-2026-10-01").lean.note, /challenge statement/i);
  assert.match(byId.get("openai-2026-10-01").lean.note, /has not re-run the kernel/i);
});

test("the compression ledger records the Wronskian replacement and the biquadratic-field removal", () => {
  const rows = new Map(data.ledger.rows.map((row) => [row.id, row]));
  assert.equal(rows.get("wronskian").cells["barreto-2026-10-19"], "used");
  assert.equal(rows.get("wronskian").cells["green-2026-10-17"], "not_used");
  assert.equal(rows.get("resultant").cells["green-2026-10-17"], "used");
  assert.equal(rows.get("resultant").cells["barreto-2026-10-19"], "replaced");
  assert.equal(rows.get("biquadratic-field").cells["green-2026-10-17"], "removed");
  assert.equal(rows.get("explicit-constants").cells["banks-2026-10-11"], "explicit");
});

test("the prototype labels itself as unverified and links primary sources", () => {
  assert.ok(data.caveats.some((caveat) => /not a Proofweave verification/i.test(caveat)));
  assert.ok(data.caveats.some((caveat) => /has not re-run the kernel/i.test(caveat)));
  assert.ok(data.sources.some((source) => source.url.includes("arxiv.org/abs/2610.15483")));
  assert.ok(data.sources.some((source) => source.url.includes("hexagonmath.org/pdf/2610.00311")));
  assert.ok(data.sources.some((source) => source.url.includes("x.com/AcerFur/status/2112239827077026128")));
  assert.ok(data.sources.some((source) => source.url.includes("terrytao.wordpress.com/2026/10/19")));
  assert.ok(data.sources.some((source) => source.url.includes("SiegelZeros")));
  assert.ok(!JSON.stringify(data).includes("Proofweave verified"));
});

test("a broken dependency is rejected", () => {
  const broken = clone();
  broken.versions[0].proofSteps[0].dependsOn = ["missing-step"];
  assert.throws(() => validateProofEvolution(broken), ProofEvolutionValidationError, /unknown step/);
});

test("a duplicate version id is rejected", () => {
  const broken = clone();
  broken.versions[1].id = broken.versions[0].id;
  assert.throws(() => validateProofEvolution(broken), ProofEvolutionValidationError, /duplicate version id/);
});

test("a non-https source is rejected", () => {
  const broken = clone();
  broken.sources[0].url = "http://example.org/paper.pdf";
  assert.throws(() => validateProofEvolution(broken), ProofEvolutionValidationError, /must use https/);
});

test("a ledger cell outside the declared columns is rejected", () => {
  const broken = clone();
  broken.ledger.rows[0].cells["not-a-column"] = "used";
  assert.throws(() => validateProofEvolution(broken), ProofEvolutionValidationError, /unknown column/);
});

test("a version cannot silently claim a non-draft status", () => {
  const broken = clone();
  broken.status = "verified";
  assert.throws(() => validateProofEvolution(broken), ProofEvolutionValidationError, /status must be "draft"/);
});


test("the Lean structure dataset validates and records the actual closure", () => {
  assert.equal(validateLeanStructure(leanStructure), leanStructure);
  assert.equal(leanStructure.summary.oaiModules, 306);
  assert.equal(leanStructure.summary.totalLines, 69818);
  assert.equal(leanStructure.summary.declarations, 4222);
  assert.equal(leanStructure.summary.sorry, 0);
  assert.equal(leanStructure.summary.axioms, 0);
  assert.equal(leanStructure.subsystems.length, 13);
  assert.equal(leanStructure.modules.length, 306);
  assert.equal(leanStructure.topLevelModules.length, 21);
  assert.equal(leanStructure.anchors.length, 12);
  assert.equal(leanStructure.paperAlignments.length, 8);
  assert.equal(leanStructure.summary.failedModules[0].module, "PrimeNumberTheoremAnd.SiegelZeros.HadamardSupport");
});

test("Lean subsystem totals sum to the closure and the top import edge is real", () => {
  const totalModules = leanStructure.subsystems.reduce((total, subsystem) => total + subsystem.moduleCount, 0);
  assert.equal(totalModules, leanStructure.summary.oaiModules);
  assert.equal(leanStructure.subsystemEdges.length, 88);
  const top = [...leanStructure.subsystemEdges].sort((a, b) => b.count - a.count)[0];
  assert.deepEqual(top, { from: "LocalAlgebra", to: "Structure", count: 26 });
});

test("the final theorem and W50/W22 anchors are located in the upstream source", () => {
  const anchors = new Map(leanStructure.anchors.map((anchor) => [anchor.id, anchor]));
  assert.equal(anchors.get("final-theorem").module, "OAI.NumberTheory.SiegelZeros.Conclusions.Theorem");
  assert.equal(anchors.get("final-theorem").line, 11);
  assert.equal(anchors.get("w50").module, "OAI.NumberTheory.SiegelZeros.Intersection.BezoutBoundary");
  assert.equal(anchors.get("w22").module, "OAI.NumberTheory.SiegelZeros.Intersection.IsolatedBezoutFromRegularSelection");
  assert.equal(anchors.get("prime-bias").module, "OAI.NumberTheory.SiegelZeros.Characters.NormLogDerivLFunctionNegLogDerivZeta");
  assert.equal(anchors.get("prime-divisibility").module, "OAI.NumberTheory.SiegelZeros.Determinants.Divisibility");
  assert.equal(anchors.get("pivot-bounds").module, "OAI.NumberTheory.SiegelZeros.Selection.PivotBounds");
});

test("paper-to-Lean alignments are explicitly source-anchored or inferred", () => {
  const openai = byId.get("openai-2026-10-01");
  const stepIds = new Set(openai.proofSteps.map((step) => step.id));
  const subsystemIds = new Set(leanStructure.subsystems.map((subsystem) => subsystem.id));
  for (const alignment of leanStructure.paperAlignments) {
    assert.equal(alignment.versionId, "openai-2026-10-01");
    assert.ok(stepIds.has(alignment.stepId), `unknown OpenAI step ${alignment.stepId}`);
    assert.ok(alignment.subsystems.every((id) => subsystemIds.has(id)));
    assert.match(alignment.confidence, /^(source-anchored|inferred)$/);
  }
  assert.equal(leanStructure.paperAlignments.filter((alignment) => alignment.confidence === "source-anchored").length, 6);
  assert.equal(leanStructure.paperAlignments.filter((alignment) => alignment.confidence === "inferred").length, 2);
});

test("the Lean structure view does not claim a kernel check", () => {
  assert.ok(leanStructure.caveats.some((caveat) => /not a kernel dependency graph/.test(caveat)));
  assert.ok(leanStructure.caveats.some((caveat) => /No Lean build/.test(caveat)));
  assert.ok(!JSON.stringify(leanStructure).includes("Proofweave verified"));
});

test("a Lean module with an unknown subsystem is rejected", () => {
  const broken = JSON.parse(JSON.stringify(leanStructure));
  broken.modules[0].subsystem = "NotARealSubsystem";
  assert.throws(() => validateLeanStructure(broken), ProofEvolutionValidationError, /unknown subsystem/);
});

test("a Lean subsystem edge outside the declared subsystems is rejected", () => {
  const broken = JSON.parse(JSON.stringify(leanStructure));
  broken.subsystemEdges[0].to = "NotARealSubsystem";
  assert.throws(() => validateLeanStructure(broken), ProofEvolutionValidationError, /unknown subsystem/);
});

test("a Lean module URL must be https", () => {
  const broken = JSON.parse(JSON.stringify(leanStructure));
  broken.modules[0].url = "http://example.org/module.lean";
  assert.throws(() => validateLeanStructure(broken), ProofEvolutionValidationError, /must use https/);
});

test("a Lean subsystem count mismatch is rejected", () => {
  const broken = JSON.parse(JSON.stringify(leanStructure));
  broken.subsystems[0].moduleCount += 1;
  assert.throws(() => validateLeanStructure(broken), ProofEvolutionValidationError, /moduleCount does not match/);
});


test("the cross-proof argument map validates and contains five same-theorem strategies", () => {
  assert.equal(validateArgumentMap(argumentMap, data), argumentMap);
  assert.equal(argumentMap.strategies.length, 7);
  assert.equal(argumentMap.strategies.filter((strategy) => strategy.track === "same-theorem").length, 5);
  assert.equal(argumentMap.strategies.filter((strategy) => strategy.track === "stronger-theorem").length, 2);
  assert.equal(argumentMap.crossEdges.length, 29);
  assert.equal(argumentMap.finalEdges.length, 8);
  assert.equal(argumentMap.comparisons.length, 6);
  assert.equal(argumentMap.extraNodes.length, 1);
  assert.equal(argumentMap.result.id, "result:landau-siegel-zero-gap");
});

test("every proof step has a role and every strategy has a result node", () => {
  const strategyIds = new Set(argumentMap.strategies.map((strategy) => strategy.versionId));
  for (const strategy of argumentMap.strategies) {
    const version = byId.get(strategy.versionId);
    const roles = argumentMap.nodeRoles[strategy.versionId];
    for (const step of version.proofSteps) assert.ok(roles[step.id], `missing role ${strategy.versionId}:${step.id}`);
    const hasResult = Object.values(roles).includes("result") || argumentMap.extraNodes.some((node) => node.versionId === strategy.versionId && node.role === "result");
    assert.ok(hasResult, `missing result node for ${strategy.versionId}`);
    assert.ok(strategyIds.has(strategy.versionId));
  }
});

test("the key cross-strategy relationships are explicit", () => {
  const has = (from, to, type) => argumentMap.crossEdges.some((edge) => edge.from === from && edge.to === to && edge.type === type);
  assert.ok(has("barreto-2026-10-19:wronskian", "green-2026-10-17:nonsingular", "replaces"));
  assert.ok(has("barreto-2026-10-19:wronskian", "openai-2026-10-01:interpolation", "bypasses"));
  assert.ok(has("barreto-2026-10-19:wronskian", "openai-2026-10-01:weighted-determinant", "bypasses"));
  assert.ok(has("green-2026-10-17:nonsingular", "openai-2026-10-01:interpolation", "replaces"));
  assert.ok(has("kerr-2026-10-15:masser", "openai-2026-10-01:weighted-determinant", "bypasses"));
  assert.ok(has("openai-2026-10-01:prime-divisibility", "banks-2026-10-11:prime-powers", "same-role"));
  assert.ok(has("green-2026-10-17:padic", "barreto-2026-10-19:divisibility", "same-role"));
});

test("the strongest comparison says what Barreto keeps and what it replaces", () => {
  const comparison = argumentMap.comparisons.find((entry) => [entry.a, entry.b].sort().join("|") === "barreto-2026-10-19|openai-2026-10-01");
  assert.ok(comparison);
  assert.ok(comparison.summary.includes("Wronskian"));
  assert.ok(comparison.sharedRoles.includes("padic"));
  assert.ok(comparison.sharedRoles.includes("result"));
  assert.ok(comparison.uniqueARoles.includes("determinant"));
});

test("the stronger-theorem strategies only imply the shared result", () => {
  const stronger = new Set(argumentMap.strategies.filter((strategy) => strategy.track === "stronger-theorem").map((strategy) => strategy.versionId));
  const implied = argumentMap.finalEdges.filter((edge) => stronger.has(edge.from.split(":")[0]));
  assert.equal(implied.length, 2);
  assert.ok(implied.every((edge) => edge.type === "implies" && edge.to === argumentMap.result.id));
});

test("an argument-map role outside the declared roles is rejected", () => {
  const broken = JSON.parse(JSON.stringify(argumentMap));
  broken.nodeRoles["openai-2026-10-01"]["prime-bias"] = "not-a-role";
  assert.throws(() => validateArgumentMap(broken, data), ProofEvolutionValidationError, /unknown role/);
});

test("an argument-map cross edge with an unknown node is rejected", () => {
  const broken = JSON.parse(JSON.stringify(argumentMap));
  broken.crossEdges[0].to = "missing:node";
  assert.throws(() => validateArgumentMap(broken, data), ProofEvolutionValidationError, /unknown node/);
});

test("an argument-map strategy missing a proof-step role is rejected", () => {
  const broken = JSON.parse(JSON.stringify(argumentMap));
  delete broken.nodeRoles["openai-2026-10-01"]["prime-bias"];
  assert.throws(() => validateArgumentMap(broken, data), ProofEvolutionValidationError, /missing role/);
});

test("a duplicate argument-map comparison is rejected", () => {
  const broken = JSON.parse(JSON.stringify(argumentMap));
  broken.comparisons.push({ ...broken.comparisons[0] });
  assert.throws(() => validateArgumentMap(broken, data), ProofEvolutionValidationError, /duplicate argument-map comparison/);
});
