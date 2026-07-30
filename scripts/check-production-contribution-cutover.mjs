#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const cutoverEvidenceSchemaVersion =
  "pw-production-contribution-cutover-evidence-v3";
const legacyCutoverEvidenceSchemaVersion =
  "pw-production-contribution-cutover-evidence-v2";
const governanceModes = new Set(["independent_observer", "solo_alpha"]);
const releaseTiers = new Set(["public_alpha", "stable"]);

const migration0043 = "0043_add_runner_queue_event_sequence.sql";
const migration0042 = "0042_add_jacobian_counterexample_audit.sql";
const revisionPattern = /^[a-f0-9]{40}$/;
const fingerprintPattern = /^[a-f0-9]{16}$/;
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const countKeys = Object.freeze([
  "runs",
  "queueMessages",
  "queueEvents",
  "activeLeases",
]);
const forbiddenKeyPattern =
  /(?:^|_)(?:access_?token|api_?key|authorization|bearer|credential|password|private_?key|secret)(?:$|_)/i;

export class ProductionContributionCutoverEvidenceError extends Error {
  constructor(issues) {
    super(`Production contribution cutover evidence failed closed (${issues.length} issue${issues.length === 1 ? "" : "s"}).`);
    this.name = "ProductionContributionCutoverEvidenceError";
    this.code = "PRODUCTION_CONTRIBUTION_CUTOVER_EVIDENCE_INVALID";
    this.issues = Object.freeze(issues.map((issue) => Object.freeze(issue)));
  }
}

/**
 * Verify a captured, non-secret cutover evidence document without contacting
 * any provider or mutating any environment.
 *
 * A passing result means only that the supplied evidence is internally
 * complete and consistent enough to proceed to the separately controlled
 * production steps. It never authorizes or performs migration, deployment,
 * Runner execution, or public unfreeze.
 */
export function verifyProductionContributionCutover(evidence) {
  const issues = [];
  const add = (code, path, message) => issues.push({ code, path, message });

  if (!isRecord(evidence)) {
    throw new ProductionContributionCutoverEvidenceError([{
      code: "EVIDENCE_NOT_OBJECT",
      path: "$",
      message: "Evidence must be a JSON object.",
    }]);
  }

  inspectForbiddenKeys(evidence, "$", add);
  const legacyEvidence =
    evidence.schemaVersion === legacyCutoverEvidenceSchemaVersion;
  if (
    evidence.schemaVersion !== cutoverEvidenceSchemaVersion
    && !legacyEvidence
  ) {
    add(
      "SCHEMA_VERSION_INVALID",
      "schemaVersion",
      `schemaVersion must equal ${JSON.stringify(cutoverEvidenceSchemaVersion)} or the legacy ${JSON.stringify(legacyCutoverEvidenceSchemaVersion)}.`,
    );
  }
  const governanceMode = legacyEvidence
    ? "independent_observer"
    : verifyGovernance(evidence.governance, add);
  requireTimestamp(evidence.recordedAt, "recordedAt", add);

  verifyPitrClone(evidence.pitrClone, add);
  verifyMigrationAuthorization(evidence.migration, add);
  verifyTimeline(evidence, add);
  verifyRelease(evidence.release, add);
  verifyControlPlane(evidence.controlPlane, evidence.release, add);
  if (
    isRecord(evidence.pitrClone)
    && isRecord(evidence.controlPlane)
    && evidence.pitrClone.sourceDatabaseFingerprint
      !== evidence.controlPlane.databaseFingerprint
  ) {
    add(
      "PITR_SOURCE_AUTHORITY_DRIFT",
      "pitrClone.sourceDatabaseFingerprint",
      "PITR clone evidence is not bound to the recorded production control-plane fingerprint.",
    );
  }
  verifyOwnersAndRollback(
    evidence.owners,
    evidence.rollback,
    evidence,
    governanceMode,
    add,
  );

  if (issues.length > 0) {
    throw new ProductionContributionCutoverEvidenceError(issues);
  }

  return Object.freeze({
    schemaVersion: "pw-production-contribution-cutover-verdict-v3",
    outcome: "passed",
    decision: "pre_migration_authorization_evidence_ready",
    governanceMode,
    releaseTier: legacyEvidence
      ? "legacy_unspecified"
      : evidence.governance.releaseTier,
    releaseSha: evidence.release.commitSha,
    migrationHead: evidence.migration.currentProductionHead,
    plannedMigration: evidence.migration.plannedMigration,
    targetMode: evidence.controlPlane.targetMode,
    currentSafetyMode: "read_only",
    authority: evidence.controlPlane.authority,
    databaseFingerprint: evidence.controlPlane.databaseFingerprint,
    rollbackOwner: evidence.rollback.ownerPersonId,
    checkedBoundaries: Object.freeze([
      "PITR clone rehearsal identity",
      "0043 migration plan and pre-migration boundary",
      "stable pre-migration queue and Run counts",
      "Sites, MCP, and Runner release SHA identity",
      "single Turso control-plane authority",
      "read-only producer and frozen consumer boundary",
      "named release and rollback ownership",
      governanceMode === "solo_alpha"
        ? "solo-alpha operator acceptance without independent-review credit"
        : "distinct independent-observer acceptance",
    ]),
    nextManualGate: Object.freeze([
      "apply 0043 to production while all writers remain frozen",
      governanceMode === "solo_alpha"
        ? "capture and verify a separate post-migration evidence record under the same solo-alpha limitation"
        : "capture and independently verify a separate post-migration evidence record",
      "deploy Sites, MCP/gateway, and Runner from the recorded SHA",
      "run the controlled persisted Runner smoke",
      "restore read_write only after explicit release sign-off",
    ]),
    limitations:
      governanceMode === "solo_alpha"
        ? "Offline evidence consistency only. Solo-alpha operational acceptance is not independent mathematical review and cannot satisfy certified Receipt review gates; no provider, database, deployment, Runner, or public write path was contacted."
        : "Offline evidence consistency only; no provider, database, deployment, Runner, or public write path was contacted.",
  });
}

