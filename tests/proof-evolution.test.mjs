import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  ProofEvolutionValidationError,
  validateProofEvolution,
} from "../packages/domain/proof-evolution.mjs";

const data = JSON.parse(await readFile(new URL("../data/proof-evolution/landau-siegel.json", import.meta.url), "utf8"));
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
