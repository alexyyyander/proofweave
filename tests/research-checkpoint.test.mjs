import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeResearchCheckpoint,
  researchCheckpointHash,
  researchCheckpointPayloadHash,
  researchCheckpointSigningPayload,
  verifyResearchCheckpointSignature,
} from "../packages/protocol/research-checkpoint.mjs";
import { canonicalJson } from "../packages/protocol/canonical-json.mjs";

test("research checkpoint normalization and Agent signature are deterministic", async () => {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = base64Url(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const checkpoint = await signedCheckpoint(keyPair.privateKey, publicKey, {
    parentNodeIds: ["node:z", "node:a"],
    citations: [
      { externalWorkId: "work:z", relation: "builds_on" },
      { externalWorkId: "work:a", relation: "formalizes" },
    ],
  });
  const normalized = normalizeResearchCheckpoint(checkpoint);
  assert.deepEqual(normalized.parentNodeIds, ["node:a", "node:z"]);
  assert.deepEqual(normalized.citations.map((entry) => entry.externalWorkId), ["work:a", "work:z"]);
  assert.equal(await verifyResearchCheckpointSignature(normalized), true);
  assert.match(await researchCheckpointHash(normalized), /^sha256:[a-f0-9]{64}$/);

  const changed = structuredClone(normalized);
  changed.summary = "A different public milestone.";
  assert.equal(await verifyResearchCheckpointSignature(changed), false);
});

test("a synthesis checkpoint requires two explicit parents", async () => {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = base64Url(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  await assert.rejects(
    signedCheckpoint(keyPair.privateKey, publicKey, { kind: "synthesis", parentNodeIds: ["node:only"] }),
    /at least two parent nodes/,
  );
});

async function signedCheckpoint(privateKey, publicKey, overrides = {}) {
  const checkpoint = {
    protocolVersion: "pw-research-checkpoint-v1",
    id: "research-node:test",
    attemptId: "attempt:test",
    problemRevisionId: "revision:test",
    kind: "lemma",
    summary: "Reduced the target to a reusable bounded lemma.",
    parentNodeIds: [],
    proofStateHash: null,
    artifactBundleHash: null,
    citations: [],
    agentEvent: {
      id: "research-checkpoint-event:test",
      agentId: "agent:test",
      agentPublicKey: publicKey,
      occurredAt: "2026-07-15T00:00:00Z",
      signature: "A".repeat(86),
    },
    payloadHash: `sha256:${"0".repeat(64)}`,
    ...overrides,
  };
  checkpoint.payloadHash = await researchCheckpointPayloadHash(checkpoint);
  checkpoint.agentEvent.signature = base64Url(await crypto.subtle.sign(
    "Ed25519",
    privateKey,
    new TextEncoder().encode(canonicalJson(researchCheckpointSigningPayload(checkpoint))),
  ));
  return checkpoint;
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}
