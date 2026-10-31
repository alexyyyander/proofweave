// packages/protocol/anchor-witness.mjs
import { canonicalUtf8 } from "./canonical-json.mjs";

export const anchorWitnessProtocolVersion = "pw-anchor-witness-v1";

export class AnchorWitnessError extends Error {
  constructor(message) {
    super(message);
    this.name = "AnchorWitnessError";
  }
}

export function anchorWitnessSigningPayload({ batchId, root, manifestHash, txRef }) {
  for (const [key, value] of Object.entries({ batchId, root, manifestHash, txRef })) {
    if (typeof value !== "string" || value.length === 0) {
      throw new AnchorWitnessError(`Anchor witness ${key} must be a non-empty string.`);
    }
  }
  return Object.freeze({ protocolVersion: anchorWitnessProtocolVersion, batchId, root, manifestHash, txRef });
}

export async function signAnchorWitness(payload, privateKey) {
  try {
    return toBase64Url(await crypto.subtle.sign("Ed25519", privateKey, canonicalUtf8(payload)));
  } catch {
    throw new AnchorWitnessError("privateKey must be an Ed25519 signing key.");
  }
}

export async function verifyAnchorWitnessSignature(payload, signature, publicKey) {
  try {
    return await crypto.subtle.verify("Ed25519", publicKey, fromBase64Url(signature), canonicalUtf8(payload));
  } catch {
    return false;
  }
}

function toBase64Url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
