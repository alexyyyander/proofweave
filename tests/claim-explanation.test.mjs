import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  ClaimExplanationValidationError,
  validateClaimExplanation,
} from "../packages/domain/claim-explanation.mjs";

const catalog = JSON.parse(await readFile(new URL("../data/publications/openai-math.json", import.meta.url), "utf8"));

function validExplanation() {
  return {
    schemaVersion: "pw-claim-explanation-v1",
    familyNumber: "001",
    title: "A sample result family",
    level: "plain",
    status: "draft",
    reviewStatus: "unreviewed",
    assumptions: ["The object is fixed."],
    conclusion: "The stated property holds.",
    notProven: ["No platform replay or independent review is recorded."],
    scopeNote: "This draft is limited to the quoted source snapshot.",
    scopeDiff: {
      paperStatement: "The source states the property for every object.",
      leanStatement: "The upstream scope states a narrower case.",
      leanStatementStatus: "recorded",
      platformStatus: "Not run.",
      needsReview: false,
    },
    proofSteps: [
      { id: "step-1", label: "Assume the object", detail: "Start from the fixed object.", dependsOn: [] },
    ],
    leanAnnotations: [
      {
        id: "lean-1",
        file: null,
        url: null,
        excerpt: null,
        excerptStatus: "not_in_snapshot",
        annotation: "No Lean excerpt is included in the snapshot.",
        needsReview: true,
      },
    ],
    glossary: [{ term: "Object", definition: "The fixed object named in the statement." }],
    sources: [{ label: "Pinned snapshot", url: "https://example.org/snapshot", kind: "snapshot" }],
  };
}

test("a complete draft explanation passes validation", () => {
  const explanation = validExplanation();
  assert.equal(validateClaimExplanation(explanation), explanation);
});

test("an explanation without notProven is rejected", () => {
  const partial = validExplanation();
  delete partial.notProven;
  assert.throws(() => validateClaimExplanation(partial), ClaimExplanationValidationError, /notProven/);
});

test("an unknown level is rejected", () => {
  assert.throws(
    () => validateClaimExplanation({ ...validExplanation(), level: "beginner" }),
    ClaimExplanationValidationError,
    /level must be one of/,
  );
});

test("an explanation without sources is rejected", () => {
  assert.throws(
    () => validateClaimExplanation({ ...validExplanation(), sources: [] }),
    ClaimExplanationValidationError,
    /sources must not be empty/,
  );
});

test("a non-draft status is rejected", () => {
  assert.throws(
    () => validateClaimExplanation({ ...validExplanation(), status: "reviewed" }),
    ClaimExplanationValidationError,
    /status must be "draft"/,
  );
});

test("the three publication artifacts validate and stay drafts without platform claims", async () => {
  for (const number of ["032", "084", "159"]) {
    const artifact = JSON.parse(await readFile(new URL(`../data/publications/explanations/openai-math-${number}.json`, import.meta.url), "utf8"));
    assert.equal(validateClaimExplanation(artifact), artifact);
    assert.equal(artifact.familyNumber, number);
    assert.equal(artifact.status, "draft");
    assert.equal(artifact.reviewStatus, "unreviewed");
    assert.ok(artifact.sources.length > 0);
    assert.ok(artifact.notProven.some((text) => /proofweaveReplay: not_run/.test(text)));
    assert.ok(!JSON.stringify(artifact).includes("Proofweave verified"));
  }
});

test("quoted statements match the pinned catalog snapshot", async () => {
  for (const number of ["032", "084", "159"]) {
    const artifact = JSON.parse(await readFile(new URL(`../data/publications/explanations/openai-math-${number}.json`, import.meta.url), "utf8"));
    const family = catalog.families.find((entry) => entry.number === number);
    assert.ok(family);
    assert.equal(artifact.scopeDiff.paperStatement, family.claim);
    assert.equal(artifact.scopeDiff.leanStatement, family.scope?.text ?? null);
    assert.equal(artifact.sourceRevision, catalog.source.revision);
  }
});

test("084 and 159 record their scope gaps as scope differences", async () => {
  const artifact084 = JSON.parse(await readFile(new URL("../data/publications/explanations/openai-math-084.json", import.meta.url), "utf8"));
  assert.match(artifact084.scopeDiff.paperStatement, /every fixed/);
  assert.match(artifact084.scopeDiff.paperStatement, /every ratio/);
  assert.match(artifact084.scopeDiff.leanStatement, /dyadic case/);
  assert.match(artifact084.scopeDiff.leanStatement, /2\^\{-n\}/);
  assert.ok(artifact084.notProven.some((text) => /general ratio q/.test(text)));

  const artifact159 = JSON.parse(await readFile(new URL("../data/publications/explanations/openai-math-159.json", import.meta.url), "utf8"));
  assert.match(artifact159.scopeDiff.paperStatement, /Quantitatively/);
  assert.match(artifact159.scopeDiff.leanStatement, /outside this statement/);
  assert.ok(artifact159.notProven.some((text) => /quantitative upper bound/.test(text)));
});