function verifyGovernance(governance, add) {
  if (!requireRecord(governance, "governance", add)) return null;
  if (!governanceModes.has(governance.mode)) {
    add(
      "CUTOVER_GOVERNANCE_MODE_INVALID",
      "governance.mode",
      "Cutover governance must be independent_observer or solo_alpha.",
    );
  }
  if (!releaseTiers.has(governance.releaseTier)) {
    add(
      "CUTOVER_RELEASE_TIER_INVALID",
      "governance.releaseTier",
      "Cutover release tier must be public_alpha or stable.",
    );
  }
  if (
    governance.mode === "solo_alpha"
    && governance.releaseTier !== "public_alpha"
  ) {
    add(
      "SOLO_ALPHA_RELEASE_TIER_INVALID",
      "governance.releaseTier",
      "Solo-alpha governance is restricted to public_alpha infrastructure cutovers.",
    );
  }
  requireEqual(
    governance.certifiedReceiptsRequireDifferentPersonReview,
    true,
    "INDEPENDENT_RECEIPT_BOUNDARY_NOT_ACKNOWLEDGED",
    "governance.certifiedReceiptsRequireDifferentPersonReview",
    add,
  );
  requireEqual(
    governance.soloOperatorDoesNotSatisfyIndependentReview,
    true,
    "SOLO_REVIEW_LIMITATION_NOT_ACKNOWLEDGED",
    "governance.soloOperatorDoesNotSatisfyIndependentReview",
    add,
  );
  return governanceModes.has(governance.mode) ? governance.mode : null;
}

function verifyPitrClone(clone, add) {
  if (!requireRecord(clone, "pitrClone", add)) return;
  requireNonEmpty(clone.name, "PITR_CLONE_NAME_MISSING", "pitrClone.name", add);
  requireNonEmpty(
    clone.snapshotId,
    "PITR_SNAPSHOT_ID_MISSING",
    "pitrClone.snapshotId",
    add,
  );
  requireTimestamp(clone.pitrTimestamp, "pitrClone.pitrTimestamp", add);
  requireTimestamp(clone.completedAt, "pitrClone.completedAt", add);
  requireFingerprint(
    clone.sourceDatabaseFingerprint,
    "pitrClone.sourceDatabaseFingerprint",
    add,
  );
  requireEqual(
    clone.preMigrationHead,
    migration0042,
    "PITR_CLONE_PRE_HEAD_INVALID",
    "pitrClone.preMigrationHead",
    add,
  );
  requireEqual(
    clone.postMigrationHead,
    migration0043,
    "PITR_CLONE_NOT_MIGRATED",
    "pitrClone.postMigrationHead",
    add,
  );
  requireEqual(
    clone.outcome,
    "passed",
    "PITR_CLONE_REHEARSAL_NOT_PASSED",
    "pitrClone.outcome",
    add,
  );
  verifyEventSequenceSchema(clone.eventSequenceSchema, "pitrClone.eventSequenceSchema", add);
  verifyStableCounts(
    clone.preMigrationCounts,
    clone.postMigrationCounts,
    "pitrClone",
    add,
  );
  verifyEventCountProjection(
    clone.eventSequenceSchema,
    clone.postMigrationCounts,
    "pitrClone",
    add,
  );
}

