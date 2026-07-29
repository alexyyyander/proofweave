import assert from "node:assert/strict";
import test from "node:test";
import {
  productionCutoverAcceptanceArtifactHash,
  ProductionContributionCutoverEvidenceError,
  verifyProductionContributionCutover,
} from "../scripts/check-production-contribution-cutover.mjs";

const releaseSha = "a".repeat(40);
const databaseFingerprint = "3f9e7934a04a22ec";
const head0042 = "0042_add_jacobian_counterexample_audit.sql";
const head0043 = "0043_add_runner_queue_event_sequence.sql";

test("accepts complete frozen pre-migration evidence for a controlled 0043 cutover", () => {
  const verdict = verifyProductionContributionCutover(fixture());

  assert.equal(verdict.outcome, "passed");
  assert.equal(verdict.decision, "pre_migration_authorization_evidence_ready");
  assert.equal(verdict.releaseSha, releaseSha);
  assert.equal(verdict.migrationHead, head0042);
  assert.equal(verdict.plannedMigration, head0043);
  assert.equal(verdict.currentSafetyMode, "read_only");
  assert.equal(verdict.targetMode, "read_write");
  assert.equal(verdict.rollbackOwner, "person:alex");
  assert.match(verdict.limitations, /no provider, database, deployment, Runner/i);
});

test("fails closed when website, MCP, or Runner SHA drifts", () => {
  const evidence = fixture();
  evidence.release.runner.commitSha = "b".repeat(40);

  const error = captureFailure(evidence);
  assertIssue(error, "RELEASE_SHA_DRIFT", "release.runner.commitSha");
});

test("fails closed when the pre-migration head or planned migration drifts", () => {
  const evidence = fixture();
  evidence.migration.currentProductionHead = head0043;
  evidence.migration.plannedMigration = head0042;
  evidence.migration.eventSequenceColumnExists = true;

  const error = captureFailure(evidence);
  assertIssue(error, "PRODUCTION_CURRENT_HEAD_INVALID", "migration.currentProductionHead");
  assertIssue(error, "PRODUCTION_MIGRATION_PLAN_INVALID", "migration.plannedMigration");
  assertIssue(
    error,
    "PRODUCTION_ALREADY_MIGRATED_OR_DRIFTED",
    "migration.eventSequenceColumnExists",
  );
});

test("fails closed if public writes or Runner execution are enabled too early", () => {
  const evidence = fixture();
  evidence.controlPlane.website.mode = "read_write";
  evidence.controlPlane.website.writesEnabled = true;
  evidence.controlPlane.runner.executionEnabled = true;

  const error = captureFailure(evidence);
  assertIssue(error, "READ_WRITE_ENABLED_TOO_EARLY", "controlPlane.website");
  assertIssue(error, "RUNNER_ENABLED_TOO_EARLY", "controlPlane.runner.executionEnabled");
});

test("fails closed when a required owner or rollback acknowledgement is missing", () => {
  const evidence = fixture();
  delete evidence.owners.independentObserver;
  delete evidence.rollback.ownerPersonId;
  evidence.rollback.acknowledged = false;

  const error = captureFailure(evidence);
  assertIssue(error, "EVIDENCE_SECTION_MISSING", "owners.independentObserver");
  assertIssue(error, "ROLLBACK_OWNER_MISSING", "rollback.ownerPersonId");
  assertIssue(error, "ROLLBACK_NOT_ACKNOWLEDGED", "rollback.acknowledged");
});

test("rejects a second account controlled by the same Person as independent observer", () => {
  const samePerson = fixture();
  samePerson.owners.independentObserver.personId = "person:alex";
  samePerson.owners.independentObserver.accountId = "github:alex-secondary";
  const observerError = captureFailure(samePerson);
  assertIssue(
    observerError,
    "INDEPENDENT_OBSERVER_NOT_DISTINCT",
    "owners.independentObserver.personId",
  );

  const sameAccount = fixture();
  sameAccount.owners.independentObserver.accountId = "github:alex";
  const accountError = captureFailure(sameAccount);
  assertIssue(
    accountError,
    "INDEPENDENT_OBSERVER_NOT_DISTINCT",
    "owners.independentObserver.personId",
  );
});

test("requires signed observer acceptance after the frozen evidence capture", () => {
  const unsigned = fixture();
  unsigned.owners.independentObserver.signatureValid = false;
  const unsignedError = captureFailure(unsigned);
  assertIssue(
    unsignedError,
    "OBSERVER_ACCEPTANCE_SIGNATURE_INVALID",
    "owners.independentObserver.signatureValid",
  );

  const earlyObserver = fixture();
  earlyObserver.owners.independentObserver.acceptedAt =
    "2026-07-29T04:20:30Z";
  const timelineError = captureFailure(earlyObserver);
  assertIssue(
    timelineError,
    "CUTOVER_TIMELINE_INVALID",
    "owners.independentObserver.acceptedAt",
  );

  const wrongArtifact = fixture();
  wrongArtifact.owners.independentObserver.acceptanceArtifactHash =
    `sha256:${"c".repeat(64)}`;
  const artifactError = captureFailure(wrongArtifact);
  assertIssue(
    artifactError,
    "OBSERVER_ACCEPTANCE_ARTIFACT_MISMATCH",
    "owners.independentObserver.acceptanceArtifactHash",
  );
});

