#!/usr/bin/env node

import { lstat, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const credentialedReleaseEvidenceSchemaVersion =
  "pw-credentialed-contribution-release-evidence-v1";

const ENVIRONMENT_KEY =
  "PROOFWEAVE_CREDENTIALED_RELEASE_EVIDENCE_JSON";
const MAX_EVIDENCE_BYTES = 512 * 1024;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REVISION_PATTERN = /^[a-f0-9]{40,64}$/;
const DATABASE_FINGERPRINT_PATTERN = /^[a-f0-9]{16}$/;
const MIGRATION_PATTERN = /^\d{4}_[A-Za-z0-9._-]+\.sql$/;
const REQUIRED_CLAIMS = Object.freeze([
  "bundle_reproducible",
  "kernel_accepted",
  "project_accepted",
]);
const PASSING_RUN_CHECKS = Object.freeze([
  "network",
  "noSorry",
  "allowedAxioms",
  "leanBuild",
]);
const FORBIDDEN_KEY_FRAGMENTS = Object.freeze([
  "authorization",
  "authtoken",
  "accesstoken",
  "refreshtoken",
  "bearertoken",
  "clientsecret",
  "privatekey",
  "password",
  "cookie",
]);
const FORBIDDEN_VALUE_PATTERNS = Object.freeze([
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /\b(?:gho|ghp|ghs|github_pat)_[A-Za-z0-9_]{12,}\b/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
]);

export class CredentialedReleaseEvidenceError extends Error {
  constructor(code, path, message) {
    super(`${path}: ${message}`);
    this.name = "CredentialedReleaseEvidenceError";
    this.code = code;
    this.path = path;
  }
}

/**
 * Offline consistency gate for an already-completed credentialed smoke run.
 *
 * The caller must collect this privacy-minimal evidence after real Person A and
 * Person B operations. This function performs no network request, opens no
 * database, reads no credential, creates no record, and does not re-run Lean.
 */
export function checkCredentialedContributionRelease(evidence) {
  rejectCredentialMaterial(evidence);
  const root = object(evidence, "$");
  equal(
    string(root.schemaVersion, "$.schemaVersion"),
    credentialedReleaseEvidenceSchemaVersion,
    "$.schemaVersion",
    "SCHEMA_VERSION_UNSUPPORTED",
  );

  const release = object(root.release, "$.release");
  const expectedGitSha = revision(
    release.expectedGitSha,
    "$.release.expectedGitSha",
  );
  const before = releaseObservation(
    release.before,
    "$.release.before",
    expectedGitSha,
  );
  const after = releaseObservation(
    release.after,
    "$.release.after",
    expectedGitSha,
  );
  requireSameRelease(before, after);
  requireAtOrBefore(
    before.observedAt,
    after.observedAt,
    "$.release",
    "RELEASE_WINDOW_INVALID",
  );

  const researcher = researcherEvidence(root.researcher);
  const attempt = attemptEvidence(root.attempt);
  equal(
    attempt.personId,
    researcher.personId,
    "$.attempt.personId",
    "ATTEMPT_PERSON_MISMATCH",
  );
  equal(
    attempt.agentId,
    researcher.agentId,
    "$.attempt.agentId",
    "ATTEMPT_AGENT_MISMATCH",
  );
  equal(
    attempt.delegationCertificateId,
    researcher.delegationCertificateId,
    "$.attempt.delegationCertificateId",
    "ATTEMPT_DELEGATION_MISMATCH",
  );

  const bundle = bundleEvidence(root.bundle);
  equal(
    bundle.attemptId,
    attempt.id,
    "$.bundle.attemptId",
    "BUNDLE_ATTEMPT_MISMATCH",
  );
  equal(
    bundle.problemRevisionId,
    attempt.problemRevisionId,
    "$.bundle.problemRevisionId",
    "BUNDLE_PROBLEM_REVISION_MISMATCH",
  );
  equal(
    bundle.agentId,
    researcher.agentId,
    "$.bundle.agentId",
    "BUNDLE_AGENT_MISMATCH",
  );
  equal(
    bundle.delegationCertificateId,
    researcher.delegationCertificateId,
    "$.bundle.delegationCertificateId",
    "BUNDLE_DELEGATION_MISMATCH",
  );

  const runner = runnerEvidence(root.runner);
  equal(
    runner.attemptId,
    attempt.id,
    "$.runner.attemptId",
    "RUN_ATTEMPT_MISMATCH",
  );
  equal(
    runner.artifactBundleHash,
    bundle.manifestHash,
    "$.runner.artifactBundleHash",
    "RUN_BUNDLE_MISMATCH",
  );

  const reviews = array(root.reviews, "$.reviews").map((value, index) =>
    reviewEvidence(value, `$.reviews[${index}]`, {
      attempt,
      bundle,
      researcher,
      runner,
    }));
  const reviewsByClaim = uniqueReviewsByClaim(reviews);

  const receipt = receiptEvidence(root.receipt);
  bindReceipt({
    receipt,
    researcher,
    attempt,
    bundle,
    runner,
    reviewsByClaim,
  });

  const publicVerification = publicReceiptVerification(
    root.publicReceiptVerification,
  );
  equal(
    publicVerification.receiptId,
    receipt.id,
    "$.publicReceiptVerification.receiptId",
    "PUBLIC_RECEIPT_ID_MISMATCH",
  );
  equal(
    publicVerification.receiptHash,
    receipt.receiptHash,
    "$.publicReceiptVerification.receiptHash",
    "PUBLIC_RECEIPT_HASH_MISMATCH",
  );

  requireChronology({
    before: before.observedAt,
    attempt: attempt.createdAt,
    bundle: bundle.stagedAt,
    runner: runner.finishedAt,
    reviews,
    receipt: receipt.issuedAt,
    publicVerification: publicVerification.checkedAt,
    after: after.observedAt,
  });

  return {
    schemaVersion: "pw-credentialed-contribution-release-check-v1",
    outcome: "passed",
    executionMode: "offline_dry_run",
    release: {
      gitSha: expectedGitSha,
      controlPlaneMode: "read_write",
      writesEnabled: true,
      sameSitesGatewayRunnerRevision: true,
      sameDatabaseBeforeAndAfter: true,
    },
    contribution: {
      attemptId: attempt.id,
      artifactBundleHash: bundle.manifestHash,
      primaryRunId: runner.runId,
      primaryRunnerAccepted: true,
      independentReviewerPersonCount:
        new Set(reviews.map((review) => review.reviewerPersonId)).size,
      claims: REQUIRED_CLAIMS,
      receiptId: receipt.id,
      receiptHash: receipt.receiptHash,
      publicReceiptReverified: true,
    },
    boundary: {
      networkRequestsMade: false,
      credentialsRead: false,
      externalRecordsCreated: false,
      leanExecuted: false,
      signaturesCryptographicallyReverified: false,
      actualOperationsStillRequired: true,
      statement:
        "This gate checks a redacted evidence graph from a real smoke run. It does not perform or replace sign-in, Agent delegation, Bundle staging, Lean execution, independent review, Receipt issuance, or cryptographic verification.",
    },
  };
}

export async function loadCredentialedContributionEvidence({
  filePath,
  environment = process.env,
} = {}) {
  const inline = environment[ENVIRONMENT_KEY];
  if (filePath && inline) {
    fail(
      "EVIDENCE_SOURCE_AMBIGUOUS",
      "$",
      `Use either --evidence-file or ${ENVIRONMENT_KEY}, not both.`,
    );
  }
  if (!filePath && !inline) {
    fail(
      "EVIDENCE_SOURCE_MISSING",
      "$",
      `Provide --evidence-file or ${ENVIRONMENT_KEY}.`,
    );
  }

  let serialized;
  if (filePath) {
    const status = await lstat(filePath);
    if (!status.isFile() || status.isSymbolicLink()) {
      fail(
        "EVIDENCE_FILE_UNSAFE",
        "$",
        "Evidence input must be one regular, non-symlink file.",
      );
    }
    if (status.size > MAX_EVIDENCE_BYTES) {
      fail(
        "EVIDENCE_FILE_TOO_LARGE",
        "$",
        `Evidence input exceeds ${MAX_EVIDENCE_BYTES} bytes.`,
      );
    }
    serialized = await readFile(filePath, "utf8");
  } else {
    serialized = inline;
  }

  if (Buffer.byteLength(serialized, "utf8") > MAX_EVIDENCE_BYTES) {
    fail(
      "EVIDENCE_FILE_TOO_LARGE",
      "$",
      `Evidence input exceeds ${MAX_EVIDENCE_BYTES} bytes.`,
    );
  }
  try {
    return JSON.parse(serialized);
  } catch {
    fail("EVIDENCE_JSON_INVALID", "$", "Evidence input is not valid JSON.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseCliArguments(process.argv.slice(2));
    const evidence = await loadCredentialedContributionEvidence(options);
    const result = checkCredentialedContributionRelease(evidence);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const known = error instanceof CredentialedReleaseEvidenceError;
    process.stderr.write(`${JSON.stringify({
      schemaVersion: "pw-credentialed-contribution-release-check-v1",
      outcome: "failed",
      executionMode: "offline_dry_run",
      errorCode: known ? error.code : "CREDENTIALED_RELEASE_CHECK_FAILED",
      path: known ? error.path : "$",
      message: error instanceof Error
        ? error.message
        : "Credentialed contribution release check failed.",
      boundary:
        "No network request, credential read, external write, Lean execution, review, or Receipt issuance was attempted.",
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

function parseCliArguments(args) {
  if (args.length === 0) return {};
  if (args.length !== 2 || args[0] !== "--evidence-file" || !args[1]) {
    fail(
      "CLI_ARGUMENT_INVALID",
      "$",
      "Usage: node scripts/check-credentialed-contribution-release.mjs --evidence-file /path/to/redacted-evidence.json",
    );
  }
  return { filePath: args[1] };
}

function releaseObservation(value, path, expectedGitSha) {
  const observation = object(value, path);
  const result = {
    observedAt: instant(observation.observedAt, `${path}.observedAt`),
    controlPlaneMode: enumValue(
      observation.controlPlaneMode,
      ["read_write"],
      `${path}.controlPlaneMode`,
    ),
    writesEnabled: trueValue(
      observation.writesEnabled,
      `${path}.writesEnabled`,
    ),
    sitesCommitSha: revision(
      observation.sitesCommitSha,
      `${path}.sitesCommitSha`,
    ),
    gatewayRevision: revision(
      observation.gatewayRevision,
      `${path}.gatewayRevision`,
    ),
    runnerRevision: revision(
      observation.runnerRevision,
      `${path}.runnerRevision`,
    ),
    databaseAuthority: enumValue(
      observation.databaseAuthority,
      ["turso"],
      `${path}.databaseAuthority`,
    ),
    databaseFingerprint: pattern(
      observation.databaseFingerprint,
      DATABASE_FINGERPRINT_PATTERN,
      `${path}.databaseFingerprint`,
      "DATABASE_FINGERPRINT_INVALID",
    ),
    migrationHead: pattern(
      observation.migrationHead,
      MIGRATION_PATTERN,
      `${path}.migrationHead`,
      "MIGRATION_HEAD_INVALID",
    ),
  };
  for (const [name, actual] of [
    ["sitesCommitSha", result.sitesCommitSha],
    ["gatewayRevision", result.gatewayRevision],
    ["runnerRevision", result.runnerRevision],
  ]) {
    equal(
      actual,
      expectedGitSha,
      `${path}.${name}`,
      "RELEASE_REVISION_MISMATCH",
    );
  }
  return result;
}

function requireSameRelease(before, after) {
  for (const key of [
    "controlPlaneMode",
    "writesEnabled",
    "sitesCommitSha",
    "gatewayRevision",
    "runnerRevision",
    "databaseAuthority",
    "databaseFingerprint",
    "migrationHead",
  ]) {
    equal(
      after[key],
      before[key],
      `$.release.after.${key}`,
      "RELEASE_OBSERVATION_DRIFT",
    );
  }
}

function researcherEvidence(value) {
  const path = "$.researcher";
  const researcher = object(value, path);
  const scopes = array(
    researcher.delegationScopes,
    `${path}.delegationScopes`,
  ).map((scope, index) =>
    string(scope, `${path}.delegationScopes[${index}]`));
  if (!scopes.includes("formalize") && !scopes.includes("prove")) {
    fail(
      "RESEARCH_DELEGATION_SCOPE_MISSING",
      `${path}.delegationScopes`,
      "Research Agent delegation must include formalize or prove.",
    );
  }
  const personId = opaqueId(researcher.personId, `${path}.personId`);
  return {
    personId,
    agentId: opaqueId(researcher.agentId, `${path}.agentId`),
    delegationCertificateId: opaqueId(
      researcher.delegationCertificateId,
      `${path}.delegationCertificateId`,
    ),
    delegationOwnerPersonId: matchOpaqueId(
      researcher.delegationOwnerPersonId,
      personId,
      `${path}.delegationOwnerPersonId`,
      "RESEARCH_DELEGATION_OWNER_MISMATCH",
    ),
    delegationScopes: scopes,
    connectionActive: trueValue(
      researcher.connectionActive,
      `${path}.connectionActive`,
    ),
  };
}

function attemptEvidence(value) {
  const path = "$.attempt";
  const attempt = object(value, path);
  return {
    id: opaqueId(attempt.id, `${path}.id`),
    personId: opaqueId(attempt.personId, `${path}.personId`),
    agentId: opaqueId(attempt.agentId, `${path}.agentId`),
    delegationCertificateId: opaqueId(
      attempt.delegationCertificateId,
      `${path}.delegationCertificateId`,
    ),
    problemRevisionId: opaqueId(
      attempt.problemRevisionId,
      `${path}.problemRevisionId`,
    ),
    status: enumValue(
      attempt.status,
      ["submitted", "completed"],
      `${path}.status`,
    ),
    createdAt: instant(attempt.createdAt, `${path}.createdAt`),
  };
}

function bundleEvidence(value) {
  const path = "$.bundle";
  const bundle = object(value, path);
  return {
    protocolVersion: enumValue(
      bundle.protocolVersion,
      ["pw-artifact-bundle-v2", "pw-artifact-bundle-v3"],
      `${path}.protocolVersion`,
    ),
    id: opaqueId(bundle.id, `${path}.id`),
    manifestHash: hash(bundle.manifestHash, `${path}.manifestHash`),
    attemptId: opaqueId(bundle.attemptId, `${path}.attemptId`),
    problemRevisionId: opaqueId(
      bundle.problemRevisionId,
      `${path}.problemRevisionId`,
    ),
    agentId: opaqueId(bundle.agentId, `${path}.agentId`),
    delegationCertificateId: opaqueId(
      bundle.delegationCertificateId,
      `${path}.delegationCertificateId`,
    ),
    target: targetEvidence(bundle.target, `${path}.target`),
    agentSignatureValid: trueValue(
      bundle.agentSignatureValid,
      `${path}.agentSignatureValid`,
    ),
    stagedAt: instant(bundle.stagedAt, `${path}.stagedAt`),
  };
}

function runnerEvidence(value) {
  const path = "$.runner";
  const runner = object(value, path);
  const checksObject = object(runner.checks, `${path}.checks`);
  const checks = {};
  for (const name of PASSING_RUN_CHECKS) {
    checks[name] = enumValue(
      checksObject[name],
      ["passed"],
      `${path}.checks.${name}`,
    );
  }
  return {
    protocolVersion: enumValue(
      runner.protocolVersion,
      ["pw-lean-runner-v1"],
      `${path}.protocolVersion`,
    ),
    runId: opaqueId(runner.runId, `${path}.runId`),
    attemptId: opaqueId(runner.attemptId, `${path}.attemptId`),
    artifactBundleHash: hash(
      runner.artifactBundleHash,
      `${path}.artifactBundleHash`,
    ),
    requestHash: hash(runner.requestHash, `${path}.requestHash`),
    resultHash: hash(runner.resultHash, `${path}.resultHash`),
    status: enumValue(runner.status, ["succeeded"], `${path}.status`),
    kernelStatus: enumValue(
      runner.kernelStatus,
      ["accepted"],
      `${path}.kernelStatus`,
    ),
    checks,
    runnerSignatureValid: trueValue(
      runner.runnerSignatureValid,
      `${path}.runnerSignatureValid`,
    ),
    finishedAt: instant(runner.finishedAt, `${path}.finishedAt`),
  };
}

function reviewEvidence(value, path, {
  attempt,
  bundle,
  researcher,
  runner,
}) {
  const review = object(value, path);
  const assignmentId = opaqueId(
    review.assignmentId,
    `${path}.assignmentId`,
  );
  const claimType = enumValue(
    review.claimType,
    REQUIRED_CLAIMS,
    `${path}.claimType`,
  );
  const reviewerPersonId = opaqueId(
    review.reviewerPersonId,
    `${path}.reviewerPersonId`,
  );
  if (reviewerPersonId === researcher.personId) {
    fail(
      "REVIEW_NOT_INDEPENDENT",
      `${path}.reviewerPersonId`,
      "Reviewer Person must differ from the Attempt owner.",
    );
  }
  const reviewerAgentId = opaqueId(
    review.reviewerAgentId,
    `${path}.reviewerAgentId`,
  );
  if (reviewerAgentId === researcher.agentId) {
    fail(
      "REVIEW_AGENT_NOT_DISTINCT",
      `${path}.reviewerAgentId`,
      "Review Agent must differ from the research Agent.",
    );
  }
  const reviewerDelegationCertificateId = opaqueId(
    review.reviewerDelegationCertificateId,
    `${path}.reviewerDelegationCertificateId`,
  );
  const assignmentAcceptedAt = instant(
    review.assignmentAcceptedAt,
    `${path}.assignmentAcceptedAt`,
  );
  const scopes = array(
    review.reviewerDelegationScopes,
    `${path}.reviewerDelegationScopes`,
  ).map((scope, index) =>
    string(scope, `${path}.reviewerDelegationScopes[${index}]`));
  if (!scopes.includes("review")) {
    fail(
      "REVIEW_DELEGATION_SCOPE_MISSING",
      `${path}.reviewerDelegationScopes`,
      "Review Agent delegation must include review.",
    );
  }
  trueValue(
    review.reviewerDelegationActive,
    `${path}.reviewerDelegationActive`,
  );
  const evidenceHash = hash(review.evidenceHash, `${path}.evidenceHash`);
  const replay = ["bundle_reproducible", "kernel_accepted"].includes(claimType)
    ? replayEvidence(review.replay, `${path}.replay`, {
      assignmentId,
      bundle,
      evidenceHash,
      runner,
      assignmentAcceptedAt,
      reviewerPersonId,
      reviewerAgentId,
      reviewerDelegationCertificateId,
    })
    : absentReplay(review.replay, `${path}.replay`);
  const result = {
    assignmentId,
    assignmentAcceptedAt,
    assignmentStatus: enumValue(
      review.assignmentStatus,
      ["completed"],
      `${path}.assignmentStatus`,
    ),
    attestationId: opaqueId(
      review.attestationId,
      `${path}.attestationId`,
    ),
    attestationHash: hash(
      review.attestationHash,
      `${path}.attestationHash`,
    ),
    claimType,
    decision: enumValue(
      review.decision,
      ["attested"],
      `${path}.decision`,
    ),
    artifactBundleHash: hash(
      review.artifactBundleHash,
      `${path}.artifactBundleHash`,
    ),
    attemptOwnerPersonId: opaqueId(
      review.attemptOwnerPersonId,
      `${path}.attemptOwnerPersonId`,
    ),
    reviewerPersonId,
    reviewerAgentId,
    reviewerDelegationCertificateId,
    reviewerDelegationOwnerPersonId: matchOpaqueId(
      review.reviewerDelegationOwnerPersonId,
      reviewerPersonId,
      `${path}.reviewerDelegationOwnerPersonId`,
      "REVIEW_DELEGATION_OWNER_MISMATCH",
    ),
    reviewerDelegationScopes: scopes,
    reviewerDelegationActive: true,
    evidenceHash,
    replay,
    attestationSignatureValid: trueValue(
      review.attestationSignatureValid,
      `${path}.attestationSignatureValid`,
    ),
    attestedAt: instant(review.attestedAt, `${path}.attestedAt`),
  };
  equal(
    result.artifactBundleHash,
    bundle.manifestHash,
    `${path}.artifactBundleHash`,
    "REVIEW_BUNDLE_MISMATCH",
  );
  equal(
    result.attemptOwnerPersonId,
    attempt.personId,
    `${path}.attemptOwnerPersonId`,
    "REVIEW_ATTEMPT_OWNER_MISMATCH",
  );
  return result;
}

function replayEvidence(value, path, {
  assignmentId,
  bundle,
  evidenceHash: expectedEvidenceHash,
  runner,
  assignmentAcceptedAt,
  reviewerPersonId,
  reviewerAgentId,
  reviewerDelegationCertificateId,
}) {
  const replay = object(value, path);
  const checksObject = object(replay.checks, `${path}.checks`);
  const checks = {};
  for (const name of PASSING_RUN_CHECKS) {
    checks[name] = enumValue(
      checksObject[name],
      ["passed"],
      `${path}.checks.${name}`,
    );
  }
  const result = {
    replayId: opaqueId(replay.replayId, `${path}.replayId`),
    assignmentId: opaqueId(
      replay.assignmentId,
      `${path}.assignmentId`,
    ),
    requesterPersonId: opaqueId(
      replay.requesterPersonId,
      `${path}.requesterPersonId`,
    ),
    requesterAgentId: opaqueId(
      replay.requesterAgentId,
      `${path}.requesterAgentId`,
    ),
    delegationCertificateId: opaqueId(
      replay.delegationCertificateId,
      `${path}.delegationCertificateId`,
    ),
    runId: opaqueId(replay.runId, `${path}.runId`),
    artifactBundleHash: hash(
      replay.artifactBundleHash,
      `${path}.artifactBundleHash`,
    ),
    runnerResultHash: hash(
      replay.runnerResultHash,
      `${path}.runnerResultHash`,
    ),
    status: enumValue(replay.status, ["succeeded"], `${path}.status`),
    kernelStatus: enumValue(
      replay.kernelStatus,
      ["accepted"],
      `${path}.kernelStatus`,
    ),
    checks,
    evidenceHash: hash(replay.evidenceHash, `${path}.evidenceHash`),
    requestedAt: instant(replay.requestedAt, `${path}.requestedAt`),
    startedAt: instant(replay.startedAt, `${path}.startedAt`),
    finishedAt: instant(replay.finishedAt, `${path}.finishedAt`),
    recordedAt: instant(replay.recordedAt, `${path}.recordedAt`),
  };
  equal(
    result.assignmentId,
    assignmentId,
    `${path}.assignmentId`,
    "REPLAY_ASSIGNMENT_MISMATCH",
  );
  equal(
    result.requesterPersonId,
    reviewerPersonId,
    `${path}.requesterPersonId`,
    "REPLAY_REVIEWER_PERSON_MISMATCH",
  );
  equal(
    result.requesterAgentId,
    reviewerAgentId,
    `${path}.requesterAgentId`,
    "REPLAY_REVIEWER_AGENT_MISMATCH",
  );
  equal(
    result.delegationCertificateId,
    reviewerDelegationCertificateId,
    `${path}.delegationCertificateId`,
    "REPLAY_DELEGATION_MISMATCH",
  );
  if (result.runId === runner.runId) {
    fail(
      "REPLAY_RUN_NOT_FRESH",
      `${path}.runId`,
      "Fresh review replay must use a distinct Run.",
    );
  }
  equal(
    result.artifactBundleHash,
    bundle.manifestHash,
    `${path}.artifactBundleHash`,
    "REPLAY_BUNDLE_MISMATCH",
  );
  equal(
    result.evidenceHash,
    expectedEvidenceHash,
    `${path}.evidenceHash`,
    "REPLAY_EVIDENCE_HASH_MISMATCH",
  );
  requireAtOrBefore(
    runner.finishedAt,
    assignmentAcceptedAt,
    `${path}.requestedAt`,
    "REPLAY_PRECEDES_PRIMARY_RUN",
  );
  requireAtOrBefore(
    assignmentAcceptedAt,
    result.requestedAt,
    `${path}.requestedAt`,
    "REPLAY_REQUEST_PRECEDES_ASSIGNMENT",
  );
  requireAtOrBefore(
    result.requestedAt,
    result.startedAt,
    `${path}.startedAt`,
    "REPLAY_RUN_TIMELINE_INVALID",
  );
  requireAtOrBefore(
    result.startedAt,
    result.finishedAt,
    `${path}.finishedAt`,
    "REPLAY_RUN_TIMELINE_INVALID",
  );
  requireAtOrBefore(
    result.finishedAt,
    result.recordedAt,
    `${path}.recordedAt`,
    "REPLAY_EVIDENCE_PRECEDES_RUN",
  );
  return result;
}

function absentReplay(value, path) {
  if (value !== null && value !== undefined) {
    fail(
      "UNEXPECTED_REPLAY_EVIDENCE",
      path,
      "Only bundle_reproducible and kernel_accepted use the required fresh replay projection.",
    );
  }
  return null;
}

function uniqueReviewsByClaim(reviews) {
  const byClaim = new Map();
  const assignmentIds = new Set();
  const attestationIds = new Set();
  for (const [index, review] of reviews.entries()) {
    if (byClaim.has(review.claimType)) {
      fail(
        "DUPLICATE_REQUIRED_CLAIM",
        `$.reviews[${index}].claimType`,
        `Duplicate ${review.claimType} review.`,
      );
    }
    if (assignmentIds.has(review.assignmentId)) {
      fail(
        "DUPLICATE_REVIEW_ASSIGNMENT",
        `$.reviews[${index}].assignmentId`,
        "Review assignments must be unique.",
      );
    }
    if (attestationIds.has(review.attestationId)) {
      fail(
        "DUPLICATE_REVIEW_ATTESTATION",
        `$.reviews[${index}].attestationId`,
        "Review attestations must be unique.",
      );
    }
    byClaim.set(review.claimType, review);
    assignmentIds.add(review.assignmentId);
    attestationIds.add(review.attestationId);
  }
  for (const claimType of REQUIRED_CLAIMS) {
    if (!byClaim.has(claimType)) {
      fail(
        "REQUIRED_REVIEW_MISSING",
        "$.reviews",
        `Missing ${claimType} independent review.`,
      );
    }
  }
  if (byClaim.size !== REQUIRED_CLAIMS.length) {
    fail(
      "REVIEW_SET_INVALID",
      "$.reviews",
      "Reviews must contain exactly the three Receipt-policy claims.",
    );
  }
  return byClaim;
}

function receiptEvidence(value) {
  const path = "$.receipt";
  const receipt = object(value, path);
  return {
    protocolVersion: enumValue(
      receipt.protocolVersion,
      ["pw-contribution-receipt-v1"],
      `${path}.protocolVersion`,
    ),
    id: opaqueId(receipt.id, `${path}.id`),
    receiptHash: hash(receipt.receiptHash, `${path}.receiptHash`),
    payloadHash: hash(receipt.payloadHash, `${path}.payloadHash`),
    kind: enumValue(
      receipt.kind,
      [
        "formalization",
        "lemma",
        "proof_patch",
        "counterexample",
        "synthesis",
        "infrastructure",
      ],
      `${path}.kind`,
    ),
    beneficiary: beneficiaryEvidence(
      receipt.beneficiary,
      `${path}.beneficiary`,
    ),
    attempt: receiptAttemptEvidence(receipt.attempt, `${path}.attempt`),
    target: targetEvidence(receipt.target, `${path}.target`),
    artifactBundleHash: hash(
      receipt.artifactBundleHash,
      `${path}.artifactBundleHash`,
    ),
    bundle: receiptBundleEvidence(receipt.bundle, `${path}.bundle`),
    run: receiptRunEvidence(receipt.run, `${path}.run`),
    claims: array(receipt.claims, `${path}.claims`).map((claim, index) =>
      receiptClaimEvidence(claim, `${path}.claims[${index}]`)),
    issuedAt: instant(receipt.issuedAt, `${path}.issuedAt`),
    policyVersion: enumValue(
      receipt.policyVersion,
      ["pw-receipt-policy-v1"],
      `${path}.policyVersion`,
    ),
    signatureValid: trueValue(
      receipt.signatureValid,
      `${path}.signatureValid`,
    ),
    policyValid: trueValue(
      receipt.policyValid,
      `${path}.policyValid`,
    ),
    issuerKeyTrusted: trueValue(
      receipt.issuerKeyTrusted,
      `${path}.issuerKeyTrusted`,
    ),
  };
}

function bindReceipt({
  receipt,
  researcher,
  attempt,
  bundle,
  runner,
  reviewsByClaim,
}) {
  for (const [actual, expected, path, code] of [
    [
      receipt.beneficiary.personId,
      researcher.personId,
      "$.receipt.beneficiary.personId",
      "RECEIPT_BENEFICIARY_PERSON_MISMATCH",
    ],
    [
      receipt.beneficiary.agentId,
      researcher.agentId,
      "$.receipt.beneficiary.agentId",
      "RECEIPT_BENEFICIARY_AGENT_MISMATCH",
    ],
    [
      receipt.beneficiary.delegationCertificateId,
      researcher.delegationCertificateId,
      "$.receipt.beneficiary.delegationCertificateId",
      "RECEIPT_BENEFICIARY_DELEGATION_MISMATCH",
    ],
    [
      receipt.attempt.id,
      attempt.id,
      "$.receipt.attempt.id",
      "RECEIPT_ATTEMPT_ID_MISMATCH",
    ],
    [
      receipt.attempt.personId,
      attempt.personId,
      "$.receipt.attempt.personId",
      "RECEIPT_ATTEMPT_PERSON_MISMATCH",
    ],
    [
      receipt.attempt.agentId,
      attempt.agentId,
      "$.receipt.attempt.agentId",
      "RECEIPT_ATTEMPT_AGENT_MISMATCH",
    ],
    [
      receipt.attempt.delegationCertificateId,
      attempt.delegationCertificateId,
      "$.receipt.attempt.delegationCertificateId",
      "RECEIPT_ATTEMPT_DELEGATION_MISMATCH",
    ],
    [
      receipt.attempt.problemRevisionId,
      attempt.problemRevisionId,
      "$.receipt.attempt.problemRevisionId",
      "RECEIPT_PROBLEM_REVISION_MISMATCH",
    ],
    [
      receipt.target.declaration,
      bundle.target.declaration,
      "$.receipt.target.declaration",
      "RECEIPT_TARGET_DECLARATION_MISMATCH",
    ],
    [
      receipt.target.statementHash,
      bundle.target.statementHash,
      "$.receipt.target.statementHash",
      "RECEIPT_STATEMENT_HASH_MISMATCH",
    ],
    [
      receipt.artifactBundleHash,
      bundle.manifestHash,
      "$.receipt.artifactBundleHash",
      "RECEIPT_BUNDLE_MISMATCH",
    ],
    [
      receipt.bundle.manifestHash,
      bundle.manifestHash,
      "$.receipt.bundle.manifestHash",
      "RECEIPT_MANIFEST_MISMATCH",
    ],
    [
      receipt.run.id,
      runner.runId,
      "$.receipt.run.id",
      "RECEIPT_RUN_ID_MISMATCH",
    ],
    [
      receipt.run.requestHash,
      runner.requestHash,
      "$.receipt.run.requestHash",
      "RECEIPT_RUN_REQUEST_HASH_MISMATCH",
    ],
    [
      receipt.run.resultHash,
      runner.resultHash,
      "$.receipt.run.resultHash",
      "RECEIPT_RUN_RESULT_HASH_MISMATCH",
    ],
    [
      receipt.run.status,
      runner.status,
      "$.receipt.run.status",
      "RECEIPT_RUN_STATUS_MISMATCH",
    ],
    [
      receipt.run.kernelStatus,
      runner.kernelStatus,
      "$.receipt.run.kernelStatus",
      "RECEIPT_KERNEL_STATUS_MISMATCH",
    ],
  ]) {
    equal(actual, expected, path, code);
  }

  const receiptClaims = new Map();
  for (const [index, claim] of receipt.claims.entries()) {
    if (receiptClaims.has(claim.claimType)) {
      fail(
        "DUPLICATE_RECEIPT_CLAIM",
        `$.receipt.claims[${index}].claimType`,
        `Duplicate ${claim.claimType} Receipt claim.`,
      );
    }
    receiptClaims.set(claim.claimType, claim);
  }
  if (receiptClaims.size !== REQUIRED_CLAIMS.length) {
    fail(
      "RECEIPT_CLAIM_SET_INVALID",
      "$.receipt.claims",
      "Receipt must contain exactly the three required policy claims.",
    );
  }

  for (const claimType of REQUIRED_CLAIMS) {
    const claim = receiptClaims.get(claimType);
    if (!claim) {
      fail(
        "RECEIPT_REQUIRED_CLAIM_MISSING",
        "$.receipt.claims",
        `Receipt is missing ${claimType}.`,
      );
    }
    const review = reviewsByClaim.get(claimType);
    for (const [actual, expected, field, code] of [
      [
        claim.verificationAttestationId,
        review.attestationId,
        "verificationAttestationId",
        "RECEIPT_ATTESTATION_ID_MISMATCH",
      ],
      [
        claim.verificationAttestationHash,
        review.attestationHash,
        "verificationAttestationHash",
        "RECEIPT_ATTESTATION_HASH_MISMATCH",
      ],
      [
        claim.artifactBundleHash,
        bundle.manifestHash,
        "artifactBundleHash",
        "RECEIPT_CLAIM_BUNDLE_MISMATCH",
      ],
      [
        claim.reviewerPersonId,
        review.reviewerPersonId,
        "reviewerPersonId",
        "RECEIPT_REVIEWER_PERSON_MISMATCH",
      ],
      [
        claim.reviewerAgentId,
        review.reviewerAgentId,
        "reviewerAgentId",
        "RECEIPT_REVIEWER_AGENT_MISMATCH",
      ],
      [
        claim.reviewerDelegationCertificateId,
        review.reviewerDelegationCertificateId,
        "reviewerDelegationCertificateId",
        "RECEIPT_REVIEWER_DELEGATION_MISMATCH",
      ],
      [
        claim.decision,
        review.decision,
        "decision",
        "RECEIPT_REVIEW_DECISION_MISMATCH",
      ],
    ]) {
      equal(
        actual,
        expected,
        `$.receipt.claims[${claimType}].${field}`,
        code,
      );
    }
  }
}

function publicReceiptVerification(value) {
  const path = "$.publicReceiptVerification";
  const verification = object(value, path);
  return {
    status: enumValue(
      verification.status,
      ["verified"],
      `${path}.status`,
    ),
    receiptId: opaqueId(verification.receiptId, `${path}.receiptId`),
    receiptHash: hash(
      verification.receiptHash,
      `${path}.receiptHash`,
    ),
    currentIssuerKeysetChecked: trueValue(
      verification.currentIssuerKeysetChecked,
      `${path}.currentIssuerKeysetChecked`,
    ),
    dependencyClosureChecked: trueValue(
      verification.dependencyClosureChecked,
      `${path}.dependencyClosureChecked`,
    ),
    checkedAt: instant(verification.checkedAt, `${path}.checkedAt`),
  };
}

function beneficiaryEvidence(value, path) {
  const beneficiary = object(value, path);
  return {
    personId: opaqueId(beneficiary.personId, `${path}.personId`),
    agentId: opaqueId(beneficiary.agentId, `${path}.agentId`),
    delegationCertificateId: opaqueId(
      beneficiary.delegationCertificateId,
      `${path}.delegationCertificateId`,
    ),
  };
}

function receiptAttemptEvidence(value, path) {
  const attempt = object(value, path);
  return {
    id: opaqueId(attempt.id, `${path}.id`),
    personId: opaqueId(attempt.personId, `${path}.personId`),
    agentId: opaqueId(attempt.agentId, `${path}.agentId`),
    delegationCertificateId: opaqueId(
      attempt.delegationCertificateId,
      `${path}.delegationCertificateId`,
    ),
    problemRevisionId: opaqueId(
      attempt.problemRevisionId,
      `${path}.problemRevisionId`,
    ),
  };
}

function receiptBundleEvidence(value, path) {
  const bundle = object(value, path);
  return {
    manifestHash: hash(bundle.manifestHash, `${path}.manifestHash`),
  };
}

function receiptRunEvidence(value, path) {
  const run = object(value, path);
  return {
    id: opaqueId(run.id, `${path}.id`),
    requestHash: hash(run.requestHash, `${path}.requestHash`),
    resultHash: hash(run.resultHash, `${path}.resultHash`),
    status: enumValue(run.status, ["succeeded"], `${path}.status`),
    kernelStatus: enumValue(
      run.kernelStatus,
      ["accepted"],
      `${path}.kernelStatus`,
    ),
  };
}

function receiptClaimEvidence(value, path) {
  const claim = object(value, path);
  return {
    claimType: enumValue(
      claim.claimType,
      REQUIRED_CLAIMS,
      `${path}.claimType`,
    ),
    verificationAttestationId: opaqueId(
      claim.verificationAttestationId,
      `${path}.verificationAttestationId`,
    ),
    verificationAttestationHash: hash(
      claim.verificationAttestationHash,
      `${path}.verificationAttestationHash`,
    ),
    artifactBundleHash: hash(
      claim.artifactBundleHash,
      `${path}.artifactBundleHash`,
    ),
    reviewerPersonId: opaqueId(
      claim.reviewerPersonId,
      `${path}.reviewerPersonId`,
    ),
    reviewerAgentId: opaqueId(
      claim.reviewerAgentId,
      `${path}.reviewerAgentId`,
    ),
    reviewerDelegationCertificateId: opaqueId(
      claim.reviewerDelegationCertificateId,
      `${path}.reviewerDelegationCertificateId`,
    ),
    decision: enumValue(
      claim.decision,
      ["attested"],
      `${path}.decision`,
    ),
  };
}

function targetEvidence(value, path) {
  const target = object(value, path);
  return {
    declaration: string(target.declaration, `${path}.declaration`),
    statementHash: hash(target.statementHash, `${path}.statementHash`),
  };
}

function requireChronology({
  before,
  attempt,
  bundle,
  runner,
  reviews,
  receipt,
  publicVerification,
  after,
}) {
  requireAtOrBefore(before, attempt, "$.attempt.createdAt", "EVENT_OUTSIDE_RELEASE_WINDOW");
  requireAtOrBefore(attempt, bundle, "$.bundle.stagedAt", "EVENT_ORDER_INVALID");
  requireAtOrBefore(bundle, runner, "$.runner.finishedAt", "EVENT_ORDER_INVALID");
  for (const [index, review] of reviews.entries()) {
    requireAtOrBefore(
      runner,
      review.assignmentAcceptedAt,
      `$.reviews[${index}].assignmentAcceptedAt`,
      "EVENT_ORDER_INVALID",
    );
    if (review.replay) {
      requireAtOrBefore(
        review.assignmentAcceptedAt,
        review.replay.requestedAt,
        `$.reviews[${index}].replay.requestedAt`,
        "EVENT_ORDER_INVALID",
      );
      requireAtOrBefore(
        review.replay.requestedAt,
        review.replay.startedAt,
        `$.reviews[${index}].replay.startedAt`,
        "EVENT_ORDER_INVALID",
      );
      requireAtOrBefore(
        review.replay.startedAt,
        review.replay.finishedAt,
        `$.reviews[${index}].replay.finishedAt`,
        "EVENT_ORDER_INVALID",
      );
      requireAtOrBefore(
        review.replay.finishedAt,
        review.replay.recordedAt,
        `$.reviews[${index}].replay.recordedAt`,
        "EVENT_ORDER_INVALID",
      );
      requireAtOrBefore(
        review.replay.recordedAt,
        review.attestedAt,
        `$.reviews[${index}].attestedAt`,
        "EVENT_ORDER_INVALID",
      );
    }
    requireAtOrBefore(
      review.assignmentAcceptedAt,
      review.attestedAt,
      `$.reviews[${index}].attestedAt`,
      "EVENT_ORDER_INVALID",
    );
    requireAtOrBefore(
      review.attestedAt,
      receipt,
      "$.receipt.issuedAt",
      "EVENT_ORDER_INVALID",
    );
  }
  requireAtOrBefore(
    receipt,
    publicVerification,
    "$.publicReceiptVerification.checkedAt",
    "EVENT_ORDER_INVALID",
  );
  requireAtOrBefore(
    publicVerification,
    after,
    "$.release.after.observedAt",
    "EVENT_OUTSIDE_RELEASE_WINDOW",
  );
}

function requireAtOrBefore(first, second, path, code) {
  if (Date.parse(first) > Date.parse(second)) {
    fail(code, path, `Timestamp must be at or after ${first}.`);
  }
}

function rejectCredentialMaterial(value, path = "$", seen = new Set()) {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    for (const forbidden of FORBIDDEN_VALUE_PATTERNS) {
      if (forbidden.test(value)) {
        fail(
          "CREDENTIAL_MATERIAL_FORBIDDEN",
          path,
          "Evidence must be redacted and contain no credential-like value.",
        );
      }
    }
    return;
  }
  if (typeof value !== "object") return;
  if (seen.has(value)) {
    fail("EVIDENCE_GRAPH_CYCLIC", path, "Evidence JSON must be acyclic.");
  }
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (FORBIDDEN_KEY_FRAGMENTS.some((fragment) =>
      normalized.includes(fragment))) {
      fail(
        "CREDENTIAL_MATERIAL_FORBIDDEN",
        `${path}.${key}`,
        "Credential-bearing fields are not allowed in release evidence.",
      );
    }
    rejectCredentialMaterial(nested, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("OBJECT_REQUIRED", path, "Expected an object.");
  }
  return value;
}

function array(value, path) {
  if (!Array.isArray(value)) {
    fail("ARRAY_REQUIRED", path, "Expected an array.");
  }
  return value;
}

function string(value, path) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    fail("STRING_INVALID", path, "Expected a non-empty bounded string.");
  }
  return value;
}

function opaqueId(value, path) {
  const id = string(value, path);
  if (
    id.length < 3
    || id.length > 192
    || /[\s\x00-\x1f\x7f]/.test(id)
  ) {
    fail(
      "OPAQUE_ID_INVALID",
      path,
      "Expected one bounded opaque identifier without whitespace.",
    );
  }
  return id;
}

function matchOpaqueId(value, expected, path, code) {
  const actual = opaqueId(value, path);
  equal(actual, expected, path, code);
  return actual;
}

function hash(value, path) {
  return pattern(value, HASH_PATTERN, path, "HASH_INVALID");
}

function revision(value, path) {
  return pattern(value, REVISION_PATTERN, path, "REVISION_INVALID");
}

function pattern(value, expected, path, code) {
  const text = string(value, path);
  if (!expected.test(text)) {
    fail(code, path, "Value has an invalid format.");
  }
  return text;
}

function instant(value, path) {
  const text = string(value, path);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text)
    || !Number.isFinite(Date.parse(text))
  ) {
    fail(
      "TIMESTAMP_INVALID",
      path,
      "Expected a valid UTC ISO-8601 timestamp.",
    );
  }
  return text;
}

function trueValue(value, path) {
  if (value !== true) {
    fail("TRUE_REQUIRED", path, "Expected true.");
  }
  return true;
}

function enumValue(value, allowed, path) {
  const text = string(value, path);
  if (!allowed.includes(text)) {
    fail(
      "ENUM_VALUE_INVALID",
      path,
      `Expected one of: ${allowed.join(", ")}.`,
    );
  }
  return text;
}

function equal(actual, expected, path, code) {
  if (actual !== expected) {
    fail(code, path, `Expected ${JSON.stringify(expected)}.`);
  }
}

function fail(code, path, message) {
  throw new CredentialedReleaseEvidenceError(code, path, message);
}
