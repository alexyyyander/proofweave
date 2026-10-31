import assert from "node:assert/strict";
import test from "node:test";
import {
  conformanceFixtureSet,
  conformanceFixtureSetHash,
  conformanceFixtures,
} from "../services/lean-runner/conformance-fixtures.mjs";
import {
  buildConformanceReport,
  compareConformanceCase,
} from "../services/lean-runner/run-image-conformance.mjs";

test("conformance fixture set covers the audit and version-sensitive cases", async () => {
  const ids = conformanceFixtures.map((fixture) => fixture.id);
  for (const required of [
    "accepted-basic",
    "sorry-rejected",
    "compiler-error",
    "classical-choice",
    "root-qualified-target",
    "imported-module",
    "native-decide",
    "mathlib-import-legacy",
    "mathlib-import-module",
    "module-syntax",
  ]) {
    assert.ok(ids.includes(required), `missing conformance fixture ${required}`);
  }
  assert.equal(conformanceFixtureSet.schemaVersion, "pw-runner-conformance-fixtures-v1");
  assert.match(await conformanceFixtureSetHash(), /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    (await conformanceFixtureSetHash()) === (await conformanceFixtureSetHash()),
    true,
  );
});

test("conformance comparison fails on any status, kernel, or check drift", () => {
  const fixture = conformanceFixtures.find((entry) => entry.id === "accepted-basic");
  const observed = {
    status: "succeeded",
    kernelStatus: "accepted",
    checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
  };
  assert.equal(compareConformanceCase(fixture, observed).passed, true);
  assert.equal(compareConformanceCase(fixture, {
    ...observed,
    checks: { ...observed.checks, allowedAxioms: "failed" },
  }).passed, false);
  assert.equal(compareConformanceCase(fixture, { ...observed, kernelStatus: "rejected" }).passed, false);
});

test("conformance reports hash their fixture set, image, and cases and honor skipped cases", async () => {
  const report = await buildConformanceReport({
    fixtureSetHash: await conformanceFixtureSetHash(),
    imageDigest: `ghcr.io/proofweave/lean-runner@sha256:${"a".repeat(64)}`,
    leanToolchain: "leanprover/lean4:v4.35.0",
    mathlibRevision: "none",
    generatedAt: "2026-10-31T00:00:00.000Z",
    cases: [
      { id: "core", skipped: false, passed: true },
      { id: "mathlib", skipped: true, passed: false },
    ],
  });

  assert.equal(report.passed, true);
  assert.match(report.reportHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(report.schemaVersion, "pw-runner-conformance-report-v1");
});
