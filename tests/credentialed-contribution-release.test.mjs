import { completeEvidence, sha } from "./fixtures/credentialed-contribution-evidence.mjs";
import assert from "node:assert/strict";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  checkCredentialedContributionRelease,
  loadCredentialedContributionEvidence,
} from "../scripts/check-credentialed-contribution-release.mjs";

test("accepts one complete redacted two-Person evidence graph offline", () => {
  const evidence = completeEvidence();
  const result = checkCredentialedContributionRelease(evidence);

  assert.equal(result.outcome, "passed");
  assert.equal(result.executionMode, "offline_dry_run");
  assert.equal(result.release.controlPlaneMode, "read_write");
  assert.deepEqual(result.release.environment, {
    kind: "staging",
    name: "proofweave-credentialed-smoke",
    origin: "https://staging.proofweave.example",
    databaseFingerprint: "0123456789abcdef",
  });
  assert.equal(result.release.sameSitesGatewayRunnerRevision, true);
  assert.equal(result.contribution.primaryRunnerAccepted, true);
  assert.equal(result.contribution.independentReviewerPersonCount, 2);
  assert.deepEqual(result.contribution.claims, [
    "bundle_reproducible",
    "kernel_accepted",
    "project_accepted",
  ]);
  assert.equal(result.contribution.publicReceiptReverified, true);
  assert.equal(result.boundary.networkRequestsMade, false);
  assert.equal(result.boundary.actualOperationsStillRequired, true);
  assert.equal(result.boundary.signaturesCryptographicallyReverified, false);
});

test("fails closed when any required chain segment is missing", () => {
  for (const field of [
    "environment",
    "release",
    "researcher",
    "attempt",
    "bundle",
    "runner",
    "reviews",
    "receipt",
    "publicReceiptVerification",
  ]) {
    const evidence = completeEvidence();
    delete evidence[field];
    assert.throws(
      () => checkCredentialedContributionRelease(evidence),
      /Expected (?:an object|an array)\./,
      field,
    );
  }
});

test("rejects read-only mode and release revision drift", () => {
  const readOnly = completeEvidence();
  readOnly.release.before.controlPlaneMode = "read_only";
  readOnly.release.before.writesEnabled = false;
  assert.throws(
    () => checkCredentialedContributionRelease(readOnly),
    (error) => error.code === "ENUM_VALUE_INVALID"
      && error.path === "$.release.before.controlPlaneMode",
  );

  const drift = completeEvidence();
  drift.release.after.runnerRevision = "b".repeat(40);
  assert.throws(
    () => checkCredentialedContributionRelease(drift),
    (error) => error.code === "RELEASE_REVISION_MISMATCH"
      && error.path === "$.release.after.runnerRevision",
  );
});

test("rejects a different database or migration after the journey", () => {
  const databaseDrift = completeEvidence();
  databaseDrift.release.after.databaseFingerprint = "fedcba9876543210";
  assert.throws(
    () => checkCredentialedContributionRelease(databaseDrift),
    (error) => error.code === "STAGING_DATABASE_FINGERPRINT_MISMATCH"
      && error.path === "$.release.after.databaseFingerprint",
  );

  const migrationDrift = completeEvidence();
  migrationDrift.release.after.migrationHead =
    "0042_add_jacobian_counterexample_audit.sql";
  assert.throws(
    () => checkCredentialedContributionRelease(migrationDrift),
    (error) => error.code === "MIGRATION_HEAD_REQUIRED"
      && error.path === "$.release.after.migrationHead",
  );
});

test("requires the exact reviewed 0043 migration head", () => {
  for (const migrationHead of [
    "0042_add_jacobian_counterexample_audit.sql",
    "0043_runner_lease_queue.sql",
    "0044_future_migration.sql",
  ]) {
    const evidence = completeEvidence();
    evidence.release.before.migrationHead = migrationHead;
    evidence.release.after.migrationHead = migrationHead;
    assert.throws(
      () => checkCredentialedContributionRelease(evidence),
      (error) => error.code === "MIGRATION_HEAD_REQUIRED"
        && error.path === "$.release.before.migrationHead",
      migrationHead,
    );
  }
});

