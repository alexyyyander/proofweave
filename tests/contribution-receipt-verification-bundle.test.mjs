import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ContributionReceiptVerificationBundleProtocolError,
  canonicalContributionReceiptVerificationBundle,
  contributionReceiptVerificationBundleHash,
  verifyContributionReceiptVerificationBundle,
} from "../packages/protocol/contribution-receipt-verification-bundle.mjs";
import {
  contributionReceiptHash,
  createContributionReceipt,
} from "../packages/protocol/contribution-receipt.mjs";
import { createContributionReceiptLifecycleEvent } from "../packages/protocol/contribution-receipt-lifecycle.mjs";

test("verifies a portable Receipt closure with dependencies, issuer keys, and lifecycle evidence", async () => {
  const fixture = await verificationBundleFixture();
  const verified = await verifyContributionReceiptVerificationBundle(fixture.bundle);

  assert.equal(verified.rootReceiptId, fixture.root.id);
  assert.deepEqual(verified.receipts.map((entry) => entry.receipt.id), [fixture.root.id, fixture.upstream.id, fixture.replacement.id].sort());
  assert.equal(verified.receipts.find((entry) => entry.receipt.id === fixture.root.id).lifecycle[0].eventType, "corrected");
  assert.equal(await contributionReceiptVerificationBundleHash(verified), await contributionReceiptVerificationBundleHash(fixture.bundle));
  assert.equal(canonicalContributionReceiptVerificationBundle(verified), canonicalContributionReceiptVerificationBundle(fixture.bundle));
  assert.equal(
    await contributionReceiptVerificationBundleHash({
      ...fixture.bundle,
      receipts: [...fixture.bundle.receipts].reverse(),
    }),
    await contributionReceiptVerificationBundleHash(fixture.bundle),
  );
});

test("rejects tampered hashes, missing dependency evidence, and unrelated records", async () => {
  const fixture = await verificationBundleFixture();
  await assert.rejects(
    verifyContributionReceiptVerificationBundle({
      ...fixture.bundle,
      receipts: fixture.bundle.receipts.map((entry) => entry.receipt.id === fixture.root.id ? { ...entry, receiptHash: sha("f") } : entry),
    }),
    ContributionReceiptVerificationBundleProtocolError,
  );
  await assert.rejects(
    verifyContributionReceiptVerificationBundle({
      ...fixture.bundle,
      receipts: fixture.bundle.receipts.filter((entry) => entry.receipt.id !== fixture.upstream.id),
    }),
    ContributionReceiptVerificationBundleProtocolError,
  );
  await assert.rejects(
    verifyContributionReceiptVerificationBundle({
      ...fixture.bundle,
      receipts: [...fixture.bundle.receipts, fixture.unrelatedEntry],
    }),
    ContributionReceiptVerificationBundleProtocolError,
  );
});

