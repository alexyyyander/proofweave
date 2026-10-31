import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkCloudflareContributionRelease as check, cloudflareContributionSchema } from "../scripts/check-cloudflare-contribution-release.mjs";
import { checkCredentialedContributionRelease } from "../scripts/check-credentialed-contribution-release.mjs";
import { inspectCloudflareReleaseEvidence } from "../scripts/lib/cloudflare-release-evidence.mjs";
import { releaseFixture } from "./fixtures/cloudflare-release-evidence.mjs";
import { completeEvidence } from "./fixtures/credentialed-contribution-evidence.mjs";

async function fixture(options) {
  const f = await releaseFixture({ paused: false, ...options });
  const evidence = completeEvidence(); delete evidence.environment;
  evidence.schemaVersion = cloudflareContributionSchema;
  evidence.release = { before: f.observation, after: structuredClone(f.observation) };
  evidence.release.after.observedAt = "2026-07-29T11:00:00Z";
  return { ...f, evidence };
}

test("v2 checks component-bound 0049 contribution graphs without inventing a common SHA", async () => {
  const f = await fixture(); const snapshot = JSON.stringify(f);
  const result = await check(f);
  assert.equal(result.outcome, "consistent"); assert.equal(result.executionMode, "offline_dry_run");
  assert.equal(result.release.componentsIndependentlyBound, true);
  assert.equal(result.release.sameSitesGatewayRunnerRevision, undefined);
  assert.equal(result.contribution.independentReviewerPersonCount, 2);
  assert.equal(result.boundary.signaturesCryptographicallyReverified, false);
  assert.equal(result.boundary.executionAuthorized, false);
  assert.equal(result.boundary.fineGrainedWriteGateVerified, false);
  assert.equal(JSON.stringify(f), snapshot);
});

test("production-shaped evidence is offline consistency only and never grants release approval", async () => {
  const result = await check(await fixture({ production: true }));
  assert.equal(result.release.environment.kind, "production");
  assert.equal(result.boundary.releaseApproved, false);
  assert.equal(result.boundary.liveProviderStateVerified, false);
  assert.equal(result.boundary.networkRequestsMade, false);
  assert.equal(result.boundary.externalRecordsCreated, false);
});

test("paused diagnostics alone cannot pass a completed contribution gate", async () => {
  await assert.rejects(check(await fixture({ paused: true })), /CONTRIBUTION_EXECUTION_EVIDENCE_REQUIRED/);
});

test("v2 retains independent review, replay, signature flags, Receipt linkage and time-window checks", async t => {
  const cases = [
    f => { f.evidence.reviews[0].reviewerPersonId = f.evidence.researcher.personId; },
    f => { f.evidence.reviews[1].replay = null; },
    f => { f.evidence.receipt.signatureValid = false; },
    f => { f.evidence.publicReceiptVerification.receiptHash = "sha256:" + "0".repeat(64); },
    f => { f.evidence.release.after.observedAt = "2026-07-29T10:10:00Z"; },
    f => { f.evidence.release.after.observedAt = "2026-07-29T09:59:00Z"; },
    f => { f.evidence.release.after.runner.health.runnerPolicy.templateBuildId = "drift"; },
    f => { delete f.evidence.release.before.database.ledger; },
    f => { f.evidence.release.after.cloudflare.capabilities.releaseDiagnostics.ledgerHead = "0043_add_runner_queue_event_sequence.sql"; },
    f => { f.evidence.cookie = "do-not-copy"; },
    f => { f.evidence.release.extra = true; },
    f => { f.evidence.schemaVersion = "unknown"; },
  ];
  for (const [i, mutate] of cases.entries()) await t.test(String(i), async () => {
    const f = await fixture(); mutate(f); await assert.rejects(check(f));
  });
});