function verifyMigrationAuthorization(migration, add) {
  if (!requireRecord(migration, "migration", add)) return;
  requireEqual(
    migration.phase,
    "pre_migration_authorization",
    "CUTOVER_PHASE_INVALID",
    "migration.phase",
    add,
  );
  requireEqual(
    migration.currentProductionHead,
    migration0042,
    "PRODUCTION_CURRENT_HEAD_INVALID",
    "migration.currentProductionHead",
    add,
  );
  requireEqual(
    migration.plannedMigration,
    migration0043,
    "PRODUCTION_MIGRATION_PLAN_INVALID",
    "migration.plannedMigration",
    add,
  );
  requireTimestamp(
    migration.firstObservedAt,
    "migration.firstObservedAt",
    add,
  );
  requireTimestamp(
    migration.secondObservedAt,
    "migration.secondObservedAt",
    add,
  );
  requireEqual(
    migration.eventSequenceColumnExists,
    false,
    "PRODUCTION_ALREADY_MIGRATED_OR_DRIFTED",
    "migration.eventSequenceColumnExists",
    add,
  );
  verifyStableCounts(
    migration.firstFrozenCounts,
    migration.secondFrozenCounts,
    "migration",
    add,
  );
}

function verifyEventSequenceSchema(schema, path, add) {
  if (!requireRecord(schema, path, add)) return;
  requireEqual(
    schema.columnExists,
    true,
    "EVENT_SEQUENCE_COLUMN_MISSING",
    `${path}.columnExists`,
    add,
  );
  requireEqual(
    schema.columnNullable,
    true,
    "EVENT_SEQUENCE_LEGACY_NULLABILITY_MISMATCH",
    `${path}.columnNullable`,
    add,
  );
  requireEqual(
    schema.uniqueRunSequenceIndexExists,
    true,
    "EVENT_SEQUENCE_UNIQUE_INDEX_MISSING",
    `${path}.uniqueRunSequenceIndexExists`,
    add,
  );
  requireEqual(
    schema.requiredInsertTriggerExists,
    true,
    "EVENT_SEQUENCE_TRIGGER_MISSING",
    `${path}.requiredInsertTriggerExists`,
    add,
  );
  requireZeroCount(
    schema.invalidSequenceCount,
    "EVENT_SEQUENCE_INVALID_VALUES",
    `${path}.invalidSequenceCount`,
    add,
  );
  requireZeroCount(
    schema.duplicateRunSequenceCount,
    "EVENT_SEQUENCE_DUPLICATES",
    `${path}.duplicateRunSequenceCount`,
    add,
  );
  requireCount(schema.legacyNullSequenceCount, `${path}.legacyNullSequenceCount`, add);
  requireCount(schema.sequencedEventCount, `${path}.sequencedEventCount`, add);
}

function verifyStableCounts(before, after, prefix, add) {
  const beforePath = prefix === "migration"
    ? `${prefix}.firstFrozenCounts`
    : `${prefix}.preMigrationCounts`;
  const afterPath = prefix === "migration"
    ? `${prefix}.secondFrozenCounts`
    : `${prefix}.postMigrationCounts`;
  const beforeValid = verifyCounts(before, beforePath, add);
  const afterValid = verifyCounts(after, afterPath, add);
  if (!beforeValid || !afterValid) return;
  for (const key of countKeys) {
    if (before[key] !== after[key]) {
      add(
        "MIGRATION_COUNTS_CHANGED",
        `${afterPath}.${key}`,
        `${key} changed from ${before[key]} to ${after[key]} during the schema migration.`,
      );
    }
  }
  if (before.activeLeases !== 0 || after.activeLeases !== 0) {
    add(
      "ACTIVE_LEASES_NOT_DRAINED",
      `${beforePath}.activeLeases`,
      "Active Runner leases must be zero throughout the migration window.",
    );
  }
}

