// tests/anchor-witness.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  anchorWitnessProtocolVersion,
  anchorWitnessSigningPayload,
  signAnchorWitness,
  verifyAnchorWitnessSignature,
} from "../packages/protocol/anchor-witness.mjs";

const input = {
  batchId: "anchor-batch:1",
  root: `sha256:${"1".repeat(64)}`,
  manifestHash: `sha256:${"2".repeat(64)}`,
  txRef: "mock:local:tx-1",
};

test("witness signature binds batchId, root, manifestHash, and txRef", async () => {
  const payload = anchorWitnessSigningPayload(input);
  assert.equal(payload.protocolVersion, anchorWitnessProtocolVersion);
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const signature = await signAnchorWitness(payload, keys.privateKey);
  assert.equal(await verifyAnchorWitnessSignature(payload, signature, keys.publicKey), true);
  const tampered = anchorWitnessSigningPayload({ ...input, txRef: "mock:local:tx-2" });
  assert.equal(await verifyAnchorWitnessSignature(tampered, signature, keys.publicKey), false);
});
