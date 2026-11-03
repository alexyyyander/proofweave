import assert from "node:assert/strict";
import test from "node:test";
import { canonicalUtf8 } from "../packages/protocol/canonical-json.mjs";
import { normalizePoolFinalityAdjudication, trustedPoolFinalityAuthorities, verifyPoolFinalitySignatures } from "../packages/protocol/pool-finality-adjudication.mjs";
import { D1PoolCreditSettlement } from "../services/credits/d1-pool-credit-settlement.mjs";

const digest = (digit) => `sha256:${digit.repeat(64)}`;
const b64 = (buffer) => Buffer.from(buffer).toString("base64url");

test("independent reviewer and owner sign the exact target, Receipt, beneficiary and original-result decision", async () => {
  const reviewer = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const owner = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const payload = { protocolVersion: "pw-pool-finality-v1", poolId: "pool:one", problemRevisionId: "revision:one", finalReceiptId: "receipt:one", finalReceiptHash: digest("a"), targetDeclaration: "Target.example'", targetStatementHash: digest("b"), beneficiaryPersonId: "person:author", reviewerPersonId: "person:reviewer", reviewerKeyId: "key:reviewer", reviewAttestationId: "attestation:one", reviewAttestationHash: digest("c"), reviewEvidenceHash: digest("d"), noveltyAttestationId: "attestation:novelty", noveltyAttestationHash: digest("e"), noveltyEvidenceHash: digest("f"), ownerPersonId: "person:owner", ownerKeyId: "key:owner", issuedAt: "2026-07-01T00:00:00Z", decision: "original_final_result" };
  const adjudication = { payload, reviewerSignature: b64(await crypto.subtle.sign("Ed25519", reviewer.privateKey, canonicalUtf8(payload))), ownerSignature: b64(await crypto.subtle.sign("Ed25519", owner.privateKey, canonicalUtf8(payload))) };
  const keys = { reviewerPublicKey: b64(await crypto.subtle.exportKey("raw", reviewer.publicKey)), ownerPublicKey: b64(await crypto.subtle.exportKey("raw", owner.publicKey)) };
  assert.equal(await verifyPoolFinalitySignatures(adjudication, keys), true);
  assert.equal(await verifyPoolFinalitySignatures({ ...adjudication, payload: { ...payload, beneficiaryPersonId: "person:other" } }, keys), false);
  assert.equal(await verifyPoolFinalitySignatures({ ...adjudication, ownerSignature: adjudication.reviewerSignature }, keys), false);
  assert.throws(() => normalizePoolFinalityAdjudication({ ...adjudication, payload: { ...payload, reviewerPersonId: payload.beneficiaryPersonId } }), /independent/);
  assert.throws(() => normalizePoolFinalityAdjudication({ ...adjudication, payload: { ...payload, reviewerPersonId: payload.ownerPersonId } }), /independent/);
  assert.throws(() => normalizePoolFinalityAdjudication({ ...adjudication, payload: { ...payload, decision: "reproduction" } }), /unsupported/);
  assert.deepEqual(trustedPoolFinalityAuthorities, []);
  let calls = 0;
  const db = { prepare() { calls += 1; throw new Error("database must not be accessed"); }, async batch() { calls += 1; } };
  await assert.rejects(new D1PoolCreditSettlement(db).lock(payload.poolId, payload.finalReceiptId, { expectedPlanHash: digest("e"), finalityAdjudication: adjudication }), /adjudication is required/);
  assert.equal(calls, 0);
});