function verifyCounts(value, path, add) {
  if (!requireRecord(value, path, add)) return false;
  let valid = true;
  for (const key of countKeys) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) {
      add(
        "STABLE_COUNT_INVALID",
        `${path}.${key}`,
        `${key} must be a non-negative safe integer.`,
      );
      valid = false;
    }
  }
  return valid;
}

function verifyEventCountProjection(schema, counts, prefix, add) {
  if (!isRecord(schema) || !isRecord(counts)) return;
  if (
    Number.isSafeInteger(schema.legacyNullSequenceCount)
    && Number.isSafeInteger(schema.sequencedEventCount)
    && Number.isSafeInteger(counts.queueEvents)
    && schema.legacyNullSequenceCount + schema.sequencedEventCount
      !== counts.queueEvents
  ) {
    add(
      "EVENT_SEQUENCE_COUNT_MISMATCH",
      `${prefix}.eventSequenceSchema`,
      "Legacy NULL and sequenced event counts must sum to the stable queue-event total.",
    );
  }
}

function verifyRelease(release, add) {
  if (!requireRecord(release, "release", add)) return;
  requireRevision(release.commitSha, "release.commitSha", add);
  for (const surface of ["website", "mcp", "runner"]) {
    const value = release[surface];
    if (!requireRecord(value, `release.${surface}`, add)) continue;
    requireRevision(value.commitSha, `release.${surface}.commitSha`, add);
    if (
      revisionPattern.test(release.commitSha ?? "")
      && revisionPattern.test(value.commitSha ?? "")
      && value.commitSha !== release.commitSha
    ) {
      add(
        "RELEASE_SHA_DRIFT",
        `release.${surface}.commitSha`,
        `${surface} reports ${value.commitSha}; expected ${release.commitSha}.`,
      );
    }
  }
}

function verifyControlPlane(controlPlane, release, add) {
  if (!requireRecord(controlPlane, "controlPlane", add)) return;
  requireEqual(
    controlPlane.authority,
    "turso",
    "CONTROL_PLANE_AUTHORITY_NOT_TURSO",
    "controlPlane.authority",
    add,
  );
  requireFingerprint(
    controlPlane.databaseFingerprint,
    "controlPlane.databaseFingerprint",
    add,
  );
  requireEqual(
    controlPlane.targetMode,
    "read_write",
    "CUTOVER_TARGET_MODE_INVALID",
    "controlPlane.targetMode",
    add,
  );

  for (const surface of ["website", "mcp", "runner"]) {
    const observed = controlPlane[surface];
    if (!requireRecord(observed, `controlPlane.${surface}`, add)) continue;
    requireEqual(
      observed.authority,
      controlPlane.authority,
      "CONTROL_PLANE_AUTHORITY_DRIFT",
      `controlPlane.${surface}.authority`,
      add,
    );
    requireEqual(
      observed.databaseFingerprint,
      controlPlane.databaseFingerprint,
      "CONTROL_PLANE_FINGERPRINT_DRIFT",
      `controlPlane.${surface}.databaseFingerprint`,
      add,
    );
    if (release?.[surface]?.commitSha !== observed.commitSha) {
      add(
        "CONTROL_PLANE_RELEASE_SHA_DRIFT",
        `controlPlane.${surface}.commitSha`,
        `${surface} control-plane observation is not bound to its release SHA.`,
      );
    }
  }

  for (const surface of ["website", "mcp"]) {
    const observed = controlPlane[surface];
    if (!isRecord(observed)) continue;
    if (observed.mode !== "read_only" || observed.writesEnabled !== false) {
      add(
        "READ_WRITE_ENABLED_TOO_EARLY",
        `controlPlane.${surface}`,
        `${surface} must still report read_only with writesEnabled=false during offline cutover verification.`,
      );
    }
  }
  if (isRecord(controlPlane.runner) && controlPlane.runner.executionEnabled !== false) {
    add(
      "RUNNER_ENABLED_TOO_EARLY",
      "controlPlane.runner.executionEnabled",
      "Runner execution must remain frozen until controlled smoke authorization.",
    );
  }
}