async function verificationBundleFixture() {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const issuerPublicKey = base64Url(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const upstream = await createReceipt({
    id: "receipt:bundle-upstream",
    kind: "formalization",
    issuedAt: "2026-07-13T00:00:00Z",
    dependencyReceipts: [],
    issuerPublicKey,
    issuerPrivateKey: keyPair.privateKey,
  });
  const upstreamHash = await contributionReceiptHash(upstream);
  const root = await createReceipt({
    id: "receipt:bundle-root",
    kind: "lemma",
    issuedAt: "2026-07-13T00:00:02Z",
    dependencyReceipts: [{ receiptId: upstream.id, receiptHash: upstreamHash }],
    issuerPublicKey,
    issuerPrivateKey: keyPair.privateKey,
  });
  const replacement = await createReceipt({
    id: "receipt:bundle-replacement",
    kind: "proof_patch",
    issuedAt: "2026-07-13T00:00:03Z",
    dependencyReceipts: [],
    issuerPublicKey,
    issuerPrivateKey: keyPair.privateKey,
  });
  const lifecycle = await createContributionReceiptLifecycleEvent({
    event: {
      protocolVersion: "pw-contribution-receipt-lifecycle-event-v1",
      id: "receipt-event:bundle-root-corrected",
      receiptId: root.id,
      eventType: "corrected",
      replacementReceiptId: replacement.id,
      reasonHash: sha("9"),
      occurredAt: "2026-07-13T00:00:04Z",
      issuerKeyId: "issuer:bundle-fixture",
      issuerPublicKey,
    },
    issuerPrivateKey: keyPair.privateKey,
  });
  const unrelated = await createReceipt({
    id: "receipt:bundle-unrelated",
    kind: "synthesis",
    issuedAt: "2026-07-13T00:00:05Z",
    dependencyReceipts: [],
    issuerPublicKey,
    issuerPrivateKey: keyPair.privateKey,
  });
  const unrelatedEntry = {
    receipt: unrelated,
    receiptHash: await contributionReceiptHash(unrelated),
    lifecycle: [],
  };
  return {
    root,
    upstream,
    replacement,
    unrelatedEntry,
    bundle: {
      protocolVersion: "pw-contribution-receipt-verification-bundle-v1",
      rootReceiptId: root.id,
      receipts: [
        { receipt: root, receiptHash: await contributionReceiptHash(root), lifecycle: [lifecycle] },
        { receipt: upstream, receiptHash: upstreamHash, lifecycle: [] },
        { receipt: replacement, receiptHash: await contributionReceiptHash(replacement), lifecycle: [] },
      ],
      issuerKeys: [{
        id: "issuer:bundle-fixture",
        publicKey: issuerPublicKey,
        status: "active",
        validFrom: "2026-07-12T00:00:00Z",
        retiredAt: null,
        revokedAt: null,
      }],
    },
  };
}

async function createReceipt({ id, kind, issuedAt, dependencyReceipts, issuerPublicKey, issuerPrivateKey }) {
  const artifactBundleHash = sha(kind === "formalization" ? "a" : kind === "lemma" ? "b" : "c");
  return createContributionReceipt({
    receipt: {
      protocolVersion: "pw-contribution-receipt-v1",
      id,
      kind,
      beneficiary: {
        personId: "person:bundle-owner",
        agentId: "agent:bundle-prover",
        delegationCertificateId: "delegation:bundle-prover",
      },
      attempt: {
        id: "attempt:bundle-owner",
        personId: "person:bundle-owner",
        agentId: "agent:bundle-prover",
        delegationCertificateId: "delegation:bundle-prover",
        problemRevisionId: "revision:bundle-target",
      },
      target: { declaration: "Proofweave.Bundle.target", statementHash: sha("d") },
      artifactBundleHash,
      bundle: { manifestHash: artifactBundleHash, dependencyReceipts },
      run: {
        id: `run:${id.slice("receipt:".length)}`,
        requestHash: sha("e"),
        resultHash: sha("f"),
        status: "succeeded",
        kernelStatus: "accepted",
      },
      claims: [
        claim("bundle_reproducible", artifactBundleHash, "a"),
        claim("kernel_accepted", artifactBundleHash, "b"),
        claim("project_accepted", artifactBundleHash, "c"),
      ],
      issuedAt,
      policyVersion: "pw-receipt-policy-v1",
      issuerKeyId: "issuer:bundle-fixture",
      issuerPublicKey,
    },
    issuerPrivateKey,
  });
}

function claim(claimType, artifactBundleHash, suffix) {
  return {
    claimType,
    verificationAttestationId: `attestation:bundle-${suffix}`,
    verificationAttestationHash: sha(suffix),
    artifactBundleHash,
    reviewerPersonId: `person:bundle-reviewer-${suffix}`,
    reviewerAgentId: `agent:bundle-reviewer-${suffix}`,
    reviewerDelegationCertificateId: `delegation:bundle-reviewer-${suffix}`,
    decision: "attested",
  };
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}
