import { canonicalUtf8, sha256Canonical } from "./canonical-json.mjs";

export const runtimeRecoveryIsolationProtocolVersion = "pw-runtime-recovery-isolation-v1";
export const runtimeRecoveryIsolationActiveStates = Object.freeze([
  "in_progress",
  "pending",
  "queued",
  "requested",
  "waiting",
]);
export const runtimeRecoveryIsolationMaximumTtlMilliseconds = 2 * 60 * 60 * 1_000;

export class RuntimeRecoveryIsolationProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "RuntimeRecoveryIsolationProtocolError";
  }
}

export async function runtimeRecoveryIsolationKeyFingerprint(publicKey) {
  const digest = await crypto.subtle.digest("SHA-256", decodeBase64Url(publicKey, 32, "Operator public key"));
  return `sha256:${toHex(new Uint8Array(digest))}`;
}

export function normalizeRuntimeRecoveryIsolationEvidence(evidence) {
  requireRecord(evidence, "Runtime recovery isolation evidence");
  rejectExtraKeys(evidence, [
    "protocolVersion",
    "evidenceId",
    "productionEligible",
    "release",
    "drill",
    "surfaceManifest",
    "githubObservation",
    "operatorAttestation",
  ], "Runtime recovery isolation evidence");
  if (evidence.protocolVersion !== runtimeRecoveryIsolationProtocolVersion) {
    throw new RuntimeRecoveryIsolationProtocolError("Unsupported runtime recovery isolation protocol version.");
  }
  requireIdentifier(evidence.evidenceId, "Evidence id");
  if (typeof evidence.productionEligible !== "boolean") {
    throw new RuntimeRecoveryIsolationProtocolError("productionEligible must be boolean.");
  }

  const release = normalizeRelease(evidence.release);
  const drill = normalizeDrill(evidence.drill);
  const surfaceManifest = normalizeSurfaceManifest(evidence.surfaceManifest);
  const githubObservation = normalizeGithubObservation(evidence.githubObservation);
  const operatorAttestation = normalizeOperatorAttestation(evidence.operatorAttestation);

  return deepFreeze({
    protocolVersion: runtimeRecoveryIsolationProtocolVersion,
    evidenceId: evidence.evidenceId,
    productionEligible: evidence.productionEligible,
    release,
    drill,
    surfaceManifest,
    githubObservation,
    operatorAttestation,
  });
}

export function runtimeRecoveryIsolationSigningPayload(evidence) {
  const normalized = normalizeRuntimeRecoveryIsolationEvidence(evidence);
  return {
    protocolVersion: normalized.protocolVersion,
    evidenceId: normalized.evidenceId,
    productionEligible: normalized.productionEligible,
    release: normalized.release,
    drill: normalized.drill,
    surfaceManifest: normalized.surfaceManifest,
    githubObservation: normalized.githubObservation,
    operatorAttestation: {
      keyId: normalized.operatorAttestation.keyId,
      publicKey: normalized.operatorAttestation.publicKey,
      keyFingerprint: normalized.operatorAttestation.keyFingerprint,
      signedAt: normalized.operatorAttestation.signedAt,
    },
  };
}

export async function runtimeRecoveryIsolationPayloadHash(evidence) {
  return sha256Canonical(runtimeRecoveryIsolationSigningPayload(evidence));
}

export async function signRuntimeRecoveryIsolationEvidence(unsignedEvidence, {
  operatorPrivateKeyJwk,
  operatorKeyId,
  signedAt = new Date().toISOString(),
} = {}) {
  requireRecord(operatorPrivateKeyJwk, "Operator private key JWK");
  requireIdentifier(operatorKeyId, "Operator key id");
  requireUtcInstant(signedAt, "Operator signedAt");
  if (
    operatorPrivateKeyJwk.kty !== "OKP"
    || operatorPrivateKeyJwk.crv !== "Ed25519"
    || typeof operatorPrivateKeyJwk.d !== "string"
    || typeof operatorPrivateKeyJwk.x !== "string"
  ) {
    throw new RuntimeRecoveryIsolationProtocolError("Operator private key JWK must be an Ed25519 private JWK.");
  }
  const publicKey = encodeBase64Url(decodeBase64Url(operatorPrivateKeyJwk.x, 32, "Operator public key"));
  const keyFingerprint = await runtimeRecoveryIsolationKeyFingerprint(publicKey);
  const candidate = {
    ...unsignedEvidence,
    operatorAttestation: {
      keyId: operatorKeyId,
      publicKey,
      keyFingerprint,
      signedAt,
      payloadHash: `sha256:${"0".repeat(64)}`,
      signature: "A".repeat(86),
    },
  };
  const payloadHash = await runtimeRecoveryIsolationPayloadHash(candidate);
  const privateKey = await importPrivateKey(operatorPrivateKeyJwk);
  const signature = encodeBase64Url(new Uint8Array(await crypto.subtle.sign(
    "Ed25519",
    privateKey,
    canonicalUtf8(runtimeRecoveryIsolationSigningPayload(candidate)),
  )));
  return normalizeRuntimeRecoveryIsolationEvidence({
    ...candidate,
    operatorAttestation: {
      ...candidate.operatorAttestation,
      payloadHash,
      signature,
    },
  });
}