function verifyOwnersAndRollback(
  owners,
  rollback,
  evidence,
  governanceMode,
  add,
) {
  if (requireRecord(owners, "owners", add)) {
    const operatorKeys = [
      "releaseCommander",
      "databaseOwner",
      "sitesMcpOwner",
      "runnerOwner",
      "incidentOwner",
    ];
    const operators = [];
    for (const key of operatorKeys) {
      const owner = verifyAccountableOwner(
        owners[key],
        `owners.${key}`,
        add,
      );
      if (owner) operators.push(owner);
    }
    if (governanceMode === "solo_alpha") {
      if (isRecord(owners.independentObserver)) {
        add(
          "SOLO_ALPHA_CANNOT_CLAIM_INDEPENDENT_OBSERVER",
          "owners.independentObserver",
          "Solo-alpha cutover evidence must not label the operator as an independent observer.",
        );
      }
      const acceptance = verifyAccountableOwner(
        owners.soloOperatorAcceptance,
        "owners.soloOperatorAcceptance",
        add,
        { requireAcknowledgedAcceptance: true },
      );
      requireEqual(
        owners.soloOperatorAcceptance?.scope,
        "infrastructure_cutover_only",
        "SOLO_ACCEPTANCE_SCOPE_INVALID",
        "owners.soloOperatorAcceptance.scope",
        add,
      );
      const commander = operators[0];
      if (
        acceptance
        && commander
        && (
          acceptance.personId !== commander.personId
          || acceptance.accountId !== commander.accountId
        )
      ) {
        add(
          "SOLO_OPERATOR_IDENTITY_MISMATCH",
          "owners.soloOperatorAcceptance.personId",
          "Solo-alpha acceptance must belong to the recorded release commander.",
        );
      }
      if (acceptance) {
        requireEqual(
          acceptance.acceptanceArtifactHash,
          productionCutoverAcceptanceArtifactHash(evidence),
          "SOLO_ACCEPTANCE_ARTIFACT_MISMATCH",
          "owners.soloOperatorAcceptance.acceptanceArtifactHash",
          add,
        );
      }
    } else {
      const observer = verifyAccountableOwner(
        owners.independentObserver,
        "owners.independentObserver",
        add,
        { requireSignedAcceptance: true },
      );
      if (observer) {
        requireEqual(
          observer.acceptanceArtifactHash,
          productionCutoverAcceptanceArtifactHash(evidence),
          "OBSERVER_ACCEPTANCE_ARTIFACT_MISMATCH",
          "owners.independentObserver.acceptanceArtifactHash",
          add,
        );
      }
      if (observer && operators.some((owner) =>
        owner.personId === observer.personId
        || owner.accountId === observer.accountId)) {
        add(
          "INDEPENDENT_OBSERVER_NOT_DISTINCT",
          "owners.independentObserver.personId",
          "The independent observer must be a different accountable Person with a distinct account, not another account or role controlled by an operator.",
        );
      }
    }
  }
  if (!requireRecord(rollback, "rollback", add)) return;
  requireNonEmpty(
    rollback.ownerPersonId,
    "ROLLBACK_OWNER_MISSING",
    "rollback.ownerPersonId",
    add,
  );
  requireEqual(
    rollback.strategy,
    "roll_forward",
    "ROLLBACK_STRATEGY_UNSAFE",
    "rollback.strategy",
    add,
  );
  requireEqual(
    rollback.acknowledged,
    true,
    "ROLLBACK_NOT_ACKNOWLEDGED",
    "rollback.acknowledged",
    add,
  );
  requireNonEmpty(
    rollback.pitrRestoreOwnerPersonId,
    "PITR_RESTORE_OWNER_MISSING",
    "rollback.pitrRestoreOwnerPersonId",
    add,
  );
}

export function productionCutoverAcceptanceArtifactHash(evidence) {
  const owners = isRecord(evidence?.owners) ? evidence.owners : {};
  const observer = isRecord(owners.independentObserver)
    ? owners.independentObserver
    : {};
  const soloAcceptance = isRecord(owners.soloOperatorAcceptance)
    ? owners.soloOperatorAcceptance
    : {};
  const ownersPayload = {
    releaseCommander: owners.releaseCommander,
    databaseOwner: owners.databaseOwner,
    sitesMcpOwner: owners.sitesMcpOwner,
    runnerOwner: owners.runnerOwner,
    incidentOwner: owners.incidentOwner,
    independentObserver: {
      personId: observer.personId,
      accountId: observer.accountId,
      acceptedAt: observer.acceptedAt,
    },
  };
  if (evidence?.schemaVersion === cutoverEvidenceSchemaVersion) {
    ownersPayload.soloOperatorAcceptance = {
      personId: soloAcceptance.personId,
      accountId: soloAcceptance.accountId,
      acceptedAt: soloAcceptance.acceptedAt,
      scope: soloAcceptance.scope,
    };
  }
  const payload = {
    schemaVersion: evidence?.schemaVersion,
    recordedAt: evidence?.recordedAt,
    pitrClone: evidence?.pitrClone,
    migration: evidence?.migration,
    release: evidence?.release,
    controlPlane: evidence?.controlPlane,
    owners: ownersPayload,
    rollback: evidence?.rollback,
  };
  if (evidence?.schemaVersion === cutoverEvidenceSchemaVersion) {
    payload.governance = evidence?.governance;
  }
  return `sha256:${createHash("sha256")
    .update(canonicalJson(payload))
    .digest("hex")}`;
}

