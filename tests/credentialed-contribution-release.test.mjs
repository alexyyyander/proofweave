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
    (error) => error.code === "RELEASE_OBSERVATION_DRIFT"
      && error.path === "$.release.after.databaseFingerprint",
  );

  const migrationDrift = completeEvidence();
  migrationDrift.release.after.migrationHead =
    "0042_add_jacobian_counterexample_audit.sql";
  assert.throws(
    () => checkCredentialedContributionRelease(migrationDrift),
    (error) => error.code === "RELEASE_OBSERVATION_DRIFT"
      && error.path === "$.release.after.migrationHead",
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

function completeEvidence() {
  const revision = "a".repeat(40);
  const bundleHash = sha("b");
  const requestHash = sha("c");
  const resultHash = sha("d");
  const receiptHash = sha("e");
  const reviews = [
    review({
      claimType: "bundle_reproducible",
      suffix: "reproducible",
      person: "person:bob",
      agent: "agent:bob-reviewer",
      delegation: "delegation:bob-reviewer",
      evidenceCharacter: "1",
      replay: true,
      bundleHash,
    }),
    review({
      claimType: "kernel_accepted",
      suffix: "kernel",
      person: "person:bob",
      agent: "agent:bob-reviewer",
      delegation: "delegation:bob-reviewer",
      evidenceCharacter: "2",
      bundleHash,
    }),
    review({
      claimType: "project_accepted",
      suffix: "project",
      person: "person:carol",
      agent: "agent:carol-curator",
      delegation: "delegation:carol-curator",
      evidenceCharacter: "3",
      bundleHash,
    }),
  ];
  return {
    schemaVersion: "pw-credentialed-contribution-release-evidence-v1",
    release: {
      expectedGitSha: revision,
      before: observation({
        revision,
        observedAt: "2026-07-29T10:00:00Z",
      }),
      after: observation({
        revision,
        observedAt: "2026-07-29T11:00:00Z",
      }),
    },
    researcher: {
      personId: "person:alice",
      agentId: "agent:alice-prover",
      delegationCertificateId: "delegation:alice-prover",
      delegationOwnerPersonId: "person:alice",
      delegationScopes: ["formalize", "prove"],
      connectionActive: true,
    },
    attempt: {
      id: "attempt:release-smoke",
      personId: "person:alice",
      agentId: "agent:alice-prover",
      delegationCertificateId: "delegation:alice-prover",
      problemRevisionId: "revision:release-smoke",
      status: "submitted",
      createdAt: "2026-07-29T10:05:00Z",
    },
    bundle: {
      protocolVersion: "pw-artifact-bundle-v2",
      id: "bundle:release-smoke",
      manifestHash: bundleHash,
      attemptId: "attempt:release-smoke",
      problemRevisionId: "revision:release-smoke",
      agentId: "agent:alice-prover",
      delegationCertificateId: "delegation:alice-prover",
      target: {
        declaration: "Proofweave.ReleaseSmoke.target",
        statementHash: sha("a"),
      },
      agentSignatureValid: true,
      stagedAt: "2026-07-29T10:15:00Z",
    },
    runner: {
      protocolVersion: "pw-lean-runner-v1",
      runId: "run:release-smoke",
      attemptId: "attempt:release-smoke",
      artifactBundleHash: bundleHash,
      requestHash,
      resultHash,
      status: "succeeded",
      kernelStatus: "accepted",
      checks: {
        network: "passed",
        noSorry: "passed",
        allowedAxioms: "passed",
        leanBuild: "passed",
      },
      runnerSignatureValid: true,
      finishedAt: "2026-07-29T10:25:00Z",
    },
    reviews,
    receipt: {
      protocolVersion: "pw-contribution-receipt-v1",
      id: "receipt:release-smoke",
      receiptHash,
      payloadHash: sha("f"),
      kind: "formalization",
      beneficiary: {
        personId: "person:alice",
        agentId: "agent:alice-prover",
        delegationCertificateId: "delegation:alice-prover",
      },
      attempt: {
        id: "attempt:release-smoke",
        personId: "person:alice",
        agentId: "agent:alice-prover",
        delegationCertificateId: "delegation:alice-prover",
        problemRevisionId: "revision:release-smoke",
      },
      target: {
        declaration: "Proofweave.ReleaseSmoke.target",
        statementHash: sha("a"),
      },
      artifactBundleHash: bundleHash,
      bundle: { manifestHash: bundleHash },
      run: {
        id: "run:release-smoke",
        requestHash,
        resultHash,
        status: "succeeded",
        kernelStatus: "accepted",
      },
      claims: reviews.map((item) => ({
        claimType: item.claimType,
        verificationAttestationId: item.attestationId,
        verificationAttestationHash: item.attestationHash,
        artifactBundleHash: item.artifactBundleHash,
        reviewerPersonId: item.reviewerPersonId,
        reviewerAgentId: item.reviewerAgentId,
        reviewerDelegationCertificateId:
          item.reviewerDelegationCertificateId,
        decision: item.decision,
      })),
      issuedAt: "2026-07-29T10:45:00Z",
      policyVersion: "pw-receipt-policy-v1",
      signatureValid: true,
      policyValid: true,
      issuerKeyTrusted: true,
    },
    publicReceiptVerification: {
      status: "verified",
      receiptId: "receipt:release-smoke",
      receiptHash,
      currentIssuerKeysetChecked: true,
      dependencyClosureChecked: true,
      checkedAt: "2026-07-29T10:50:00Z",
    },
  };
}

function observation({ revision, observedAt }) {
  return {
    observedAt,
    controlPlaneMode: "read_write",
    writesEnabled: true,
    sitesCommitSha: revision,
    gatewayRevision: revision,
    runnerRevision: revision,
    databaseAuthority: "turso",
    databaseFingerprint: "0123456789abcdef",
    migrationHead: "0043_runner_lease_queue.sql",
  };
}

function review({
  claimType,
  suffix,
  person,
  agent,
  delegation,
  evidenceCharacter,
  bundleHash,
  replay = false,
}) {
  const evidenceHash = sha(evidenceCharacter);
  return {
    assignmentId: `assignment:${suffix}`,
    assignmentAcceptedAt:
      suffix === "reproducible"
        ? "2026-07-29T10:27:00Z"
        : suffix === "kernel"
          ? "2026-07-29T10:27:10Z"
          : "2026-07-29T10:27:20Z",
    assignmentStatus: "completed",
    attestationId: `attestation:${suffix}`,
    attestationHash: sha(
      suffix === "reproducible" ? "4" : suffix === "kernel" ? "5" : "6",
    ),
    claimType,
    decision: "attested",
    artifactBundleHash: bundleHash,
    attemptOwnerPersonId: "person:alice",
    reviewerPersonId: person,
    reviewerAgentId: agent,
    reviewerDelegationCertificateId: delegation,
    reviewerDelegationOwnerPersonId: person,
    reviewerDelegationScopes: ["review"],
    reviewerDelegationActive: true,
    evidenceHash,
    replay: replay || claimType === "kernel_accepted"
      ? {
        replayId: `replay:${suffix}`,
        assignmentId: `assignment:${suffix}`,
        requesterPersonId: person,
        requesterAgentId: agent,
        delegationCertificateId: delegation,
        runId: `run:review-replay:${suffix}`,
        artifactBundleHash: bundleHash,
        runnerResultHash: sha(
          suffix === "reproducible" ? "7" : "8",
        ),
        status: "succeeded",
        kernelStatus: "accepted",
        checks: {
          network: "passed",
          noSorry: "passed",
          allowedAxioms: "passed",
          leanBuild: "passed",
        },
        evidenceHash,
        requestedAt:
          suffix === "reproducible"
            ? "2026-07-29T10:28:00Z"
            : "2026-07-29T10:28:10Z",
        startedAt:
          suffix === "reproducible"
            ? "2026-07-29T10:28:30Z"
            : "2026-07-29T10:28:40Z",
        finishedAt:
          suffix === "reproducible"
            ? "2026-07-29T10:29:00Z"
            : "2026-07-29T10:29:10Z",
        recordedAt:
          suffix === "reproducible"
            ? "2026-07-29T10:30:00Z"
            : "2026-07-29T10:31:00Z",
      }
      : null,
    attestationSignatureValid: true,
    attestedAt:
      suffix === "reproducible"
        ? "2026-07-29T10:35:00Z"
        : suffix === "kernel"
          ? "2026-07-29T10:36:00Z"
          : "2026-07-29T10:37:00Z",
  };
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}