/**
 * Pure, offline verification. Trust is supplied by the caller rather than
 * inferred from the self-declared key embedded in the evidence.
 */
export async function verifyRuntimeRecoveryIsolationEvidence(evidence, {
  trustedOperatorKeys,
  now = new Date(),
  expectedReleaseSha,
  expectedReleaseFingerprint,
  expectedCorrelationId,
  maximumTtlMilliseconds = runtimeRecoveryIsolationMaximumTtlMilliseconds,
} = {}) {
  try {
    const normalized = normalizeRuntimeRecoveryIsolationEvidence(evidence);
    const nowMilliseconds = normalizeNow(now);
    const observedAt = Date.parse(normalized.drill.observedAt);
    const validUntil = Date.parse(normalized.drill.validUntil);
    const signedAt = Date.parse(normalized.operatorAttestation.signedAt);
    if (validUntil <= observedAt || validUntil - observedAt > maximumTtlMilliseconds) {
      return invalid("ttl_invalid");
    }
    if (signedAt < observedAt || signedAt > validUntil || nowMilliseconds > validUntil) {
      return invalid("evidence_expired");
    }
    if (expectedReleaseSha && normalized.release.gitSha !== expectedReleaseSha) {
      return invalid("release_mismatch");
    }
    if (expectedReleaseFingerprint && normalized.release.fingerprint !== expectedReleaseFingerprint) {
      return invalid("release_fingerprint_mismatch");
    }
    if (expectedCorrelationId && normalized.drill.correlationId !== expectedCorrelationId) {
      return invalid("correlation_mismatch");
    }
    if (normalized.githubObservation.releaseSha !== normalized.release.gitSha) {
      return invalid("observation_release_mismatch");
    }
    if (normalized.surfaceManifest.hash !== await sha256Canonical({
      workflows: normalized.surfaceManifest.workflows,
    })) {
      return invalid("surface_manifest_hash_mismatch");
    }
    if (!observationMatchesManifest(normalized)) {
      return invalid("surface_observation_mismatch");
    }
    if (normalized.operatorAttestation.keyFingerprint
      !== await runtimeRecoveryIsolationKeyFingerprint(normalized.operatorAttestation.publicKey)) {
      return invalid("operator_fingerprint_mismatch");
    }
    const trustedKey = normalizeTrustedOperatorKeys(trustedOperatorKeys).find((entry) =>
      entry.keyId === normalized.operatorAttestation.keyId
      && entry.publicKey === normalized.operatorAttestation.publicKey
      && entry.keyFingerprint === normalized.operatorAttestation.keyFingerprint
    );
    if (!trustedKey) return invalid("operator_untrusted");
    if (
      normalized.operatorAttestation.payloadHash
      !== await runtimeRecoveryIsolationPayloadHash(normalized)
    ) {
      return invalid("payload_hash_mismatch");
    }
    const key = await crypto.subtle.importKey(
      "raw",
      decodeBase64Url(normalized.operatorAttestation.publicKey, 32, "Operator public key"),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const signatureValid = await crypto.subtle.verify(
      "Ed25519",
      key,
      decodeBase64Url(normalized.operatorAttestation.signature, 64, "Operator signature"),
      canonicalUtf8(runtimeRecoveryIsolationSigningPayload(normalized)),
    );
    if (!signatureValid) return invalid("signature_invalid");
    return Object.freeze({
      valid: true,
      productionEligible: normalized.productionEligible,
      reason: null,
      evidence: normalized,
    });
  } catch {
    return invalid("malformed_evidence");
  }
}

function normalizeRelease(value) {
  requireRecord(value, "Release");
  rejectExtraKeys(value, ["gitSha", "fingerprint"], "Release");
  if (typeof value.gitSha !== "string" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value.gitSha)) {
    throw new RuntimeRecoveryIsolationProtocolError("Release gitSha must be a 40- or 64-character lowercase hex revision.");
  }
  requireSha256(value.fingerprint, "Release fingerprint");
  return { gitSha: value.gitSha, fingerprint: value.fingerprint };
}