function verifyAccountableOwner(
  value,
  path,
  add,
  {
    requireSignedAcceptance = false,
    requireAcknowledgedAcceptance = false,
  } = {},
) {
  if (!requireRecord(value, path, add)) return null;
  requireNonEmpty(
    value.personId,
    "CUTOVER_OWNER_PERSON_MISSING",
    `${path}.personId`,
    add,
  );
  requireNonEmpty(
    value.accountId,
    "CUTOVER_OWNER_ACCOUNT_MISSING",
    `${path}.accountId`,
    add,
  );
  requireTimestamp(value.acceptedAt, `${path}.acceptedAt`, add);
  if (requireSignedAcceptance) {
    if (!hashPattern.test(value.acceptanceArtifactHash ?? "")) {
      add(
        "OBSERVER_ACCEPTANCE_ARTIFACT_INVALID",
        `${path}.acceptanceArtifactHash`,
        "Independent observer acceptance must bind to a sha256 evidence artifact.",
      );
    }
    requireEqual(
      value.signatureValid,
      true,
      "OBSERVER_ACCEPTANCE_SIGNATURE_INVALID",
      `${path}.signatureValid`,
      add,
    );
  }
  if (requireAcknowledgedAcceptance) {
    if (!hashPattern.test(value.acceptanceArtifactHash ?? "")) {
      add(
        "SOLO_ACCEPTANCE_ARTIFACT_INVALID",
        `${path}.acceptanceArtifactHash`,
        "Solo-alpha operator acceptance must bind to a sha256 evidence artifact.",
      );
    }
    requireEqual(
      value.acknowledged,
      true,
      "SOLO_ACCEPTANCE_NOT_ACKNOWLEDGED",
      `${path}.acknowledged`,
      add,
    );
  }
  return value;
}

function verifyTimeline(evidence, add) {
  const recordedAt = parseTimestamp(evidence.recordedAt);
  const pitrTimestamp = parseTimestamp(evidence.pitrClone?.pitrTimestamp);
  const cloneCompletedAt = parseTimestamp(evidence.pitrClone?.completedAt);
  const firstObservedAt = parseTimestamp(
    evidence.migration?.firstObservedAt,
  );
  const secondObservedAt = parseTimestamp(
    evidence.migration?.secondObservedAt,
  );
  const acceptancePath = evidence.governance?.mode === "solo_alpha"
    ? "soloOperatorAcceptance"
    : "independentObserver";
  const acceptanceAcceptedAt = parseTimestamp(
    evidence.owners?.[acceptancePath]?.acceptedAt,
  );
  const operatorKeys = [
    "releaseCommander",
    "databaseOwner",
    "sitesMcpOwner",
    "runnerOwner",
    "incidentOwner",
  ];
  if (
    pitrTimestamp !== null
    && cloneCompletedAt !== null
    && pitrTimestamp > cloneCompletedAt
  ) {
    add(
      "PITR_TIMELINE_INVALID",
      "pitrClone.completedAt",
      "The PITR clone cannot complete before its requested recovery timestamp.",
    );
  }
  if (
    cloneCompletedAt !== null
    && firstObservedAt !== null
    && cloneCompletedAt > firstObservedAt
  ) {
    add(
      "CUTOVER_TIMELINE_INVALID",
      "migration.firstObservedAt",
      "Production freeze evidence must be captured after the PITR rehearsal completed.",
    );
  }
  if (
    firstObservedAt !== null
    && secondObservedAt !== null
    && firstObservedAt > secondObservedAt
  ) {
    add(
      "CUTOVER_TIMELINE_INVALID",
      "migration.secondObservedAt",
      "The second frozen count observation cannot precede the first.",
    );
  }
  if (
    secondObservedAt !== null
    && acceptanceAcceptedAt !== null
    && secondObservedAt > acceptanceAcceptedAt
  ) {
    add(
      "CUTOVER_TIMELINE_INVALID",
      `owners.${acceptancePath}.acceptedAt`,
      "Cutover acceptance must follow the completed pre-migration evidence capture.",
    );
  }
  for (const key of operatorKeys) {
    const operatorAcceptedAt = parseTimestamp(
      evidence.owners?.[key]?.acceptedAt,
    );
    if (
      operatorAcceptedAt !== null
      && acceptanceAcceptedAt !== null
      && operatorAcceptedAt > acceptanceAcceptedAt
    ) {
      add(
        "CUTOVER_TIMELINE_INVALID",
        `owners.${key}.acceptedAt`,
        `${key} must accept its responsibility before final cutover acceptance.`,
      );
    }
  }
  if (
    acceptanceAcceptedAt !== null
    && recordedAt !== null
    && acceptanceAcceptedAt > recordedAt
  ) {
    add(
      "CUTOVER_TIMELINE_INVALID",
      "recordedAt",
      "The evidence record cannot predate final cutover acceptance.",
    );
  }
}

