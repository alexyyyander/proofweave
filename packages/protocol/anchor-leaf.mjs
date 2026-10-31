// packages/protocol/anchor-leaf.mjs
import { canonicalJson } from "./canonical-json.mjs";

export const anchorLeafProtocolVersion = "pw-anchor-leaf-v1";

export const anchorRecordTypes = Object.freeze([
  "contribution_receipt",
  "research_checkpoint",
  "evidence_bundle",
]);

export class AnchorLeafProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "AnchorLeafProtocolError";
  }
}

export function normalizeAnchorLeaf(leaf) {
  rejectExtraKeys(leaf, ["protocolVersion", "recordType", "recordId", "recordHash"], "Anchor leaf");
  if (leaf.protocolVersion !== anchorLeafProtocolVersion) {
    throw new AnchorLeafProtocolError(`Anchor leaf protocolVersion must be ${anchorLeafProtocolVersion}.`);
  }
  if (!anchorRecordTypes.includes(leaf.recordType)) {
    throw new AnchorLeafProtocolError(`Anchor leaf recordType ${leaf.recordType} is not supported.`);
  }
  if (typeof leaf.recordId !== "string" || leaf.recordId.length === 0 || leaf.recordId.length > 256) {
    throw new AnchorLeafProtocolError("Anchor leaf recordId must be a non-empty string of at most 256 characters.");
  }
  requireSha256(leaf.recordHash, "Anchor leaf recordHash");
  return Object.freeze({
    protocolVersion: anchorLeafProtocolVersion,
    recordType: leaf.recordType,
    recordId: leaf.recordId,
    recordHash: leaf.recordHash,
  });
}

/** sha256(0x00 ‖ canonicalJson(leaf)) — the RFC6962 leaf step, done exactly once here. */
export async function anchorLeafHash(leaf) {
  const normalized = normalizeAnchorLeaf(leaf);
  const leafBytes = new TextEncoder().encode(canonicalJson(normalized));
  const prefixed = new Uint8Array(leafBytes.length + 1);
  prefixed[0] = 0x00;
  prefixed.set(leafBytes, 1);
  return toSha256Hex(new Uint8Array(await crypto.subtle.digest("SHA-256", prefixed)));
}

export function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new AnchorLeafProtocolError(`${label} must be sha256:<hex>.`);
  }
  return value;
}

function rejectExtraKeys(value, allowed, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AnchorLeafProtocolError(`${label} must be a plain object.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new AnchorLeafProtocolError(`${label} has unsupported field ${key}.`);
  }
}

function toSha256Hex(bytes) {
  return `sha256:${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