test("the legacy checker still rejects production and any migration head other than 0043", () => {
  const f = completeEvidence(); f.environment.origin = "https://proofweave.org";
  assert.throws(() => checkCredentialedContributionRelease(f), e => e.code === "PRODUCTION_ORIGIN_FORBIDDEN");
  f.environment.origin = "https://staging.example";
  f.environment.databaseFingerprint = "3f9e7934a04a22ec";
  assert.throws(() => checkCredentialedContributionRelease(f), e => e.code === "PRODUCTION_DATABASE_FINGERPRINT_FORBIDDEN");
  f.environment.databaseFingerprint = "0123456789abcdef";
  f.release.before.migrationHead = "0050_add_runner_queue_environment.sql";
  assert.throws(() => checkCredentialedContributionRelease(f), e => e.code === "MIGRATION_HEAD_REQUIRED");
});

test("the v2 CLI uses separately pinned bounded files and redacts failure output", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pw-cf-evidence-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const f = await fixture(); const evidence = join(dir, "evidence.json"); const manifest = join(dir, "manifest.json");
  await writeFile(evidence, JSON.stringify(f.evidence)); await writeFile(manifest, JSON.stringify(f.manifest));
  const script = fileURLToPath(new URL("../scripts/check-cloudflare-contribution-release.mjs", import.meta.url));
  const args = [script, "--evidence-file", evidence, "--manifest-file", manifest, "--expected-manifest-hash", f.expectedManifestHash];
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).outcome, "consistent");
  f.evidence.cookie = "sensitive-test-cookie-never-echo"; await writeFile(evidence, JSON.stringify(f.evidence));
  const failed = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(failed.status, 1); assert.doesNotMatch(failed.stderr, /sensitive-test-cookie-never-echo/);
  assert.equal(JSON.parse(failed.stderr).executionAuthorized, false);
});


test("CLI binding-only mode accepts paused records without treating them as a contribution", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pw-cf-paused-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const f = await releaseFixture(); const evidence = join(dir, "observation.json"); const manifest = join(dir, "manifest.json");
  await writeFile(evidence, JSON.stringify(f.observation)); await writeFile(manifest, JSON.stringify(f.manifest));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/check-cloudflare-contribution-release.mjs", import.meta.url)), "--binding-only", "--evidence-file", evidence, "--manifest-file", manifest, "--expected-manifest-hash", f.expectedManifestHash], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.binding.runnerState, "paused"); assert.equal(report.contribution, undefined);
  assert.equal(report.boundary.networkRequestsMade, false); assert.equal(report.boundary.releaseApproved, false);
});


test("fresh probes cannot be relabeled into the historical contribution window", async () => {
  const f = await fixture();
  const provider = structuredClone(f.observation);
  provider.observedAt = "2026-10-20T10:00:00Z";
  const inspected = await inspectCloudflareReleaseEvidence({ ...f, providerObservation: provider,
    now: () => new Date("2026-10-20T10:00:01Z"),
    fetcher: async url => Response.json(url.endsWith("/healthz") ? f.observation.runner.health : f.observation.cloudflare.capabilities) });
  f.evidence.release.before = inspected.observation;
  f.evidence.release.after = structuredClone(inspected.observation);
  await assert.rejects(check(f), error => error.code === "EVENT_OUTSIDE_RELEASE_WINDOW");
  f.evidence.release.before.observedAt = "2026-07-29T10:00:00Z";
  f.evidence.release.after.observedAt = "2026-07-29T11:00:00Z";
  await assert.rejects(check(f), /OBSERVATION_COLLECTION_TIME_MISMATCH/);
});

test("contribution completion must precede the after-probe start", async () => {
  const f = await fixture();
  const after = f.evidence.release.after;
  after.collectionWindow = { providerObservedAt: "2026-07-29T10:49:40Z", startedAt: "2026-07-29T10:49:50Z", completedAt: "2026-07-29T10:50:10Z" };
  after.observedAt = after.collectionWindow.completedAt;
  await assert.rejects(check(f), error => error.code === "EVENT_OUTSIDE_RELEASE_WINDOW");
  after.collectionWindow.startedAt = "2026-07-29T10:50:05Z";
  const result = await check(f);
  assert.equal(result.outcome, "consistent");
});