function inspectForbiddenKeys(value, path, add) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectForbiddenKeys(item, `${path}[${index}]`, add));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenKeyPattern.test(key)) {
      add(
        "SECRET_MATERIAL_NOT_ALLOWED",
        `${path}.${key}`,
        "Cutover evidence must contain non-secret identifiers only.",
      );
    }
    inspectForbiddenKeys(nested, `${path}.${key}`, add);
  }
}

function requireRecord(value, path, add) {
  if (!isRecord(value)) {
    add("EVIDENCE_SECTION_MISSING", path, `${path} must be an object.`);
    return false;
  }
  return true;
}

function requireNonEmpty(value, code, path, add) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 240) {
    add(code, path, `${path} must be a non-empty, bounded string.`);
  }
}

function requireEqual(value, expected, code, path, add) {
  if (value !== expected) {
    add(code, path, `${path} must equal ${JSON.stringify(expected)}.`);
  }
}

function requireTimestamp(value, path, add) {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    || Number.isNaN(Date.parse(value))
  ) {
    add("TIMESTAMP_INVALID", path, `${path} must be a UTC ISO-8601 timestamp.`);
  }
}

function parseTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? Date.parse(value)
    : null;
}

function requireRevision(value, path, add) {
  if (!revisionPattern.test(value ?? "")) {
    add("RELEASE_SHA_INVALID", path, `${path} must be a lowercase 40-character Git SHA.`);
  }
}

function requireFingerprint(value, path, add) {
  if (!fingerprintPattern.test(value ?? "")) {
    add(
      "DATABASE_FINGERPRINT_INVALID",
      path,
      `${path} must be a lowercase 16-character non-secret fingerprint.`,
    );
  }
}

function requireCount(value, path, add) {
  if (!Number.isSafeInteger(value) || value < 0) {
    add("EVENT_SEQUENCE_COUNT_INVALID", path, `${path} must be a non-negative safe integer.`);
  }
}

function requireZeroCount(value, code, path, add) {
  requireCount(value, path, add);
  if (value !== 0) {
    add(code, path, `${path} must be zero.`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const evidencePath = process.argv[2];
  if (!evidencePath || process.argv.length !== 3) {
    process.stderr.write(
      "Usage: node scripts/check-production-contribution-cutover.mjs <evidence.json>\n",
    );
    process.exitCode = 2;
  } else {
    readFile(evidencePath, "utf8")
      .then((source) => JSON.parse(source))
      .then((evidence) => verifyProductionContributionCutover(evidence))
      .then((verdict) => {
        process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
      })
      .catch((error) => {
        process.stderr.write(`${JSON.stringify({
          schemaVersion: "pw-production-contribution-cutover-verdict-v3",
          outcome: "failed",
          errorCode:
            error instanceof ProductionContributionCutoverEvidenceError
              ? error.code
              : "PRODUCTION_CONTRIBUTION_CUTOVER_CHECK_FAILED",
          message: error instanceof Error ? error.message : "Cutover evidence check failed.",
          issues:
            error instanceof ProductionContributionCutoverEvidenceError
              ? error.issues
              : [],
        }, null, 2)}\n`);
        process.exitCode = 1;
      });
  }
}
