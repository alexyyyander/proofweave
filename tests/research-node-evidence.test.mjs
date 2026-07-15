import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, sha256Canonical } from "../packages/protocol/canonical-json.mjs";
import { signLeanRunnerResult } from "../packages/protocol/lean-runner.mjs";
import {
  verificationAttestationPayloadHash,
  verificationAttestationSigningPayload,
} from "../packages/protocol/verification-attestation.mjs";
import {
  contributionReceiptHash,
  createContributionReceipt,
} from "../packages/protocol/contribution-receipt.mjs";
import { projectResearchNodeEvidence } from "../services/research/research-node-evidence.mjs";

test("research checkpoints project each verified evidence gate without changing checkpoint state", async () => {
  const runnerKeys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const reviewerKeys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const issuerKeys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const runnerPublicKey = base64Url(await crypto.subtle.exportKey("raw", runnerKeys.publicKey));
  const reviewerPublicKey = base64Url(await crypto.subtle.exportKey("raw", reviewerKeys.publicKey));
  const issuerPublicKey = base64Url(await crypto.subtle.exportKey("raw", issuerKeys.publicKey));
  const artifactBundleHash = hash("a");
  const requestHash = hash("b");
  const result = await signLeanRunnerResult({
    runnerPrivateKey: runnerKeys.privateKey,
    result: {
      protocolVersion: "pw-lean-runner-v1",
      jobId: "run:research-evidence",
      attemptId: "attempt:research-evidence",
      requestHash,
      runnerKeyId: "runner-key:research-evidence",
      status: "succeeded",
      exitCode: 0,
      startedAt: "2026-07-15T00:00:00Z",
      finishedAt: "2026-07-15T00:00:01Z",
      kernelStatus: "accepted",
      checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
      artifacts: { manifestHash: artifactBundleHash, stdoutHash: hash("c"), stderrHash: hash("d") },
    },
  });
  const resultHash = await sha256Canonical(result);
  const attestations = await Promise.all([
    "bundle_reproducible",
    "kernel_accepted",
    "project_accepted",
  ].map((claimType, index) => signedAttestation({
    claimType,
    index,
    artifactBundleHash,
    reviewerPublicKey,
    reviewerPrivateKey: reviewerKeys.privateKey,
  })));
  const receipt = await createContributionReceipt({
    issuerPrivateKey: issuerKeys.privateKey,
    receipt: {
      protocolVersion: "pw-contribution-receipt-v1",
      id: "receipt:research-evidence",
      kind: "lemma",
      beneficiary: {
        personId: "person:research-owner",
        agentId: "agent:research-owner",
        delegationCertificateId: "delegation:research-owner",
      },
      attempt: {
        id: "attempt:research-evidence",
        personId: "person:research-owner",
        agentId: "agent:research-owner",
        delegationCertificateId: "delegation:research-owner",
        problemRevisionId: "problem-revision:research-evidence",
      },
      target: { declaration: "Proofweave.Research.Evidence", statementHash: hash("e") },
      artifactBundleHash,
      bundle: { manifestHash: artifactBundleHash, dependencyReceipts: [] },
      run: {
        id: result.jobId,
        requestHash,
        resultHash,
        status: "succeeded",
        kernelStatus: "accepted",
      },
      claims: await Promise.all(attestations.map(async (attestation) => ({
        claimType: attestation.claimType,
        verificationAttestationId: attestation.id,
        verificationAttestationHash: await sha256Canonical(attestation),
        artifactBundleHash,
        reviewerPersonId: attestation.verifierPersonId,
        reviewerAgentId: attestation.verifierAgentId,
        reviewerDelegationCertificateId: attestation.delegationCertificateId,
        decision: "attested",
      }))),
      issuedAt: "2026-07-15T00:00:05Z",
      policyVersion: "pw-receipt-policy-v1",
      issuerKeyId: "receipt-key:research-evidence",
      issuerPublicKey,
    },
  });
  let trustChecks = 0;
  const [projected] = await projectResearchNodeEvidence({
    nodes: [nodeFixture(artifactBundleHash)],
    runRows: [{
      id: result.jobId,
      attempt_id: result.attemptId,
      artifact_bundle_hash: artifactBundleHash,
      request_hash: requestHash,
      state: "succeeded",
      finished_at: result.finishedAt,
      runner_result_hash: resultHash,
      result_hash: resultHash,
      canonical_result: canonicalJson(result),
      received_at: "2026-07-15T00:00:02Z",
    }],
    runnerKeyRows: [{ id: result.runnerKeyId, public_key: runnerPublicKey }],
    attestationRows: attestations.map(attestationRow),
    receiptRows: [{
      id: receipt.id,
      receipt_hash: await contributionReceiptHash(receipt),
      canonical_receipt: canonicalJson(receipt),
    }],
    assertReceiptIssuerTrusted: async (candidate) => {
      trustChecks += 1;
      assert.equal(candidate.issuerPublicKey, issuerPublicKey);
    },
  });

  assert.equal(projected.state, "shared_unverified");
  assert.equal(projected.evidence.stage, "receipt_recorded");
  assert.equal(projected.evidence.bundle.manifestHash, artifactBundleHash);
  assert.equal(projected.evidence.lean.resultHash, resultHash);
  assert.deepEqual(projected.evidence.review.claimTypes, ["bundle_reproducible", "kernel_accepted", "project_accepted"]);
  assert.equal(projected.evidence.review.attestationCount, 3);
  assert.equal(projected.evidence.review.reviewerCount, 1);
  assert.equal(projected.evidence.receipt.id, receipt.id);
  assert.equal(trustChecks, 1);
});

