import assert from "node:assert/strict";
import test from "node:test";
import {
  createContributionReceiptLifecycleEvent,
  normalizeContributionReceiptLifecycleEventDraft,
  verifyContributionReceiptLifecycleEventSignature,
} from "../packages/protocol/contribution-receipt-lifecycle.mjs";

test("a receipt lifecycle event signs one append-only correction decision", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const issuerPublicKey = base64Url(await crypto.subtle.exportKey("raw", pair.publicKey));
  const event = await createContributionReceiptLifecycleEvent({
    event: fixtureEvent({ issuerPublicKey }),
    issuerPrivateKey: pair.privateKey,
  });
  assert.equal(await verifyContributionReceiptLifecycleEventSignature(event), true);
  assert.equal(await verifyContributionReceiptLifecycleEventSignature({ ...event, reasonHash: sha("0") }), false);
});

test("lifecycle event types keep correction and retraction semantics explicit", () => {
  assert.throws(
    () => normalizeContributionReceiptLifecycleEventDraft({
      ...fixtureEvent(),
      eventType: "corrected",
      replacementReceiptId: undefined,
    }),
    /replacementReceiptId/,
  );
  assert.throws(
    () => normalizeContributionReceiptLifecycleEventDraft({
      ...fixtureEvent(),
      eventType: "retracted",
      replacementReceiptId: "receipt:replacement",
    }),
    /cannot name a replacement/,
  );
  assert.throws(
    () => normalizeContributionReceiptLifecycleEventDraft({
      ...fixtureEvent(),
      replacementReceiptId: "receipt:original",
    }),
    /cannot replace its own receipt/,
  );
});

function fixtureEvent({
  issuerPublicKey = base64Url(new Uint8Array(32)),
} = {}) {
  return {
    protocolVersion: "pw-contribution-receipt-lifecycle-event-v1",
    id: "receipt-event:fixture-correction",
    receiptId: "receipt:original",
    eventType: "corrected",
    replacementReceiptId: "receipt:replacement",
    reasonHash: sha("a"),
    occurredAt: "2026-07-13T00:00:00Z",
    issuerKeyId: "issuer:closed-alpha-1",
    issuerPublicKey,
  };
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}

function base64Url(buffer) {
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
