import assert from "node:assert/strict";
import { test } from "node:test";

import {
  findRelatedTargets,
  jaccard,
  normalize,
  tokenize,
} from "../packages/domain/reuse-match.mjs";
import {
  REUSE_BOUNDARY_STATEMENT,
  buildReuseIndex,
} from "../services/research/reuse-index.mjs";

const currentTarget = {
  id: "revision:goldbach",
  slug: "goldbach",
  title: "Goldbach conjecture",
  informalStatement: "Every even integer greater than two is the sum of two primes.",
  leanStatement: "theorem goldbach : every even n > 2 is the sum of two primes",
};

const strongGoldbach = {
  id: "revision:strong-goldbach",
  slug: "strong-goldbach",
  title: "Strong Goldbach conjecture",
  informalStatement: "Every even integer greater than two is the sum of two primes.",
  leanStatement: "theorem goldbach : every even n > 2 is the sum of two primes",
};

function goldbachVariants(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `revision:goldbach-variant-${index}`,
    slug: `goldbach-variant-${index}`,
    title: `Goldbach conjecture variant ${index}`,
    informalStatement: "Every even integer greater than two is the sum of two primes.",
    leanStatement: "theorem goldbach : every even n > 2 is the sum of two primes",
  }));
}

test("normalize applies NFKD, strips marks and punctuation, and lowercases", () => {
  assert.equal(normalize("  Café — Déjà vu!  "), "cafe deja vu");
  assert.equal(normalize("Nat.Prime ↔ Nat.Prime"), "nat prime nat prime");
  assert.equal(normalize("Number-theorem"), "number theorem");
  assert.equal(normalize(null), "");
  assert.equal(normalize(undefined), "");
});

test("tokenize splits normalized text into word tokens", () => {
  assert.deepEqual(tokenize("Prime. Number-theorem!"), ["prime", "number", "theorem"]);
  assert.deepEqual(tokenize("Alpha-Beta"), ["alpha", "beta"]);
  assert.deepEqual(tokenize(""), []);
});

test("jaccard measures token-set overlap and treats empty input as no similarity", () => {
  assert.equal(jaccard("alpha beta", "alpha beta"), 1);
  assert.equal(jaccard("alpha beta", ["alpha", "beta", "gamma"]), 2 / 3);
  assert.equal(jaccard("alpha", "beta"), 0);
  assert.equal(jaccard("", []), 0);
  assert.equal(jaccard("Alpha-Beta!", ["beta", "alpha"]), 1);
  assert.equal(jaccard(["alpha", "beta"], "beta gamma"), 1 / 3);
});

test("findRelatedTargets labels strong overlap as possible_duplicate and weaker overlap as related", () => {
  const matches = findRelatedTargets(
    { id: "revision:alpha", slug: "alpha-target", title: "alpha beta" },
    [
      { id: "revision:same", slug: "alpha-target", title: "alpha beta" },
      { id: "revision:duplicate", slug: "duplicate-target", title: "Alpha beta" },
      { id: "revision:related", slug: "related-target", title: "alpha gamma" },
      { id: "revision:far", slug: "far-target", title: "delta epsilon" },
      { id: "revision:duplicate-again", slug: "duplicate-target", title: "alpha beta" },
    ],
  );

  assert.deepEqual(matches.map((match) => match.slug), ["duplicate-target", "related-target"]);
  assert.deepEqual(matches.map((match) => match.label), ["possible_duplicate", "related"]);
  assert.equal(matches[0].score, 1);
  assert.equal(matches[1].score, 0.3333);
  for (const match of matches) {
    assert.equal(match.label, match.score >= 0.55 ? "possible_duplicate" : "related");
  }
});

test("findRelatedTargets enforces the threshold and the result limit", () => {
  const current = { id: "revision:alpha", slug: "alpha-target", title: "alpha beta" };
  const others = [
    { id: "revision:duplicate", slug: "duplicate-target", title: "alpha beta" },
    { id: "revision:related", slug: "related-target", title: "alpha gamma" },
  ];

  assert.deepEqual(
    findRelatedTargets(current, others, { threshold: 0.5 }).map((match) => match.slug),
    ["duplicate-target"],
  );
  assert.deepEqual(
    findRelatedTargets(current, others, { limit: 1 }).map((match) => match.slug),
    ["duplicate-target"],
  );
  assert.deepEqual(findRelatedTargets(current, others, { limit: 0 }), []);
  assert.deepEqual(findRelatedTargets(null, others), []);
  assert.deepEqual(findRelatedTargets(current, null), []);

  const many = Array.from({ length: 8 }, (_, index) => ({
    id: `revision:alpha-${index}`,
    slug: `alpha-variant-${index}`,
    title: "alpha beta",
  }));
  assert.equal(findRelatedTargets(current, many).length, 5);
  assert.equal(findRelatedTargets(current, many, { limit: 3 }).length, 3);
});

test("findRelatedTargets keeps its label boundary at a 0.55 score", () => {
  const current = { slug: "base", title: "alpha beta" };
  const labelFor = (title) => findRelatedTargets(current, [{ slug: "other", title }])[0];
  const duplicate = labelFor("alpha beta");
  const related = labelFor("alpha beta gamma delta");

  assert.ok(duplicate.score >= 0.55);
  assert.equal(duplicate.label, "possible_duplicate");
  assert.ok(related.score < 0.55);
  assert.equal(related.label, "related");
});

