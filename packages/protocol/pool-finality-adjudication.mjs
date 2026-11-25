import { canonicalJson, canonicalUtf8, sha256Canonical } from "./canonical-json.mjs";

/** Trust roots are enrolled only through a separately reviewed source change.
 * Empty means no project owner can currently authorize a settlement. */
export const trustedPoolFinalityAuthorities = Object.freeze([
  // { projectId, personId, keyId, keyFingerprint } entries require a separate
  // owner-authorized, independently reviewed source change.
].map((authority) => Object.freeze(authority)));
const sha = /^sha256:[0-9a-f]{64}$/;
const identifier = /^[A-Za-z0-9][A-Za-z0-9:._-]{2,519}$/;
const fields = ["protocolVersion", "poolId", "problemRevisionId", "finalReceiptId", "finalReceiptHash", "targetDeclaration", "targetStatementHash", "beneficiaryPersonId", "reviewerPersonId", "reviewerKeyId", "reviewAttestationId", "reviewAttestationHash", "reviewEvidenceHash", "noveltyAttestationId", "noveltyAttestationHash", "noveltyEvidenceHash", "ownerPersonId", "ownerKeyId", "issuedAt", "decision"];

export class PoolFinalityError extends Error {
  constructor(message) { super(message); this.name = "PoolFinalityError"; }
}

export function normalizePoolFinalityAdjudication(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !["payload", "reviewerSignature", "ownerSignature"].includes(key))) throw new PoolFinalityError("Finality adjudication is malformed.");
  const payload = value.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== fields.length || fields.some((key) => !Object.hasOwn(payload, key))) throw new PoolFinalityError("Finality payload is malformed.");
  if (payload.protocolVersion !== "pw-pool-finality-v1" || payload.decision !== "original_final_result") throw new PoolFinalityError("Finality decision is unsupported.");
  for (const key of ["poolId", "problemRevisionId", "finalReceiptId", "beneficiaryPersonId", "reviewerPersonId", "reviewerKeyId", "reviewAttestationId", "noveltyAttestationId", "ownerPersonId", "ownerKeyId"]) {
    if (typeof payload[key] !== "string" || !identifier.test(payload[key])) throw new PoolFinalityError("Finality identity is invalid.");
  }
  if (typeof payload.targetDeclaration !== "string" || payload.targetDeclaration.length > 520 || !/^[A-Za-z_][A-Za-z0-9_'.]*(?:\.[A-Za-z_][A-Za-z0-9_'.]*)*$/.test(payload.targetDeclaration)) throw new PoolFinalityError("Finality target declaration is invalid.");
  for (const key of ["finalReceiptHash", "targetStatementHash", "reviewAttestationHash", "reviewEvidenceHash", "noveltyAttestationHash", "noveltyEvidenceHash"]) if (typeof payload[key] !== "string" || !sha.test(payload[key])) throw new PoolFinalityError("Finality evidence hash is invalid.");
  if (payload.reviewerPersonId === payload.beneficiaryPersonId || payload.reviewerPersonId === payload.ownerPersonId) throw new PoolFinalityError("Finality reviewer must be independent of the beneficiary and owner.");
  if (typeof payload.issuedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(payload.issuedAt) || !Number.isFinite(Date.parse(payload.issuedAt))) throw new PoolFinalityError("Finality timestamp is invalid.");
  for (const key of ["reviewerSignature", "ownerSignature"]) decodeBase64Url(value[key], 64);
  return Object.freeze({ payload: Object.freeze(Object.fromEntries(fields.map((key) => [key, payload[key]]))), reviewerSignature: value.reviewerSignature, ownerSignature: value.ownerSignature });
}

export async function verifyPoolFinalitySignatures(adjudication, { reviewerPublicKey, ownerPublicKey }) {
  const normalized = normalizePoolFinalityAdjudication(adjudication);
  const bytes = canonicalUtf8(normalized.payload);
  return (await Promise.all([[reviewerPublicKey, normalized.reviewerSignature], [ownerPublicKey, normalized.ownerSignature]].map(async ([key, signature]) => {
    try {
      const publicKey = await crypto.subtle.importKey("raw", decodeBase64Url(key, 32), { name: "Ed25519" }, false, ["verify"]);
      return crypto.subtle.verify("Ed25519", publicKey, decodeBase64Url(signature, 64), bytes);
    } catch { return false; }
  }))).every(Boolean);
}

export async function poolFinalityHash(adjudication) { return sha256Canonical(normalizePoolFinalityAdjudication(adjudication)); }
export function canonicalPoolFinalityAdjudication(adjudication) { return canonicalJson(normalizePoolFinalityAdjudication(adjudication)); }
export function normalizePoolFinalityPayload(payload) {
  const emptySignature = "A".repeat(86); // 64 zero bytes, used only for shape validation.
  return normalizePoolFinalityAdjudication({ payload, reviewerSignature: emptySignature, ownerSignature: emptySignature }).payload;
}

function decodeBase64Url(value, expected) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new PoolFinalityError("Finality signature or key is invalid.");
  let binary;
  try { binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4)); } catch { throw new PoolFinalityError("Finality signature or key is invalid."); }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.length !== expected || btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "") !== value) throw new PoolFinalityError("Finality signature or key is invalid.");
  return bytes;
}
