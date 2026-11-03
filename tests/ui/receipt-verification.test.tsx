import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contributionReceiptHash,
  createContributionReceipt,
} from "../../packages/protocol/contribution-receipt.mjs";
import { verifyReceiptBundle } from "../../app/receipt/[id]/receipt-verification";

/**
 * The receipt page's verification panel must only vouch for the receipt it is
 * showing, and its key-gate wording must match what the protocol actually
 * checks. These fixtures cover the substituted-bundle case the panel used to
 * accept and the retirement semantics the old copy overstated.
 */
const issuedAt = "2026-07-13T00:00:00Z";
const validFrom = "2026-01-01T00:00:00Z";

async function buildFixture() {
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const issuerPublicKey = Buffer.from(await crypto.subtle.exportKey("raw", keys.publicKey)).toString("base64url");
  const hash = (character: string) => `sha256:${character.repeat(64)}`;
  const claim = (claimType: string, attestation: string, hashCharacter: string) => ({
    claimType,
    verificationAttestationId: `attestation:${attestation}`,
    verificationAttestationHash: hash(hashCharacter),
    artifactBundleHash: hash("b"),
    reviewerPersonId: "person:fixture-reviewer",
    reviewerAgentId: `agent:fixture-${attestation}`,
    reviewerDelegationCertificateId: `delegation:fixture-${attestation}`,
    decision: "attested",
  });
  const base = {
    protocolVersion: "pw-contribution-receipt-v1",
    beneficiary: {
      personId: "person:fixture-owner",
      agentId: "agent:fixture-prover",
      delegationCertificateId: "delegation:fixture-prover",
    },
    attempt: {
      id: "attempt:fixture",
      personId: "person:fixture-owner",
      agentId: "agent:fixture-prover",
      delegationCertificateId: "delegation:fixture-prover",
      problemRevisionId: "revision:fixture",
    },
    target: { declaration: "Fixture.PublicLemma", statementHash: hash("a") },
    artifactBundleHash: hash("b"),
    run: {
      id: "run:fixture",
      requestHash: hash("c"),
      resultHash: hash("d"),
      status: "succeeded",
      kernelStatus: "accepted",
    },
    claims: [
      claim("bundle_reproducible", "bundle", "e"),
      claim("kernel_accepted", "kernel", "f"),
      claim("project_accepted", "project", "0"),
    ],
    policyVersion: "pw-receipt-policy-v1",
    issuerKeyId: "issuer:fixture",
    issuerPublicKey,
  };
  const sign = (id: string) => createContributionReceipt({
    receipt: {
      ...base,
      id,
      kind: "lemma",
      bundle: { manifestHash: hash("b"), dependencyReceipts: [] },
      issuedAt,
    },
    issuerPrivateKey: keys.privateKey,
  });

  const receipt = await sign("receipt:fixture");
  const otherReceipt = await sign("receipt:other");
  const receiptHash = await contributionReceiptHash(receipt);
  const otherReceiptHash = await contributionReceiptHash(otherReceipt);
  const issuerKey = { id: "issuer:fixture", publicKey: issuerPublicKey, status: "active", validFrom, retiredAt: null, revokedAt: null };
  const bundleFor = (root: typeof receipt, rootHash: string) => ({
    protocolVersion: "pw-contribution-receipt-verification-bundle-v1",
    rootReceiptId: root.id,
    receipts: [{ receipt: root, receiptHash: rootHash, lifecycle: [] }],
    issuerKeys: [issuerKey],
  });

  return {
    receipt,
    receiptHash,
    bundle: bundleFor(receipt, receiptHash),
    otherBundle: bundleFor(otherReceipt, otherReceiptHash),
    issuerKey,
    hash,
  };
}

test("a bundle for this receipt passes every gate", async () => {
  const { receipt, receiptHash, bundle, issuerKey } = await buildFixture();
  const seen: string[] = [];
  const result = await verifyReceiptBundle({
    receiptId: receipt.id,
    receiptHash,
    bundle,
    currentKeyset: { issuerKeys: [issuerKey] },
    onGate: (gate) => seen.push(gate.id),
  });
  assert.equal(result.verdict, "passed");
  assert.deepEqual(result.gates.map((gate) => gate.id), ["bundle", "identity", "hash", "signature", "policy", "closure", "keys"]);
  assert.deepEqual(seen, ["bundle", "identity", "hash", "signature", "policy", "closure", "keys"]);
  assert.equal(result.retiredIssuerKeys, 0);
  assert.match(result.bundleHash ?? "", /^sha256:/);
});

test("a valid bundle for another receipt is rejected before any hash gate", async () => {
  const { receipt, receiptHash, otherBundle, issuerKey } = await buildFixture();
  const result = await verifyReceiptBundle({
    receiptId: receipt.id,
    receiptHash,
    bundle: otherBundle,
    currentKeyset: { issuerKeys: [issuerKey] },
  });
  assert.equal(result.verdict, "failed");
  assert.deepEqual(result.gates.map((gate) => gate.id), ["bundle", "identity"]);
  assert.equal(result.gates[1].status, "failed");
  assert.match(result.gates[1].error ?? "", /roots at receipt:other/);
  assert.equal(result.receiptHash, await contributionReceiptHash(otherBundle.receipts[0].receipt));
});

test("a bundle for this id but another receipt hash is rejected", async () => {
  const { receipt, bundle, issuerKey, hash } = await buildFixture();
  const result = await verifyReceiptBundle({
    receiptId: receipt.id,
    receiptHash: hash("9"),
    bundle,
    currentKeyset: { issuerKeys: [issuerKey] },
  });
  assert.equal(result.verdict, "failed");
  assert.deepEqual(result.gates.map((gate) => gate.id), ["bundle", "identity"]);
  assert.match(result.gates[1].error ?? "", /not the receipt shown here/);
});

test("a key retired after the evidence still passes and is reported as retired", async () => {
  const { receipt, receiptHash, bundle, issuerKey } = await buildFixture();
  const result = await verifyReceiptBundle({
    receiptId: receipt.id,
    receiptHash,
    bundle,
    currentKeyset: {
      issuerKeys: [{ ...issuerKey, status: "retired", retiredAt: "2026-08-01T00:00:00Z" }],
    },
  });
  assert.equal(result.verdict, "passed");
  assert.equal(result.gates.find((gate) => gate.id === "keys")?.status, "passed");
  assert.equal(result.retiredIssuerKeys, 1);
});

test("an unavailable keyset is reported instead of assumed", async () => {
  const { receipt, receiptHash, bundle } = await buildFixture();
  const result = await verifyReceiptBundle({
    receiptId: receipt.id,
    receiptHash,
    bundle,
    currentKeyset: null,
  });
  assert.equal(result.verdict, "partial");
  assert.equal(result.gates.find((gate) => gate.id === "keys")?.status, "unavailable");
});

test("a revoked key fails the key gate", async () => {
  const { receipt, receiptHash, bundle, issuerKey } = await buildFixture();
  const result = await verifyReceiptBundle({
    receiptId: receipt.id,
    receiptHash,
    bundle,
    currentKeyset: {
      issuerKeys: [{ ...issuerKey, status: "revoked", retiredAt: null, revokedAt: "2026-08-01T00:00:00Z" }],
    },
  });
  assert.equal(result.verdict, "failed");
  assert.equal(result.gates.find((gate) => gate.id === "keys")?.status, "failed");
});