test("rejects the production origin and production database fingerprint", () => {
  const productionOrigin = completeEvidence();
  productionOrigin.environment.origin =
    "https://proofweave.org";
  assert.throws(
    () => checkCredentialedContributionRelease(productionOrigin),
    (error) => error.code === "PRODUCTION_ORIGIN_FORBIDDEN"
      && error.path === "$.environment.origin",
  );

  const productionDatabase = completeEvidence();
  productionDatabase.environment.databaseFingerprint =
    "3f9e7934a04a22ec";
  productionDatabase.release.before.databaseFingerprint =
    "3f9e7934a04a22ec";
  productionDatabase.release.after.databaseFingerprint =
    "3f9e7934a04a22ec";
  assert.throws(
    () => checkCredentialedContributionRelease(productionDatabase),
    (error) => error.code === "PRODUCTION_DATABASE_FINGERPRINT_FORBIDDEN"
      && error.path === "$.environment.databaseFingerprint",
  );
});

test("requires a staging environment identity bound to release observations", () => {
  const wrongKind = completeEvidence();
  wrongKind.environment.kind = "production";
  assert.throws(
    () => checkCredentialedContributionRelease(wrongKind),
    (error) => error.code === "ENUM_VALUE_INVALID"
      && error.path === "$.environment.kind",
  );

  const authorityDrift = completeEvidence();
  authorityDrift.environment.databaseFingerprint = "fedcba9876543210";
  assert.throws(
    () => checkCredentialedContributionRelease(authorityDrift),
    (error) => error.code === "STAGING_DATABASE_FINGERPRINT_MISMATCH"
      && error.path === "$.release.before.databaseFingerprint",
  );
});

test("rejects same-Person review and a review delegation without review scope", () => {
  const sameOwner = completeEvidence();
  sameOwner.reviews[0].reviewerPersonId = "person:alice";
  sameOwner.reviews[0].reviewerDelegationOwnerPersonId = "person:alice";
  assert.throws(
    () => checkCredentialedContributionRelease(sameOwner),
    (error) => error.code === "REVIEW_NOT_INDEPENDENT",
  );

  const missingScope = completeEvidence();
  missingScope.reviews[0].reviewerDelegationScopes = ["formalize"];
  assert.throws(
    () => checkCredentialedContributionRelease(missingScope),
    (error) => error.code === "REVIEW_DELEGATION_SCOPE_MISSING",
  );
});

test("requires a fresh replay for bundle reproducibility", () => {
  const missingReplay = completeEvidence();
  delete missingReplay.reviews[0].replay;
  assert.throws(
    () => checkCredentialedContributionRelease(missingReplay),
    (error) => error.code === "OBJECT_REQUIRED"
      && error.path === "$.reviews[0].replay",
  );

  const wrongReplay = completeEvidence();
  wrongReplay.reviews[0].replay.evidenceHash = sha("0");
  assert.throws(
    () => checkCredentialedContributionRelease(wrongReplay),
    (error) => error.code === "REPLAY_EVIDENCE_HASH_MISMATCH",
  );
});

test("requires the assigned review Agent's exact fresh replay for kernel acceptance", () => {
  const missingReplay = completeEvidence();
  delete missingReplay.reviews[1].replay;
  assert.throws(
    () => checkCredentialedContributionRelease(missingReplay),
    (error) => error.code === "OBJECT_REQUIRED"
      && error.path === "$.reviews[1].replay",
  );

  const primaryRunReuse = completeEvidence();
  primaryRunReuse.reviews[1].replay.runId = "run:release-smoke";
  assert.throws(
    () => checkCredentialedContributionRelease(primaryRunReuse),
    (error) => error.code === "REPLAY_RUN_NOT_FRESH",
  );

  const wrongBundle = completeEvidence();
  wrongBundle.reviews[1].replay.artifactBundleHash = sha("0");
  assert.throws(
    () => checkCredentialedContributionRelease(wrongBundle),
    (error) => error.code === "REPLAY_BUNDLE_MISMATCH",
  );
});

