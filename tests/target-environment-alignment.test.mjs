import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTargetEnvironmentAlignment,
  parseApprovedImages,
  parseJsonc,
  formatHumanReport,
  schemaVersion,
} from "../scripts/check-target-environments.mjs";

const approvedImages = [{
  imageDigest: "ghcr.io/example/runner@sha256:abc",
  leanToolchain: "leanprover/lean4:v4.31.0",
  mathlibRevision: "9a9483a92959bc92bd6a60176dd1fe597298c1f8",
}];

test("a target is executable only when Lean and Mathlib both match an approved image", () => {
  const report = buildTargetEnvironmentAlignment({
    approvedImages,
    records: [
      { slug: "match", title: "Match", source: { leanToolchain: "leanprover/lean4:v4.31.0", mathlibRevision: "9a9483a92959bc92bd6a60176dd1fe597298c1f8" } },
      { slug: "lean-mismatch", title: "Lean mismatch", source: { leanToolchain: "leanprover/lean4:v4.27.0", mathlibRevision: "9a9483a92959bc92bd6a60176dd1fe597298c1f8" } },
      { slug: "mathlib-mismatch", title: "Mathlib mismatch", source: { leanToolchain: "leanprover/lean4:v4.31.0", mathlibRevision: "a3a10db0e9d66acbebf76c5e6a135066525ac900" } },
    ],
  });
  assert.equal(report.schemaVersion, schemaVersion);
  assert.deepEqual(report.totals, { records: 3, executable: 1, mismatch: 2, unknown: 0 });
  assert.equal(report.records[0].status, "executable");
  assert.equal(report.records[0].approvedImageDigest, approvedImages[0].imageDigest);
  assert.equal(report.records[1].status, "mismatch");
  assert.equal(report.records[2].status, "mismatch");
});

test("missing environment pins are reported as unknown instead of executable", () => {
  const report = buildTargetEnvironmentAlignment({
    approvedImages,
    records: [{ slug: "missing", title: "Missing pin", source: {} }],
  });
  assert.deepEqual(report.totals, { records: 1, executable: 0, mismatch: 0, unknown: 1 });
  assert.equal(report.records[0].reason, "missing_pin");
});

test("mismatch groups aggregate by Lean and Mathlib pin", () => {
  const report = buildTargetEnvironmentAlignment({
    approvedImages,
    records: [
      { slug: "a", title: "A", source: { leanToolchain: "leanprover/lean4:v4.27.0", mathlibRevision: "a3a10db0e9d66acbebf76c5e6a135066525ac900" } },
      { slug: "b", title: "B", source: { leanToolchain: "leanprover/lean4:v4.27.0", mathlibRevision: "a3a10db0e9d66acbebf76c5e6a135066525ac900" } },
    ],
  });
  assert.equal(report.mismatchGroups.length, 1);
  assert.equal(report.mismatchGroups[0].count, 2);
  assert.match(formatHumanReport(report), /mismatch 2/);
});

test("approved image configuration fails closed on missing or malformed values", () => {
  assert.throws(() => parseApprovedImages(undefined), /missing/);
  assert.throws(() => parseApprovedImages("not json"), /not valid JSON/);
  assert.throws(() => parseApprovedImages("[]"), /at least one/);
  assert.throws(() => parseApprovedImages("[{}]"), /imageDigest/);
  assert.deepEqual(parseApprovedImages(JSON.stringify(approvedImages)), approvedImages);
});

test("jsonc parsing tolerates comments and trailing commas", () => {
  const parsed = parseJsonc(`{
    // comment
    "vars": { "RUNNER_APPROVED_IMAGES_JSON": "[]", },
  }`);
  assert.deepEqual(parsed, { vars: { RUNNER_APPROVED_IMAGES_JSON: "[]" } });
});