test("keeps pre-migration observations chronological", () => {
  const futureObservation = fixture();
  futureObservation.migration.secondObservedAt = "2026-07-29T06:00:00Z";
  futureObservation.owners.independentObserver.acceptedAt =
    "2026-07-29T06:05:00Z";
  const timelineError = captureFailure(futureObservation);
  assertIssue(timelineError, "CUTOVER_TIMELINE_INVALID", "recordedAt");

  const lateOperator = fixture();
  lateOperator.owners.runnerOwner.acceptedAt = "2026-07-29T04:46:00Z";
  lateOperator.owners.independentObserver.acceptanceArtifactHash =
    productionCutoverAcceptanceArtifactHash(lateOperator);
  const operatorError = captureFailure(lateOperator);
  assertIssue(
    operatorError,
    "CUTOVER_TIMELINE_INVALID",
    "owners.runnerOwner.acceptedAt",
  );
});

function fixture() {
  const counts = {
    runs: 29,
    queueMessages: 29,
    queueEvents: 508,
    activeLeases: 0,
  };
  const eventSequenceSchema = {
    columnExists: true,
    columnNullable: true,
    uniqueRunSequenceIndexExists: true,
    requiredInsertTriggerExists: true,
    invalidSequenceCount: 0,
    duplicateRunSequenceCount: 0,
    legacyNullSequenceCount: 508,
    sequencedEventCount: 0,
  };
  const surface = {
    commitSha: releaseSha,
    authority: "turso",
    databaseFingerprint,
  };

  const evidence = {
    schemaVersion: "pw-production-contribution-cutover-evidence-v2",
    recordedAt: "2026-07-29T05:00:00Z",
    pitrClone: {
      name: "proofweave-pre-0043-20260729t005627z",
      snapshotId: "pitr-20260729t005627z",
      pitrTimestamp: "2026-07-29T00:56:27Z",
      completedAt: "2026-07-29T03:06:43Z",
      sourceDatabaseFingerprint: databaseFingerprint,
      preMigrationHead: head0042,
      postMigrationHead: head0043,
      outcome: "passed",
      eventSequenceSchema: { ...eventSequenceSchema },
      preMigrationCounts: { ...counts },
      postMigrationCounts: { ...counts },
    },
    migration: {
      phase: "pre_migration_authorization",
      currentProductionHead: head0042,
      plannedMigration: head0043,
      firstObservedAt: "2026-07-29T04:20:00Z",
      secondObservedAt: "2026-07-29T04:21:00Z",
      eventSequenceColumnExists: false,
      firstFrozenCounts: { ...counts },
      secondFrozenCounts: { ...counts },
    },
    release: {
      commitSha: releaseSha,
      website: { commitSha: releaseSha },
      mcp: { commitSha: releaseSha },
      runner: { commitSha: releaseSha },
    },
    controlPlane: {
      authority: "turso",
      databaseFingerprint,
      targetMode: "read_write",
      website: {
        ...surface,
        mode: "read_only",
        writesEnabled: false,
      },
      mcp: {
        ...surface,
        mode: "read_only",
        writesEnabled: false,
      },
      runner: {
        ...surface,
        executionEnabled: false,
      },
    },
    owners: {
      releaseCommander: owner("person:alex", "github:alex"),
      databaseOwner: owner("person:alex", "github:alex"),
      sitesMcpOwner: owner("person:alex", "github:alex"),
      runnerOwner: owner("person:alex", "github:alex"),
      incidentOwner: owner("person:alex", "github:alex"),
      independentObserver: {
        ...owner("person:observer", "github:observer", "2026-07-29T04:45:00Z"),
        acceptanceArtifactHash: "",
        signatureValid: true,
      },
    },
    rollback: {
      ownerPersonId: "person:alex",
      strategy: "roll_forward",
      acknowledged: true,
      pitrRestoreOwnerPersonId: "person:alex",
    },
  };
  evidence.owners.independentObserver.acceptanceArtifactHash =
    productionCutoverAcceptanceArtifactHash(evidence);
  return evidence;
}

function owner(
  personId,
  accountId,
  acceptedAt = "2026-07-29T04:40:00Z",
) {
  return { personId, accountId, acceptedAt };
}

function captureFailure(evidence) {
  try {
    verifyProductionContributionCutover(evidence);
  } catch (error) {
    assert.ok(error instanceof ProductionContributionCutoverEvidenceError);
    return error;
  }
  assert.fail("Expected cutover evidence to fail closed.");
}

function assertIssue(error, code, path) {
  assert.ok(
    error.issues.some((issue) => issue.code === code && issue.path === path),
    `Expected ${code} at ${path}; received ${JSON.stringify(error.issues)}`,
  );
}
