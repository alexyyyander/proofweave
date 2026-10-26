import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PUBLICATION_CLAIMS_BOUNDARY,
  PUBLICATION_CLAIMS_SCHEMA_VERSION,
  lookupClaimsByFamily,
  validatePublicationClaims,
} from "../packages/domain/publication-claims.mjs";

const sourcePath = fileURLToPath(new URL("../data/publications/openai-math.json", import.meta.url));
const curatedDirectory = fileURLToPath(new URL("../data/publications/claims/", import.meta.url));
const claimsPath = fileURLToPath(new URL("../data/publications/claims/openai-math-claims.json", import.meta.url));
const buildScript = fileURLToPath(new URL("../scripts/ingest/build-publication-claims.mjs", import.meta.url));

const source = JSON.parse(await readFile(sourcePath, "utf8"));
const claims = JSON.parse(await readFile(claimsPath, "utf8"));
const clone = (value) => structuredClone(value);

test("generated claims validate against the pinned upstream collection", () => {
  assert.equal(claims.schemaVersion, PUBLICATION_CLAIMS_SCHEMA_VERSION);
  assert.equal(claims.boundary, PUBLICATION_CLAIMS_BOUNDARY);
  assert.equal(claims.boundary, "Upstream claim mapped by Proofweave; not a platform replay.");
  assert.equal(claims.source.revision, source.source.revision);
  assert.doesNotThrow(() => validatePublicationClaims(claims, { sourceCollection: source }));

  assert.deepEqual(claims.families.map((family) => family.familyNumber), ["032", "084", "159", "181"]);
  const claimIds = new Set();
  for (const family of claims.families) {
    const sourceFamily = source.families.find((entry) => entry.number === family.familyNumber);
    assert.ok(sourceFamily);
    assert.equal(family.familyTitle, sourceFamily.title);
    assert.ok(family.claims.length >= 1);
    for (const claim of family.claims) {
      assert.ok(!claimIds.has(claim.id));
      claimIds.add(claim.id);
      assert.ok(claim.statement.length > 0);
      assert.ok(claim.assumptions.length > 0);
      assert.ok(claim.conclusion.length > 0);
      assert.ok(claim.sourceManuscriptIds.length > 0);
      assert.ok(claim.sourceManuscriptIds.every((id) => sourceFamily.manuscripts.some((manuscript) => manuscript.id === id)));
      assert.equal(claim.verification.status, "not_run");
      assert.equal(claim.target.status, "unmapped");
    }
  }
  assert.equal(claimIds.size, 8);
});

test("committed claims mirror every curated input", async () => {
  const curatedFiles = (await readdir(curatedDirectory)).filter((name) => name.endsWith(".curated.json")).sort();
  assert.equal(curatedFiles.length, 4);
  assert.deepEqual(claims.source.curatedInputs, curatedFiles.map((name) => `data/publications/claims/${name}`));
  for (const name of curatedFiles) {
    const curated = JSON.parse(await readFile(join(curatedDirectory, name), "utf8"));
    const family = claims.families.find((entry) => entry.familyNumber === curated.familyNumber);
    assert.ok(family, `${name} has no generated family entry`);
    assert.deepEqual(family.claims, curated.claims);
    assert.equal(family.familyTitle, source.families.find((entry) => entry.number === curated.familyNumber).title);
  }
});

test("duplicate claim ids are rejected", () => {
  const invalid = clone(claims);
  invalid.families[1].claims[1].id = invalid.families[0].claims[0].id;
  assert.throws(() => validatePublicationClaims(invalid, { sourceCollection: source }), /duplicate claim id/);
});

test("claims without assumptions or conclusions are rejected", () => {
  const missingConclusion = clone(claims);
  delete missingConclusion.families[0].claims[0].conclusion;
  assert.throws(() => validatePublicationClaims(missingConclusion, { sourceCollection: source }), /conclusion/);

  const missingAssumptions = clone(claims);
  missingAssumptions.families[0].claims[0].assumptions = [];
  assert.throws(() => validatePublicationClaims(missingAssumptions, { sourceCollection: source }), /assumptions/);

  const missingStatement = clone(claims);
  missingStatement.families[0].claims[0].statement = "";
  assert.throws(() => validatePublicationClaims(missingStatement, { sourceCollection: source }), /statement/);
});