test("binds fresh replay to the accepted assignment and exact review identity", () => {
  const wrongPerson = completeEvidence();
  wrongPerson.reviews[0].replay.requesterPersonId = "person:mallory";
  assert.throws(
    () => checkCredentialedContributionRelease(wrongPerson),
    (error) => error.code === "REPLAY_REVIEWER_PERSON_MISMATCH",
  );

  const wrongAgent = completeEvidence();
  wrongAgent.reviews[0].replay.requesterAgentId = "agent:mallory-reviewer";
  assert.throws(
    () => checkCredentialedContributionRelease(wrongAgent),
    (error) => error.code === "REPLAY_REVIEWER_AGENT_MISMATCH",
  );

  const wrongDelegation = completeEvidence();
  wrongDelegation.reviews[0].replay.delegationCertificateId =
    "delegation:mallory-reviewer";
  assert.throws(
    () => checkCredentialedContributionRelease(wrongDelegation),
    (error) => error.code === "REPLAY_DELEGATION_MISMATCH",
  );
});

test("rejects replay timing that the authoritative verification store rejects", () => {
  const requestedBeforeAcceptance = completeEvidence();
  requestedBeforeAcceptance.reviews[0].replay.requestedAt =
    "2026-07-29T10:26:59Z";
  assert.throws(
    () => checkCredentialedContributionRelease(requestedBeforeAcceptance),
    (error) => error.code === "REPLAY_REQUEST_PRECEDES_ASSIGNMENT",
  );

  const runBeforeRequest = completeEvidence();
  runBeforeRequest.reviews[0].replay.startedAt = "2026-07-29T10:26:59Z";
  assert.throws(
    () => checkCredentialedContributionRelease(runBeforeRequest),
    (error) => error.code === "REPLAY_RUN_TIMELINE_INVALID",
  );

  const evidenceBeforeFinish = completeEvidence();
  evidenceBeforeFinish.reviews[0].replay.recordedAt =
    "2026-07-29T10:28:30Z";
  assert.throws(
    () => checkCredentialedContributionRelease(evidenceBeforeFinish),
    (error) => error.code === "REPLAY_EVIDENCE_PRECEDES_RUN",
  );

  const attestationBeforeReplay = completeEvidence();
  attestationBeforeReplay.reviews[0].attestedAt =
    "2026-07-29T10:29:30Z";
  assert.throws(
    () => checkCredentialedContributionRelease(attestationBeforeReplay),
    (error) => error.code === "EVENT_ORDER_INVALID"
      && error.path === "$.reviews[0].attestedAt",
  );
});

test("rejects a Runner that did not pass kernel and policy checks", () => {
  const rejectedKernel = completeEvidence();
  rejectedKernel.runner.kernelStatus = "rejected";
  assert.throws(
    () => checkCredentialedContributionRelease(rejectedKernel),
    (error) => error.code === "ENUM_VALUE_INVALID"
      && error.path === "$.runner.kernelStatus",
  );

  const sorry = completeEvidence();
  sorry.runner.checks.noSorry = "failed";
  assert.throws(
    () => checkCredentialedContributionRelease(sorry),
    (error) => error.code === "ENUM_VALUE_INVALID"
      && error.path === "$.runner.checks.noSorry",
  );
});

test("requires all policy claims and exact Receipt linkage", () => {
  const missingClaim = completeEvidence();
  missingClaim.reviews.pop();
  assert.throws(
    () => checkCredentialedContributionRelease(missingClaim),
    (error) => error.code === "REQUIRED_REVIEW_MISSING",
  );

  const wrongBundle = completeEvidence();
  wrongBundle.receipt.artifactBundleHash = sha("0");
  assert.throws(
    () => checkCredentialedContributionRelease(wrongBundle),
    (error) => error.code === "RECEIPT_BUNDLE_MISMATCH",
  );

  const wrongAttestation = completeEvidence();
  wrongAttestation.receipt.claims[0].verificationAttestationHash = sha("0");
  assert.throws(
    () => checkCredentialedContributionRelease(wrongAttestation),
    (error) => error.code === "RECEIPT_ATTESTATION_HASH_MISMATCH",
  );
});