function normalizeDrill(value) {
  requireRecord(value, "Drill");
  rejectExtraKeys(value, ["correlationId", "observedAt", "validUntil"], "Drill");
  requireIdentifier(value.correlationId, "Drill correlation id");
  requireUtcInstant(value.observedAt, "Drill observedAt");
  requireUtcInstant(value.validUntil, "Drill validUntil");
  return {
    correlationId: value.correlationId,
    observedAt: value.observedAt,
    validUntil: value.validUntil,
  };
}

function normalizeSurfaceManifest(value) {
  requireRecord(value, "Surface manifest");
  rejectExtraKeys(value, ["hash", "workflows"], "Surface manifest");
  requireSha256(value.hash, "Surface manifest hash");
  if (!Array.isArray(value.workflows) || value.workflows.length === 0 || value.workflows.length > 32) {
    throw new RuntimeRecoveryIsolationProtocolError("Surface manifest must contain 1 to 32 workflows.");
  }
  const workflows = value.workflows.map((entry) => {
    requireRecord(entry, "Surface manifest workflow");
    rejectExtraKeys(entry, ["path", "role", "sourceSha256"], "Surface manifest workflow");
    requireWorkflowPath(entry.path);
    requireIdentifier(entry.role, "Surface manifest workflow role");
    requireSha256(entry.sourceSha256, "Surface manifest workflow sourceSha256");
    return { path: entry.path, role: entry.role, sourceSha256: entry.sourceSha256 };
  });
  requireStrictPathOrder(workflows, "Surface manifest workflows");
  return { hash: value.hash, workflows };
}

function normalizeGithubObservation(value) {
  requireRecord(value, "GitHub observation");
  rejectExtraKeys(value, [
    "repositoryId",
    "repositoryFullName",
    "apiVersion",
    "releaseSha",
    "workflows",
  ], "GitHub observation");
  if (!Number.isSafeInteger(value.repositoryId) || value.repositoryId <= 0) {
    throw new RuntimeRecoveryIsolationProtocolError("GitHub repositoryId must be a positive integer.");
  }
  if (typeof value.repositoryFullName !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repositoryFullName)) {
    throw new RuntimeRecoveryIsolationProtocolError("GitHub repositoryFullName must be owner/repository.");
  }
  if (value.apiVersion !== "2022-11-28") {
    throw new RuntimeRecoveryIsolationProtocolError("GitHub API version is unsupported.");
  }
  if (typeof value.releaseSha !== "string" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value.releaseSha)) {
    throw new RuntimeRecoveryIsolationProtocolError("GitHub observation releaseSha is invalid.");
  }
  if (!Array.isArray(value.workflows) || value.workflows.length === 0 || value.workflows.length > 32) {
    throw new RuntimeRecoveryIsolationProtocolError("GitHub observation must contain 1 to 32 workflows.");
  }
  const workflows = value.workflows.map((entry) => {
    requireRecord(entry, "GitHub observed workflow");
    rejectExtraKeys(entry, [
      "workflowId",
      "path",
      "sourceBlobSha",
      "state",
      "activeRuns",
    ], "GitHub observed workflow");
    if (!Number.isSafeInteger(entry.workflowId) || entry.workflowId <= 0) {
      throw new RuntimeRecoveryIsolationProtocolError("GitHub workflowId must be a positive integer.");
    }
    requireWorkflowPath(entry.path);
    if (typeof entry.sourceBlobSha !== "string" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(entry.sourceBlobSha)) {
      throw new RuntimeRecoveryIsolationProtocolError("GitHub sourceBlobSha is invalid.");
    }
    if (entry.state !== "disabled_manually") {
      throw new RuntimeRecoveryIsolationProtocolError("Every recovery workflow must be disabled_manually.");
    }
    requireRecord(entry.activeRuns, "GitHub active run counts");
    rejectExtraKeys(entry.activeRuns, runtimeRecoveryIsolationActiveStates, "GitHub active run counts");
    const activeRuns = {};
    for (const state of runtimeRecoveryIsolationActiveStates) {
      if (!Number.isSafeInteger(entry.activeRuns[state]) || entry.activeRuns[state] !== 0) {
        throw new RuntimeRecoveryIsolationProtocolError("Every active GitHub workflow state must have zero runs.");
      }
      activeRuns[state] = 0;
    }
    return {
      workflowId: entry.workflowId,
      path: entry.path,
      sourceBlobSha: entry.sourceBlobSha,
      state: entry.state,
      activeRuns,
    };
  });
  requireStrictPathOrder(workflows, "GitHub observed workflows");
  return {
    repositoryId: value.repositoryId,
    repositoryFullName: value.repositoryFullName,
    apiVersion: value.apiVersion,
    releaseSha: value.releaseSha,
    workflows,
  };
}