test("buildReuseIndex aggregates related targets, prior work, and reusable Lean paths", () => {
  const curatedResearch = [
    {
      id: "curated:lean-target",
      title: "Pinned Lean statement",
      leanRepositoryUrl: "https://github.com/google-deepmind/formal-conjectures/tree/abc123",
      leanCommit: "abc123def4567890",
      leanDeclaration: "GoldbachConjecture.goldbach",
      curationStatus: "source_asserted",
      role: "formalization",
      sourceSystem: "Formal Conjectures",
      sourceIdentifier: "github:formal-conjectures",
    },
    {
      id: "curated:paper",
      title: "Prior paper",
      leanRepositoryUrl: null,
      leanCommit: null,
      leanDeclaration: null,
      curationStatus: "curator_reviewed",
      role: "progress",
      sourceSystem: "arXiv",
      sourceIdentifier: "arxiv:0000.0000",
    },
    {
      id: "curated:lean-target-duplicate",
      title: "Duplicate pinned Lean statement",
      leanRepositoryUrl: "https://github.com/google-deepmind/formal-conjectures/tree/abc123",
      leanCommit: "abc123def4567890",
      leanDeclaration: "GoldbachConjecture.goldbach",
      curationStatus: "source_asserted",
      role: "formalization",
      sourceSystem: "Formal Conjectures",
      sourceIdentifier: "github:formal-conjectures",
    },
  ];
  const researchGraph = {
    nodes: [{ id: "node:1" }, { id: "node:2" }],
    edges: [],
    externalWorks: [{ id: "work:1" }],
    truncated: false,
  };

  const index = buildReuseIndex({
    catalog: [currentTarget, strongGoldbach, ...goldbachVariants(7)],
    curatedResearch,
    researchGraph,
    current: currentTarget,
  });

  assert.equal(index.relatedTargets.length, 5);
  assert.ok(index.relatedTargets.every((target) => target.slug !== currentTarget.slug));
  assert.ok(index.relatedTargets.every((target) => (
    target.label === "possible_duplicate" || target.label === "related"
  )));
  assert.deepEqual(index.priorWork, {
    count: 6,
    curatedRecords: 3,
    sharedCheckpoints: 2,
    externalWorks: 1,
  });
  assert.equal(index.reusableLeanPaths.length, 1);
  assert.equal(index.reusableLeanPaths[0].url, "https://github.com/google-deepmind/formal-conjectures/tree/abc123");
  assert.equal(index.reusableLeanPaths[0].commit, "abc123def4567890");
  assert.equal(index.reusableLeanPaths[0].declaration, "GoldbachConjecture.goldbach");
  assert.equal(index.unavailableReason, undefined);
  assert.equal(index.boundary.statement, REUSE_BOUNDARY_STATEMENT);
  assert.ok(!JSON.stringify(index).toLowerCase().includes("verified"));
});

test("buildReuseIndex degrades to an empty structure with a reason when repositories are missing", () => {
  const unavailable = buildReuseIndex({
    catalog: null,
    curatedResearch: null,
    researchGraph: null,
    current: currentTarget,
  });

  assert.equal(unavailable.unavailableReason, "catalog_unavailable");
  assert.deepEqual(unavailable.relatedTargets, []);
  assert.deepEqual(unavailable.reusableLeanPaths, []);
  assert.deepEqual(unavailable.priorWork, {
    count: 0,
    curatedRecords: 0,
    sharedCheckpoints: 0,
    externalWorks: 0,
  });
  assert.equal(unavailable.boundary.statement, REUSE_BOUNDARY_STATEMENT);

  const missingCurrent = buildReuseIndex();
  assert.equal(missingCurrent.unavailableReason, "missing_current_target");
  assert.deepEqual(missingCurrent.relatedTargets, []);
});

test("buildReuseIndex keeps catalog matches when only prior-work data is unavailable", () => {
  const partial = buildReuseIndex({
    catalog: [currentTarget, strongGoldbach],
    curatedResearch: null,
    researchGraph: null,
    current: currentTarget,
  });

  assert.equal(partial.relatedTargets.length, 1);
  assert.equal(partial.unavailableReason, "curated_research_unavailable");
  assert.deepEqual(partial.reusableLeanPaths, []);
  assert.equal(partial.priorWork.count, 0);
});

test("buildReuseIndex tolerates malformed rows without throwing", () => {
  assert.doesNotThrow(() => buildReuseIndex({
    catalog: [null, 42, { title: "missing slug" }],
    curatedResearch: [null, { title: "no Lean path" }],
    researchGraph: { nodes: "not-an-array", externalWorks: null },
    current: currentTarget,
  }));

  const malformed = buildReuseIndex({
    catalog: [null, 42, { title: "missing slug" }],
    curatedResearch: [null, { title: "no Lean path" }],
    researchGraph: { nodes: "not-an-array", externalWorks: null },
    current: currentTarget,
  });
  assert.deepEqual(malformed.relatedTargets, []);
  assert.deepEqual(malformed.reusableLeanPaths, []);
  assert.equal(malformed.priorWork.count, 1);
  assert.equal(malformed.unavailableReason, undefined);
});
