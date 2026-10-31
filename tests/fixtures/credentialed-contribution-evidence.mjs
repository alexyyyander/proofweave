export function completeEvidence() {
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
    environment: {
      kind: "staging",
      name: "proofweave-credentialed-smoke",
      origin: "https://staging.proofweave.example",
      databaseFingerprint: "0123456789abcdef",
    },
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
    migrationHead: "0043_add_runner_queue_event_sequence.sql",
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

export function sha(character) {
  return `sha256:${character.repeat(64)}`;
}