test("unverifiable evidence never upgrades a staged checkpoint", async () => {
  const node = nodeFixture(hash("f"));
  const [projected] = await projectResearchNodeEvidence({
    nodes: [node],
    runRows: [{ canonical_result: "{}", result_hash: hash("1"), runner_result_hash: hash("1"), received_at: "2026-07-15T00:00:00Z" }],
    receiptRows: [{ id: "receipt:tampered", receipt_hash: hash("2"), canonical_receipt: "{}" }],
  });
  assert.equal(projected.state, "shared_unverified");
  assert.equal(projected.evidence.stage, "bundle_staged");
  assert.equal(projected.evidence.lean, null);
  assert.equal(projected.evidence.review, null);
  assert.equal(projected.evidence.receipt, null);
});

async function signedAttestation({ claimType, index, artifactBundleHash, reviewerPublicKey, reviewerPrivateKey }) {
  const attestation = {
    protocolVersion: "pw-verification-attestation-v1",
    id: `attestation:research-evidence:${index}`,
    assignmentId: `assignment:research-evidence:${index}`,
    artifactBundleHash,
    claimType,
    verifierPersonId: "person:independent-reviewer",
    verifierAgentId: "agent:independent-reviewer",
    delegationCertificateId: "delegation:independent-reviewer",
    verifierAgentPublicKey: reviewerPublicKey,
    decision: "attested",
    evidenceHash: hash(String(index + 3)),
    attestedAt: `2026-07-15T00:00:0${index + 2}Z`,
    payloadHash: hash("0"),
    signature: "A".repeat(86),
  };
  attestation.payloadHash = await verificationAttestationPayloadHash(attestation);
  attestation.signature = base64Url(await crypto.subtle.sign(
    "Ed25519",
    reviewerPrivateKey,
    new TextEncoder().encode(canonicalJson(verificationAttestationSigningPayload(attestation))),
  ));
  return attestation;
}

function attestationRow(attestation) {
  return {
    id: attestation.id,
    assignment_id: attestation.assignmentId,
    artifact_bundle_manifest_hash: attestation.artifactBundleHash,
    claim_type: attestation.claimType,
    verifier_person_id: attestation.verifierPersonId,
    verifier_agent_id: attestation.verifierAgentId,
    delegation_certificate_id: attestation.delegationCertificateId,
    verifier_agent_public_key: attestation.verifierAgentPublicKey,
    decision: attestation.decision,
    evidence_hash: attestation.evidenceHash,
    canonical_payload: canonicalJson(attestation),
    payload_hash: attestation.payloadHash,
    signature: attestation.signature,
    attested_at: attestation.attestedAt,
  };
}

function nodeFixture(artifactBundleHash) {
  return {
    id: "research-node:evidence",
    problemRevisionId: "problem-revision:research-evidence",
    attemptId: "attempt:research-evidence",
    kind: "lemma",
    summary: "A reusable lemma with separately layered evidence.",
    proofStateHash: null,
    artifactBundleHash,
    delegationCertificateId: "delegation:research-owner",
    state: "shared_unverified",
    payloadHash: hash("8"),
    checkpointHash: hash("9"),
    occurredAt: "2026-07-15T00:00:00Z",
    creator: {
      personId: "person:research-owner",
      displayName: "Research owner",
      agentId: "agent:research-owner",
      agentLabel: "Research Agent",
    },
  };
}

function hash(character) {
  return `sha256:${character.repeat(64)}`;
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}
