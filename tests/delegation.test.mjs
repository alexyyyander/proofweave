import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDelegationAllows,
  delegationPayloadHash,
  delegationSigningPayload,
  delegationValidityAt,
  normalizeDelegationCertificate,
  verifyDelegationSignature,
} from "../packages/domain/delegation.mjs";
import { canonicalJson } from "../packages/protocol/canonical-json.mjs";
import {
  personKeyProofChallengePayloadHash,
  personKeyProofChallengeSigningPayload,
  verifyPersonKeyProofChallengeSignature,
} from "../packages/protocol/person-key-proof.mjs";

const start = "2026-07-13T00:00:00Z";
const end = "2027-07-13T00:00:00Z";

test("canonical delegation payload is order-independent and hashes stably", async () => {
  const certificate = delegation({ scopes: ["review", "formalize", "prove"] });
  const normalized = normalizeDelegationCertificate(certificate);
  assert.deepEqual(normalized.scopes, ["formalize", "prove", "review"]);
  assert.equal(
    canonicalJson(delegationSigningPayload(certificate)),
    canonicalJson(delegationSigningPayload({ ...certificate, scopes: ["prove", "review", "formalize"] })),
  );
  assert.equal(
    await delegationPayloadHash(certificate),
    await delegationPayloadHash({ ...certificate, scopes: ["prove", "review", "formalize"] }),
  );
});

test("delegation signatures verify against the owner's public key", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const certificate = delegation();
  const signature = await crypto.subtle.sign(
    "Ed25519",
    pair.privateKey,
    new TextEncoder().encode(canonicalJson(delegationSigningPayload(certificate))),
  );
  const publicKey = await crypto.subtle.exportKey("raw", pair.publicKey);

  assert.equal(
    await verifyDelegationSignature({
      certificate,
      personPublicKey: base64Url(publicKey),
      personSignature: base64Url(signature),
    }),
    true,
  );
});

test("a one-time Person key challenge binds the key, nonce, and expiry into its signature", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = base64Url(await crypto.subtle.exportKey("raw", pair.publicKey));
  const challenge = {
    protocolVersion: "pw-person-key-proof-challenge-v1",
    id: "person-key-proof-challenge:alice-01",
    personId: "person:alice",
    personKeyId: "person-key:alice",
    personPublicKey: publicKey,
    nonce: base64Url(crypto.getRandomValues(new Uint8Array(32))),
    issuedAt: "2026-07-13T00:00:00Z",
    expiresAt: "2026-07-13T00:05:00Z",
  };
  const signature = base64Url(await crypto.subtle.sign(
    "Ed25519",
    pair.privateKey,
    new TextEncoder().encode(canonicalJson(personKeyProofChallengeSigningPayload(challenge))),
  ));

  assert.equal(await verifyPersonKeyProofChallengeSignature({
    challenge,
    personPublicKey: publicKey,
    personSignature: signature,
  }), true);
  assert.match(await personKeyProofChallengePayloadHash(challenge), /^sha256:[a-f0-9]{64}$/);
  assert.equal(await verifyPersonKeyProofChallengeSignature({
    challenge: { ...challenge, nonce: base64Url(crypto.getRandomValues(new Uint8Array(32))) },
    personPublicKey: publicKey,
    personSignature: signature,
  }), false);
});

test("a certificate is valid only during its interval and before revocation", () => {
  const certificate = delegation({ scopes: ["formalize"] });
  assert.deepEqual(delegationValidityAt(certificate, start), { valid: true, reason: null });
  assert.deepEqual(
    delegationValidityAt(certificate, "2026-07-12T23:59:59Z"),
    { valid: false, reason: "not_yet_valid" },
  );
  assert.deepEqual(
    delegationValidityAt(certificate, end),
    { valid: false, reason: "expired" },
  );
  assert.deepEqual(
    delegationValidityAt(certificate, "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z"),
    { valid: false, reason: "revoked" },
  );
  assert.throws(
    () => assertDelegationAllows(certificate, "review", "2026-08-01T00:00:00Z"),
    /does not grant review/,
  );
  assert.equal(
    assertDelegationAllows(certificate, "formalize", "2026-08-01T00:00:00Z").id,
    "pw:delegation:alice-prover-01",
  );
});

test("a certificate cannot credit another Person or grant duplicate scopes", () => {
  assert.throws(
    () => normalizeDelegationCertificate(delegation({ beneficiaryPersonId: "did:proofweave:bob" })),
    /beneficiary must be its owner/,
  );
  assert.throws(
    () => normalizeDelegationCertificate(delegation({ scopes: ["formalize", "formalize"] })),
    /invalid or duplicate scope/,
  );
});

function delegation({
  scopes = ["formalize", "prove", "review"],
  beneficiaryPersonId = "did:proofweave:alice",
} = {}) {
  return {
    id: "pw:delegation:alice-prover-01",
    ownerPersonId: "did:proofweave:alice",
    agentId: "urn:pw:agent:alice-prover-01",
    agentPublicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    scopes,
    validFrom: start,
    validUntil: end,
    attributionPolicy: {
      beneficiaryPersonId,
      mode: "agent_delegated",
    },
  };
}

function base64Url(buffer) {
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