test("does not misclassify an independent verification Receipt as Person A research credit", () => {
  const evidence = completeEvidence();
  evidence.receipt.kind = "verification";
  assert.throws(
    () => checkCredentialedContributionRelease(evidence),
    (error) => error.code === "ENUM_VALUE_INVALID"
      && error.path === "$.receipt.kind",
  );
});

test("requires current public Receipt verification after issuance", () => {
  const notVerified = completeEvidence();
  notVerified.publicReceiptVerification.status = "unknown";
  assert.throws(
    () => checkCredentialedContributionRelease(notVerified),
    (error) => error.code === "ENUM_VALUE_INVALID",
  );

  const wrongHash = completeEvidence();
  wrongHash.publicReceiptVerification.receiptHash = sha("0");
  assert.throws(
    () => checkCredentialedContributionRelease(wrongHash),
    (error) => error.code === "PUBLIC_RECEIPT_HASH_MISMATCH",
  );
});

test("rejects timestamps outside the observed release window", () => {
  const beforeRelease = completeEvidence();
  beforeRelease.attempt.createdAt = "2026-07-29T09:59:59Z";
  assert.throws(
    () => checkCredentialedContributionRelease(beforeRelease),
    (error) => error.code === "EVENT_OUTSIDE_RELEASE_WINDOW",
  );

  const afterRelease = completeEvidence();
  afterRelease.publicReceiptVerification.checkedAt =
    "2026-07-29T11:00:01Z";
  assert.throws(
    () => checkCredentialedContributionRelease(afterRelease),
    (error) => error.code === "EVENT_OUTSIDE_RELEASE_WINDOW",
  );
});

test("rejects credential-bearing keys and values before validation", () => {
  const privateKey = completeEvidence();
  privateKey.researcher.privateKey = "redaction failed";
  assert.throws(
    () => checkCredentialedContributionRelease(privateKey),
    (error) => error.code === "CREDENTIAL_MATERIAL_FORBIDDEN"
      && error.path === "$.researcher.privateKey",
  );

  const bearer = completeEvidence();
  bearer.researcher.note =
    "Bearer abcdefghijklmnopqrstuvwxyz123456";
  assert.throws(
    () => checkCredentialedContributionRelease(bearer),
    (error) => error.code === "CREDENTIAL_MATERIAL_FORBIDDEN",
  );
});

test("loads either a regular evidence file or bounded environment JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "proofweave-evidence-"));
  const path = join(directory, "evidence.json");
  const serialized = JSON.stringify(completeEvidence());
  await writeFile(path, serialized, { mode: 0o600 });

  assert.deepEqual(
    await loadCredentialedContributionEvidence({
      filePath: path,
      environment: {},
    }),
    completeEvidence(),
  );
  assert.deepEqual(
    await loadCredentialedContributionEvidence({
      environment: {
        PROOFWEAVE_CREDENTIALED_RELEASE_EVIDENCE_JSON: serialized,
      },
    }),
    completeEvidence(),
  );
  await assert.rejects(
    loadCredentialedContributionEvidence({
      filePath: path,
      environment: {
        PROOFWEAVE_CREDENTIALED_RELEASE_EVIDENCE_JSON: serialized,
      },
    }),
    (error) => error.code === "EVIDENCE_SOURCE_AMBIGUOUS",
  );

  const link = join(directory, "evidence-link.json");
  await symlink(path, link);
  await assert.rejects(
    loadCredentialedContributionEvidence({
      filePath: link,
      environment: {},
    }),
    (error) => error.code === "EVIDENCE_FILE_UNSAFE",
  );
});