function normalizeOperatorAttestation(value) {
  requireRecord(value, "Operator attestation");
  rejectExtraKeys(value, [
    "keyId",
    "publicKey",
    "keyFingerprint",
    "signedAt",
    "payloadHash",
    "signature",
  ], "Operator attestation");
  requireIdentifier(value.keyId, "Operator key id");
  const publicKey = encodeBase64Url(decodeBase64Url(value.publicKey, 32, "Operator public key"));
  requireSha256(value.keyFingerprint, "Operator key fingerprint");
  requireUtcInstant(value.signedAt, "Operator signedAt");
  requireSha256(value.payloadHash, "Operator payloadHash");
  const signature = encodeBase64Url(decodeBase64Url(value.signature, 64, "Operator signature"));
  return {
    keyId: value.keyId,
    publicKey,
    keyFingerprint: value.keyFingerprint,
    signedAt: value.signedAt,
    payloadHash: value.payloadHash,
    signature,
  };
}

function observationMatchesManifest(evidence) {
  const manifest = evidence.surfaceManifest.workflows;
  const observed = evidence.githubObservation.workflows;
  if (manifest.length !== observed.length) return false;
  return manifest.every((entry, index) => (
    entry.path === observed[index].path
    && observed[index].state === "disabled_manually"
    && runtimeRecoveryIsolationActiveStates.every((state) => observed[index].activeRuns[state] === 0)
  ));
}

function normalizeTrustedOperatorKeys(keys) {
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 32) {
    throw new RuntimeRecoveryIsolationProtocolError("At least one trusted operator key is required.");
  }
  return keys.map((entry) => {
    requireRecord(entry, "Trusted operator key");
    rejectExtraKeys(entry, ["keyId", "publicKey", "keyFingerprint"], "Trusted operator key");
    requireIdentifier(entry.keyId, "Trusted operator key id");
    const publicKey = encodeBase64Url(decodeBase64Url(entry.publicKey, 32, "Trusted operator public key"));
    requireSha256(entry.keyFingerprint, "Trusted operator key fingerprint");
    return { keyId: entry.keyId, publicKey, keyFingerprint: entry.keyFingerprint };
  });
}

async function importPrivateKey(jwk) {
  try {
    return await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "Ed25519" },
      false,
      ["sign"],
    );
  } catch {
    throw new RuntimeRecoveryIsolationProtocolError("Operator private key JWK could not be imported.");
  }
}

function normalizeNow(value) {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new RuntimeRecoveryIsolationProtocolError("Verification time is invalid.");
  }
  return milliseconds;
}

function invalid(reason) {
  return Object.freeze({ valid: false, productionEligible: false, reason, evidence: null });
}

function requireStrictPathOrder(entries, label) {
  for (let index = 0; index < entries.length; index += 1) {
    if (index > 0 && entries[index - 1].path >= entries[index].path) {
      throw new RuntimeRecoveryIsolationProtocolError(`${label} must be uniquely sorted by path.`);
    }
  }
}

function requireWorkflowPath(value) {
  if (
    typeof value !== "string"
    || !/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(value)
    || value.includes("..")
  ) {
    throw new RuntimeRecoveryIsolationProtocolError("Workflow path is invalid.");
  }
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeRecoveryIsolationProtocolError(`${label} must be an object.`);
  }
}

function rejectExtraKeys(value, allowed, label) {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) {
    throw new RuntimeRecoveryIsolationProtocolError(`${label} contains unsupported field ${extra}.`);
  }
}

function requireIdentifier(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 240
    || value.trim() !== value
    || /[\0\r\n]/.test(value)
  ) {
    throw new RuntimeRecoveryIsolationProtocolError(`${label} must be a bounded identifier.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new RuntimeRecoveryIsolationProtocolError(`${label} must be sha256:<hex>.`);
  }
}

function requireUtcInstant(value, label) {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value))
  ) {
    throw new RuntimeRecoveryIsolationProtocolError(`${label} must be an ISO-8601 UTC instant with milliseconds.`);
  }
}

function decodeBase64Url(value, expectedLength, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value) || value.includes("=")) {
    throw new RuntimeRecoveryIsolationProtocolError(`${label} must be unpadded base64url.`);
  }
  let binary;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    binary = atob(padded);
  } catch {
    throw new RuntimeRecoveryIsolationProtocolError(`${label} must be valid base64url.`);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength !== expectedLength || encodeBase64Url(bytes) !== value) {
    throw new RuntimeRecoveryIsolationProtocolError(`${label} has an invalid length or encoding.`);
  }
  return bytes;
}

function encodeBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}