test("illegal states, boundaries, and manuscript references are rejected", () => {
  const illegalCoverage = clone(claims);
  illegalCoverage.families[0].claims[0].coverage.status = "verified";
  assert.throws(() => validatePublicationClaims(illegalCoverage, { sourceCollection: source }), /coverage\.status/);

  const illegalVerification = clone(claims);
  illegalVerification.families[0].claims[0].verification.status = "replayed";
  assert.throws(() => validatePublicationClaims(illegalVerification, { sourceCollection: source }), /verification\.status/);

  const alteredBoundary = clone(claims);
  alteredBoundary.boundary = "Verified by Proofweave";
  assert.throws(() => validatePublicationClaims(alteredBoundary, { sourceCollection: source }), /boundary/);

  const missingManuscript = clone(claims);
  missingManuscript.families[0].claims[0].sourceManuscriptIds = ["not-a-real-manuscript"];
  assert.throws(() => validatePublicationClaims(missingManuscript, { sourceCollection: source }), /does not exist in family/);
});

test("unknown families return no claims and fail source-aware validation", () => {
  assert.equal(lookupClaimsByFamily(claims, "999"), undefined);
  assert.equal(lookupClaimsByFamily(claims, "abc"), undefined);
  assert.equal(lookupClaimsByFamily(claims, "084").familyNumber, "084");
  assert.equal(lookupClaimsByFamily(claims, 84).familyNumber, "084");

  const unknownFamily = clone(claims);
  unknownFamily.families[0].familyNumber = "999";
  unknownFamily.families[0].familyTitle = "A family that does not exist upstream";
  assert.throws(
    () => validatePublicationClaims(unknownFamily, { sourceCollection: source }),
    /does not exist in the source collection/,
  );
});

test("084 keeps the arbitrary-ratio versus dyadic Lean scope difference", () => {
  const general = lookupClaimsByFamily(claims, "084").claims.find((claim) => claim.id === "084-c1");
  assert.equal(general.coverage.status, "partial");
  assert.equal(general.leanDeclaration.status, "partial");
  assert.ok(general.coverage.note.includes("dyadic case q = 1/2"));
  assert.ok(general.coverage.note.includes("arbitrary geometric ratio"));
  assert.match(general.statement, /q\\in\(0,1\)/);

  const dyadic = lookupClaimsByFamily(claims, "084").claims.find((claim) => claim.id === "084-c2");
  assert.equal(dyadic.coverage.status, "documented");
  assert.equal(dyadic.leanDeclaration.status, "documented");
  assert.match(dyadic.coverage.scopeExcerpt, /dyadic case/);
  assert.ok(dyadic.coverage.note.length > 0);
});

test("159 keeps the qualitative Lean statement separate from the quantitative bound", () => {
  const qualitative = lookupClaimsByFamily(claims, "159").claims.find((claim) => claim.id === "159-c1");
  assert.equal(qualitative.coverage.status, "documented");
  assert.equal(qualitative.leanDeclaration.status, "documented");
  assert.ok(qualitative.coverage.note.length > 0);

  const quantitative = lookupClaimsByFamily(claims, "159").claims.find((claim) => claim.id === "159-c2");
  assert.equal(quantitative.coverage.status, "unmapped");
  assert.equal(quantitative.leanDeclaration.status, "unknown");
  assert.match(quantitative.coverage.note, /quantitative quasipolynomial upper bound outside the formalized statement/);
  assert.ok(quantitative.coverage.note.length > 0);
});

test("build script output is deterministic and matches the committed artifact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "proofweave-claims-"));
  try {
    const output = join(directory, "claims.json");
    const result = spawnSync(process.execPath, [buildScript, sourcePath, curatedDirectory, output], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(output, "utf8"), await readFile(claimsPath, "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("build script fails clearly when no curated inputs are present", async () => {
  const directory = await mkdtemp(join(tmpdir(), "proofweave-claims-empty-"));
  try {
    const result = spawnSync(process.execPath, [
      buildScript, sourcePath, directory, join(directory, "claims.json"),
    ], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No curated claim inputs found/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
