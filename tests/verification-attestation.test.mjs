import assert from "node:assert/strict";
import test from "node:test";
import {
  assertIndependentVerification,
  verificationAttestationPayloadHash,
  verificationAttestationSigningPayload,
  verifyVerificationAttestationSignature,
} from "../packages/protocol/verification-attestation.mjs";
import { canonicalJson } from "../packages/protocol/canonical-json.mjs";

test("a review Agent attestation signs its complete evidence payload", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const attestation = fixture(base64Url(await crypto.subtle.exportKey("raw", pair.publicKey)));
  attestation.payloadHash = await verificationAttestationPayloadHash(attestation);
  attestation.signature = base64Url(
    await crypto.subtle.sign(
      "Ed25519",
      pair.privateKey,
      new TextEncoder().encode(canonicalJson(verificationAttestationSigningPayload(attestation))),
    ),
  );

  assert.equal(await verifyVerificationAttestationSignature(attestation), true);
  assert.equal(await verifyVerificationAttestationSignature({
    ...attestation,
    decision: "rejected",
  }), false);

  const integrityFlag = { ...attestation, id: "attestation:fixture-integrity", decision: "integrity_flagged" };
  integrityFlag.payloadHash = await verificationAttestationPayloadHash(integrityFlag);
  integrityFlag.signature = base64Url(
    await crypto.subtle.sign(
      "Ed25519",
      pair.privateKey,
      new TextEncoder().encode(canonicalJson(verificationAttestationSigningPayload(integrityFlag))),
    ),
  );
  assert.equal(await verifyVerificationAttestationSignature(integrityFlag), true);
});

test("same-owner verification is never independent", () => {
  assert.throws(
    () => assertIndependentVerification("person:alice", "person:alice"),
    /cannot independently review their own Attempt/,
  );
  assert.doesNotThrow(() => assertIndependentVerification("person:alice", "person:bob"));
});

function fixture(publicKey) {
  return {
    protocolVersion: "pw-verification-attestation-v1",
    id: "attestation:fixture-1",
    assignmentId: "assignment:fixture-1",
    artifactBundleHash: sha("a"),
    claimType: "kernel_accepted",
    verifierPersonId: "person:bob",
    verifierAgentId: "agent:bob-reviewer",
    delegationCertificateId: "delegation:bob-reviewer",
    verifierAgentPublicKey: publicKey,
    decision: "attested",
    evidenceHash: sha("b"),
    attestedAt: "2026-07-13T00:00:00Z",
    payloadHash: sha("0"),
    signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  };
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}

function base64Url(buffer) {
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
