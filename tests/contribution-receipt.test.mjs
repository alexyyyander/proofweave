import assert from "node:assert/strict";
import test from "node:test";
import {
  assertContributionReceiptPolicy,
  contributionReceiptHash,
  createContributionReceipt,
  verifyContributionReceiptSignature,
} from "../packages/protocol/contribution-receipt.mjs";

test("a Contribution Receipt signs all attributed evidence and hashes deterministically", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const receipt = await createContributionReceipt({
    receipt: fixtureReceipt({ issuerPublicKey: base64Url(await crypto.subtle.exportKey("raw", pair.publicKey)) }),
    issuerPrivateKey: pair.privateKey,
  });
  assert.equal(await verifyContributionReceiptSignature(receipt), true);
  assert.match(await contributionReceiptHash(receipt), /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(
    await contributionReceiptHash(receipt),
    await contributionReceiptHash({ ...receipt, run: { ...receipt.run, resultHash: sha("0") } }),
  );
  assert.equal(await verifyContributionReceiptSignature({ ...receipt, run: { ...receipt.run, resultHash: sha("0") } }), false);
  const otherPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  await assert.rejects(
    createContributionReceipt({
      receipt: fixtureReceipt({ issuerPublicKey: base64Url(await crypto.subtle.exportKey("raw", pair.publicKey)) }),
      issuerPrivateKey: otherPair.privateKey,
    }),
    /does not match/,
  );
});

test("certified primary contribution receipts require all independent gates", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const receipt = await createContributionReceipt({
    receipt: fixtureReceipt({ issuerPublicKey: base64Url(await crypto.subtle.exportKey("raw", pair.publicKey)) }),
    issuerPrivateKey: pair.privateKey,
  });
  assert.equal(assertContributionReceiptPolicy(receipt).id, "receipt:fixture-1");
  await assert.rejects(
    (async () => assertContributionReceiptPolicy(await createContributionReceipt({
      receipt: fixtureReceipt({
        issuerPublicKey: base64Url(await crypto.subtle.exportKey("raw", pair.publicKey)),
        claims: [fixtureClaim("bundle_reproducible")],
      }),
      issuerPrivateKey: pair.privateKey,
    })))(),
    /missing required kernel_accepted/,
  );
});

test("verification receipts credit the independent reviewing Agent that actually attested", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const receipt = await createContributionReceipt({
    receipt: fixtureReceipt({
      kind: "verification",
      issuerPublicKey: base64Url(await crypto.subtle.exportKey("raw", pair.publicKey)),
      beneficiary: {
        personId: "person:bob",
        agentId: "agent:bob-reviewer",
        delegationCertificateId: "delegation:bob-reviewer",
      },
    }),
    issuerPrivateKey: pair.privateKey,
  });
  assert.equal(assertContributionReceiptPolicy(receipt).beneficiary.personId, "person:bob");
});

function fixtureReceipt({
  kind = "lemma",
  issuerPublicKey,
  beneficiary = {
    personId: "person:alice",
    agentId: "agent:alice-prover",
    delegationCertificateId: "delegation:alice-prover",
  },
  claims = [
    fixtureClaim("bundle_reproducible"),
    fixtureClaim("kernel_accepted"),
    fixtureClaim("project_accepted"),
  ],
} = {}) {
  return {
    protocolVersion: "pw-contribution-receipt-v1",
    id: "receipt:fixture-1",
    kind,
    beneficiary,
    attempt: {
      id: "attempt:fixture-1",
      personId: "person:alice",
      agentId: "agent:alice-prover",
      delegationCertificateId: "delegation:alice-prover",
      problemRevisionId: "problem-revision:fixture-1",
    },
    target: { declaration: "Proofweave.Fixture.target", statementHash: sha("a") },
    artifactBundleHash: sha("b"),
    bundle: { manifestHash: sha("b"), dependencyReceipts: [{ receiptId: "receipt:upstream-1", receiptHash: sha("c") }] },
    run: { id: "run:fixture-1", requestHash: sha("d"), resultHash: sha("e"), status: "succeeded", kernelStatus: "accepted" },
    claims,
    issuedAt: "2026-07-13T00:00:00Z",
    policyVersion: "pw-receipt-policy-v1",
    issuerKeyId: "issuer:closed-alpha-1",
    issuerPublicKey,
  };
}

function fixtureClaim(claimType) {
  const reviewer = claimType === "project_accepted"
    ? { person: "person:carol", agent: "agent:carol-curator", delegation: "delegation:carol-curator" }
    : { person: "person:bob", agent: "agent:bob-reviewer", delegation: "delegation:bob-reviewer" };
  return {
    claimType,
    verificationAttestationId: `attestation:${claimType}`,
    verificationAttestationHash: sha(claimType === "bundle_reproducible" ? "1" : claimType === "kernel_accepted" ? "2" : "3"),
    artifactBundleHash: sha("b"),
    reviewerPersonId: reviewer.person,
    reviewerAgentId: reviewer.agent,
    reviewerDelegationCertificateId: reviewer.delegation,
    decision: "attested",
  };
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}

function base64Url(buffer) {
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
