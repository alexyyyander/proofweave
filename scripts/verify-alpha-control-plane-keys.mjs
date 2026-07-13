import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { canonicalJson, canonicalUtf8 } from "../packages/protocol/canonical-json.mjs";
import { validateAlphaControlPlaneTopology } from "./preflight-alpha-control-plane.mjs";

const controlPlaneSecretName = "PROOFWEAVE_RUNNER_CONTROL_PLANE_PRIVATE_KEY_JWK";
const runnerResultSecretName = "PROOFWEAVE_RUNNER_RESULT_PRIVATE_KEY_JWK";

/**
 * Prove that deployment-only private JWKs can sign against the public keys
 * declared in the reviewed manifests. The function intentionally returns IDs
 * only and never serializes or logs key material.
 */
export async function verifyAlphaControlPlaneKeys({
  mcpManifest,
  runnerManifest,
  controlPlanePrivateKeyJwk,
  runnerResultPrivateKeyJwk,
} = {}) {
  const topology = validateAlphaControlPlaneTopology({ mcpManifest, runnerManifest });
  await assertPrivateKeyMatches({
    privateJwk: controlPlanePrivateKeyJwk,
    publicKey: runnerManifest.keys.control_plane_issuer.public_key,
    keyId: topology.runner.controlPlaneKeyId,
    role: "control-plane queue signing",
  });
  await assertPrivateKeyMatches({
    privateJwk: runnerResultPrivateKeyJwk,
    publicKey: runnerManifest.keys.runner_result.public_key,
    keyId: topology.runner.runnerResultKeyId,
    role: "Runner result signing",
  });
  return Object.freeze({
    controlPlaneKeyId: topology.runner.controlPlaneKeyId,
    runnerResultKeyId: topology.runner.runnerResultKeyId,
  });
}

async function main() {
  const [mcpPath, runnerPath] = process.argv.slice(2);
  if (!mcpPath || !runnerPath || process.argv.length !== 4) {
    throw new Error("Usage: node scripts/verify-alpha-control-plane-keys.mjs <mcp-manifest.json> <runner-manifest.json>");
  }
  const [mcpManifest, runnerManifest] = await Promise.all([
    readJson(mcpPath, "MCP control-plane manifest"),
    readJson(runnerPath, "Runner deployment manifest"),
  ]);
  const keys = await verifyAlphaControlPlaneKeys({
    mcpManifest,
    runnerManifest,
    controlPlanePrivateKeyJwk: readPrivateJwkSecret(controlPlaneSecretName),
    runnerResultPrivateKeyJwk: readPrivateJwkSecret(runnerResultSecretName),
  });
  process.stdout.write(`Verified deployment private-key pairing for ${keys.controlPlaneKeyId} and ${keys.runnerResultKeyId}.\n`);
}

async function assertPrivateKeyMatches({ privateJwk, publicKey, keyId, role }) {
  if (!isPrivateEd25519Jwk(privateJwk)) {
    throw new Error(`${role} secret must be an Ed25519 private JWK.`);
  }
  if (typeof publicKey !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(publicKey)) {
    throw new Error(`${role} manifest public key is invalid.`);
  }
  let privateKey;
  let verifier;
  try {
    [privateKey, verifier] = await Promise.all([
      crypto.subtle.importKey("jwk", privateJwk, { name: "Ed25519" }, false, ["sign"]),
      crypto.subtle.importKey("raw", base64UrlBytes(publicKey), { name: "Ed25519" }, false, ["verify"]),
    ]);
  } catch {
    throw new Error(`${role} key material could not be imported.`);
  }
  const payload = canonicalUtf8(canonicalJson({
    protocolVersion: "pw-alpha-deployment-key-pair-v1",
    role,
    keyId,
  }));
  let signature;
  try {
    signature = await crypto.subtle.sign("Ed25519", privateKey, payload);
  } catch {
    throw new Error(`${role} private key could not sign.`);
  }
  if (!await crypto.subtle.verify("Ed25519", verifier, signature, payload)) {
    throw new Error(`${role} private key does not match the manifest public key.`);
  }
}

function readPrivateJwkSecret(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0 || value.length > 8_192) {
    throw new Error(`${name} must be set as a bounded JSON secret.`);
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${name} must contain valid JSON.`);
  }
}

function isPrivateEd25519Jwk(value) {
  return Boolean(
    value && typeof value === "object" && !Array.isArray(value) &&
    value.kty === "OKP" && value.crv === "Ed25519" &&
    typeof value.x === "string" && /^[A-Za-z0-9_-]{43}$/.test(value.x) &&
    typeof value.d === "string" && /^[A-Za-z0-9_-]{43}$/.test(value.d),
  );
}

function base64UrlBytes(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(Buffer.from(padded, "base64"));
}

async function readJson(path, label) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (cause) {
    throw new Error(`${label} could not be read.`, { cause });
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Deployment key verification failed."}\n`);
    process.exitCode = 1;
  });
}
