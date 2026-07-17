export class RunnerKeyRegistryError extends Error {
  constructor(message) {
    super(message);
    this.name = "RunnerKeyRegistryError";
  }
}

/**
 * The immutable fingerprint stored with an operator-provisioned Runner public
 * key. It hashes the decoded 32-byte Ed25519 key, not a display encoding.
 */
export async function runnerKeyFingerprint(publicKey) {
  const bytes = decodeRunnerPublicKey(publicKey);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function normalizeRunnerKeyId(value, label = "Runner key ID") {
  if (typeof value !== "string" || value.length === 0 || value.length > 240 || /[\0\r\n]/.test(value)) {
    throw new RunnerKeyRegistryError(`${label} must be a bounded identifier.`);
  }
  return value;
}

export function normalizeRunnerPublicKey(value, label = "Runner public key") {
  decodeRunnerPublicKey(value, label);
  return value;
}

function decodeRunnerPublicKey(value, label = "Runner public key") {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value) || /^A{43}$/.test(value)) {
    throw new RunnerKeyRegistryError(`${label} must be a 32-byte base64url Ed25519 public key.`);
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  let decoded;
  try {
    decoded = atob(padded);
  } catch {
    throw new RunnerKeyRegistryError(`${label} must be valid base64url.`);
  }
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (bytes.length !== 32) {
    throw new RunnerKeyRegistryError(`${label} must decode to 32 bytes.`);
  }
  const canonical = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  if (canonical !== value) {
    throw new RunnerKeyRegistryError(`${label} must use canonical base64url encoding.`);
  }
  return bytes;
}
