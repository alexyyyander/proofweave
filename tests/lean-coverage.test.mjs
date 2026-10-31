import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { validateLeanCoverage } from "../packages/domain/proof-map-index.mjs";

const base = new URL("../", import.meta.url);
const collection = JSON.parse(await readFile(new URL("data/publications/openai-math.json", base), "utf8"));
const lean = JSON.parse(await readFile(new URL("data/proof-maps/lean-coverage.json", base), "utf8"));

test("Lean coverage validates against the pinned catalog", () => {
  assert.equal(validateLeanCoverage(lean, collection), lean);
  assert.equal(lean.summary.familiesWithComparators, 242);
  assert.equal(lean.summary.comparatorLinks, 426);
  assert.equal(lean.summary.jsonFetched, 426);
  assert.equal(lean.summary.challengeFetched, 426);
  assert.equal(lean.summary.solutionFetched, 426);
  assert.equal(lean.summary.solutionMissing, 0);
  assert.equal(lean.summary.theoremNames, 536);
  assert.equal(lean.summary.textualSorry, 0);
  assert.equal(lean.summary.textualAxioms, 0);
});

test("every comparator-linked family and comparator URL is present exactly once", () => {
  assert.equal(lean.families.length, 242);
  assert.equal(new Set(lean.families.map((family) => family.familyNumber)).size, 242);
  const expectedFamilies = collection.families.filter((family) => (family.scope?.comparatorLinks?.length ?? 0) > 0);
  assert.equal(expectedFamilies.length, 242);
  const allComparators = lean.families.flatMap((family) => family.comparators);
  const urls = new Set(allComparators.map((comparator) => comparator.challengeUrl));
  for (const family of expectedFamilies) {
    assert.ok(lean.families.some((candidate) => candidate.familyNumber === family.number), `missing family ${family.number}`);
    for (const link of family.scope.comparatorLinks) assert.ok(urls.has(link.url), `missing comparator ${link.url}`);
  }
  assert.equal(allComparators.length, 426);
  assert.equal(urls.size, 416);
});

test("the Landau–Siegel and Thorp families expose their real solution modules", () => {
  const landau = lean.families.find((family) => family.familyNumber === "003");
  assert.equal(landau.comparatorCount, 4);
  assert.equal(landau.solutionFetched, 4);
  assert.ok(landau.comparators.some((comparator) => comparator.solutionModule === "OAI.NumberTheory.SiegelZeros.Main"));
  assert.ok(landau.theoremNames.includes("OAI.SiegelZeros.WeightedTorusJets.exists_absolute_real_zero_gap"));
  const thorp = lean.families.find((family) => family.familyNumber === "238");
  assert.equal(thorp.comparatorCount, 13);
  assert.equal(thorp.solutionFetched, 13);
  assert.equal(thorp.theoremNames.length, 15);
  assert.ok(thorp.comparators.some((comparator) => comparator.solutionModule === "OAI.Probability.ThorpShuffle.FirstMain"));
});

test("every fetched solution records modules, imports, and textual audit fields", () => {
  for (const family of lean.families) {
    for (const comparator of family.comparators) {
      assert.equal(comparator.solutionStatus, 200);
      assert.ok(comparator.solutionModule);
      assert.ok(comparator.solutionPath);
      assert.ok(comparator.solutionUrl.startsWith("https://"));
      assert.ok(Array.isArray(comparator.solutionImports));
      assert.ok(Number.isInteger(comparator.solutionLines));
      assert.ok(Number.isInteger(comparator.solutionSorry));
      assert.ok(Number.isInteger(comparator.solutionAxioms));
      assert.ok(!("sourceText" in comparator));
      assert.ok(!("proofSteps" in comparator));
    }
  }
});

test("Lean coverage refuses mismatched summaries and missing solution modules", () => {
  const broken = JSON.parse(JSON.stringify(lean));
  broken.summary.solutionFetched -= 1;
  assert.throws(() => validateLeanCoverage(broken, collection), /summary\.solutionFetched/);

  const duplicate = JSON.parse(JSON.stringify(lean));
  duplicate.families[1].familyNumber = duplicate.families[0].familyNumber;
  assert.throws(() => validateLeanCoverage(duplicate, collection), /duplicate leanCoverage family/);

  const missingModule = JSON.parse(JSON.stringify(lean));
  missingModule.families[0].comparators[0].solutionStatus = 200;
  missingModule.families[0].comparators[0].solutionModule = null;
  assert.throws(() => validateLeanCoverage(missingModule, collection), /solutionModule is required/);

  const wrongCommit = JSON.parse(JSON.stringify(lean));
  wrongCommit.commit = "0000000000000000000000000000000000000000";
  assert.throws(() => validateLeanCoverage(wrongCommit, collection), /must match the catalog source revision/);
});
