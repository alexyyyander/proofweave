import { lstat, open } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { sha256Canonical } from "../../packages/protocol/canonical-json.mjs";
import {
  normalizeRuntimeRecoveryIsolationEvidence,
  runtimeRecoveryIsolationKeyFingerprint,
  runtimeRecoveryIsolationProtocolVersion,
  verifyRuntimeRecoveryIsolationEvidence,
} from "../../packages/protocol/runtime-recovery-isolation.mjs";
import {
  inspectRuntimeRecoveryIsolationAtDrillBegin,
} from "./github-recovery-surface-inspector.mjs";
import {
  assertProductionDrillOrigin,
  collectGitOriginUrl,
  loadProductionDrillPolicy,
  normalizeProductionDrillPolicy,
  productionDrillPolicyHash,
} from "./production-drill-policy.mjs";

export const recoveryIsolationOperatorKeysetVersion =
  "pw-runtime-recovery-operator-keyset-v1";

const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9:._+/-]{0,511}$/;
const maxPrivateJwkBytes = 16 * 1024;

export class GithubIndependentRecoveryIsolationError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = "GithubIndependentRecoveryIsolationError";
    this.code = code;
  }
}

export async function recoveryIsolationReleaseConfiguration({
  environment,
  root,
  policyBinding,
  policyProvider = ({ root: policyRoot }) => loadProductionDrillPolicy({ root: policyRoot }),
  gitOriginProvider = ({ root: originRoot }) => collectGitOriginUrl({ root: originRoot }),
}) {
  let policy;
  let originUrl;
  try {
    policy = normalizeProductionDrillPolicy(await policyProvider({ root }));
    originUrl = await gitOriginProvider({ root });
    assertProductionDrillOrigin({ policy, originUrl });
  } catch (cause) {
    throw error(cause?.code ?? "RECOVERY_POLICY_INVALID", { cause });
  }
  const policyHash = productionDrillPolicyHash(policy);
  let boundPolicyHash;
  try {
    boundPolicyHash = productionDrillPolicyHash(policyBinding?.policy);
  } catch {
    throw error("RECOVERY_POLICY_MANIFEST_MISMATCH");
  }
  if (
    policyBinding?.policyHash !== policyHash
    || boundPolicyHash !== policyHash
    || policyBinding.gitOriginRepositoryFullName
      !== policy.githubRepository.fullName
  ) {
    throw error("RECOVERY_POLICY_MANIFEST_MISMATCH");
  }
  assertOptionalExactSetting(
    environment,
    "PROOFWEAVE_DRILL_GITHUB_REPOSITORY",
    policy.githubRepository.fullName,
    "RECOVERY_REPOSITORY_ASSERTION_MISMATCH",
  );
  assertOptionalExactSetting(
    environment,
    "PROOFWEAVE_DRILL_GITHUB_REPOSITORY_ID",
    String(policy.githubRepository.id),
    "RECOVERY_REPOSITORY_ID_ASSERTION_MISMATCH",
  );
  if (environment?.PROOFWEAVE_DRILL_RECOVERY_TRUSTED_KEYS_JSON !== undefined) {
    const asserted = await normalizeTrustedOperatorKeyset(
      requiredSetting(
        environment,
        "PROOFWEAVE_DRILL_RECOVERY_TRUSTED_KEYS_JSON",
        "RECOVERY_TRUSTED_KEYS_ASSERTION_INVALID",
        64 * 1024,
      ),
      { allowEmpty: true },
    );
    const expected = Object.freeze({
      schemaVersion: recoveryIsolationOperatorKeysetVersion,
      keys: policy.recoveryOperatorKeys,
    });
    if (JSON.stringify(asserted) !== JSON.stringify(expected)) {
      throw error("RECOVERY_TRUSTED_KEYS_ASSERTION_MISMATCH");
    }
  }
  if (policy.recoveryOperatorKeys.length === 0) {
    throw error("RECOVERY_OPERATOR_KEYS_NOT_ENROLLED");
  }
  const trustedKeyset = Object.freeze({
    schemaVersion: recoveryIsolationOperatorKeysetVersion,
    keys: policy.recoveryOperatorKeys,
  });
  return Object.freeze({
    repositoryFullName: policy.githubRepository.fullName,
    repositoryId: policy.githubRepository.id,
    protocolVersion: runtimeRecoveryIsolationProtocolVersion,
    policy,
    policyVersion: policy.policyVersion,
    policyHash,
    trustedKeyset,
    trustedKeysetHash: await sha256Canonical(trustedKeyset),
  });
}

export async function beginRecoveryIsolationSnapshot({
  environment,
  release,
  releaseFingerprint,
  correlationId,
  subject,
  root,
  inspector = inspectRuntimeRecoveryIsolationAtDrillBegin,
  verifier = verifyRuntimeRecoveryIsolationEvidence,
  operatorPrivateKeyProvider = loadRecoveryIsolationOperatorPrivateKey,
  policyProvider,
  gitOriginProvider,
  now = new Date(),
}) {
  const configuration = await recoveryIsolationReleaseConfiguration({
    environment,
    root,
    policyBinding: {
      policy: release.productionDrillPolicy,
      policyHash: release.productionDrillPolicyHash,
      gitOriginRepositoryFullName: release.gitOriginRepositoryFullName,
    },
    policyProvider,
    gitOriginProvider,
  });
  const githubToken = requiredSetting(
    environment,
    "PROOFWEAVE_DRILL_GITHUB_TOKEN",
    "RECOVERY_GITHUB_TOKEN_MISSING",
    4_096,
  );
  const operatorKeyId = requiredIdentifier(
    environment.PROOFWEAVE_DRILL_RECOVERY_OPERATOR_KEY_ID,
    "RECOVERY_OPERATOR_KEY_ID_MISSING",
  );
  const operatorPrivateKeyJwk = await operatorPrivateKeyProvider({ environment, root });
  await assertOperatorPrivateKeyEnrollment({
    operatorPrivateKeyJwk,
    operatorKeyId,
    trustedKeys: configuration.trustedKeyset.keys,
  });
  let evidence;
  try {
    evidence = await inspector({
      phase: "begin",
      githubToken,
      repositoryFullName: configuration.repositoryFullName,
      releaseSha: release.gitSha,
      releaseFingerprint,
      correlationId,
      subject,
      repoRoot: root,
      operatorPrivateKeyJwk,
      operatorKeyId,
    });
  } catch (cause) {
    throw error("RECOVERY_ISOLATION_OBSERVATION_FAILED", { cause });
  }
  return bindVerifiedRecoveryIsolation({
    evidence,
    configuration,
    release,
    releaseFingerprint,
    correlationId,
    subject,
    verifier,
    now,
  });
}

export async function verifyPersistedRecoveryIsolation({
  recoveryIsolation,
  environment,
  release,
  releaseFingerprint,
  correlationId,
  subject,
  createdAt,
  verifier = verifyRuntimeRecoveryIsolationEvidence,
  root,
  policyProvider,
  gitOriginProvider,
  now = new Date(),
}) {
  const normalizedState = normalizeRecoveryIsolationState(recoveryIsolation);
  const actualHash = await sha256Canonical(normalizedState.evidence);
  if (actualHash !== normalizedState.evidenceHash) {
    throw error("RECOVERY_ISOLATION_EVIDENCE_HASH_MISMATCH");
  }
  const configuration = await recoveryIsolationReleaseConfiguration({
    environment,
    root,
    policyBinding: {
      policy: release.productionDrillPolicy,
      policyHash: release.productionDrillPolicyHash,
      gitOriginRepositoryFullName: release.gitOriginRepositoryFullName,
    },
    policyProvider,
    gitOriginProvider,
  });
  const bound = await bindVerifiedRecoveryIsolation({
    evidence: normalizedState.evidence,
    configuration,
    release,
    releaseFingerprint,
    correlationId,
    subject,
    verifier,
    now,
  });
  if (
    bound.evidenceHash !== normalizedState.evidenceHash
    || createdAt !== bound.evidence.drill.observedAt
  ) {
    throw error("RECOVERY_ISOLATION_STATE_BINDING_MISMATCH");
  }
  return bound;
}

export function normalizeRecoveryIsolationState(value) {
  record(value, "RECOVERY_ISOLATION_STATE_INVALID");
  extraKeys(value, ["evidenceHash", "evidence"], "RECOVERY_ISOLATION_STATE_INVALID");
  if (!sha256Pattern.test(value.evidenceHash ?? "")) {
    throw error("RECOVERY_ISOLATION_STATE_INVALID");
  }
  let evidence;
  try {
    evidence = normalizeRuntimeRecoveryIsolationEvidence(value.evidence);
  } catch (cause) {
    throw error("RECOVERY_ISOLATION_EVIDENCE_INVALID", { cause });
  }
  return Object.freeze({
    evidenceHash: value.evidenceHash,
    evidence,
  });
}

export async function loadRecoveryIsolationOperatorPrivateKey({ environment, root }) {
  const sourcePath = requiredSetting(
    environment,
    "PROOFWEAVE_DRILL_RECOVERY_OPERATOR_PRIVATE_KEY_JWK_FILE",
    "RECOVERY_OPERATOR_PRIVATE_KEY_FILE_MISSING",
    1_024,
  );
  if (!isAbsolute(sourcePath) || sourcePath.length > 1_024) {
    throw error("RECOVERY_OPERATOR_PRIVATE_KEY_FILE_INVALID");
  }
  const path = resolve(sourcePath);
  const relativePath = relative(resolve(root), path);
  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    throw error("RECOVERY_OPERATOR_PRIVATE_KEY_FILE_INSIDE_REPOSITORY");
  }
  let metadata;
  let source;
  let handle;
  try {
    if (
      !["aix", "darwin", "freebsd", "linux", "openbsd", "sunos"].includes(process.platform)
      || typeof process.getuid !== "function"
    ) {
      throw new Error("unsupported private-key file security platform");
    }
    const currentUid = process.getuid();
    metadata = await lstat(path);
    assertRecoveryIsolationOperatorKeyFileMetadata(metadata, { currentUid });
    handle = await open(path, "r");
    const openedMetadata = await handle.stat();
    assertRecoveryIsolationOperatorKeyFileMetadata(openedMetadata, { currentUid });
    if (
      openedMetadata.dev !== metadata.dev
      || openedMetadata.ino !== metadata.ino
      || openedMetadata.size <= 0
      || openedMetadata.size > maxPrivateJwkBytes
    ) {
      throw new Error("invalid key file");
    }
    source = await handle.readFile("utf8");
  } catch (cause) {
    throw error("RECOVERY_OPERATOR_PRIVATE_KEY_FILE_INVALID", { cause });
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
  try {
    const jwk = JSON.parse(source);
    record(jwk, "RECOVERY_OPERATOR_PRIVATE_KEY_INVALID");
    return jwk;
  } catch (cause) {
    if (cause instanceof GithubIndependentRecoveryIsolationError) throw cause;
    throw error("RECOVERY_OPERATOR_PRIVATE_KEY_INVALID", { cause });
  }
}

export function assertRecoveryIsolationOperatorKeyFileMetadata(metadata, { currentUid }) {
  if (
    !metadata
    || typeof metadata.isFile !== "function"
    || !metadata.isFile()
    || (typeof metadata.isSymbolicLink === "function" && metadata.isSymbolicLink())
    || !Number.isSafeInteger(currentUid)
    || !Number.isSafeInteger(metadata.uid)
    || metadata.uid !== currentUid
    || !Number.isSafeInteger(metadata.nlink)
    || metadata.nlink !== 1
    || (metadata.mode & 0o777) !== 0o600
  ) {
    throw new Error("invalid recovery operator key file metadata");
  }
}

async function bindVerifiedRecoveryIsolation({
  evidence,
  configuration,
  release,
  releaseFingerprint,
  correlationId,
  subject,
  verifier,
  now,
}) {
  let normalized;
  try {
    normalized = normalizeRuntimeRecoveryIsolationEvidence(evidence);
  } catch (cause) {
    throw error("RECOVERY_ISOLATION_EVIDENCE_INVALID", { cause });
  }
  const verification = await verifier(normalized, {
    trustedOperatorKeys: configuration.trustedKeyset.keys,
    now,
    expectedReleaseSha: release.gitSha,
    expectedReleaseFingerprint: releaseFingerprint,
    expectedCorrelationId: correlationId,
    expectedSubject: subject,
  });
  if (!verification?.valid || !verification.evidence) {
    const reason = typeof verification?.reason === "string"
      ? verification.reason.toUpperCase().replace(/[^A-Z0-9_]/g, "_")
      : "INVALID";
    throw error(`RECOVERY_ISOLATION_${reason}`);
  }
  if (
    normalized.githubObservation.repositoryFullName !== configuration.repositoryFullName
    || normalized.githubObservation.repositoryId !== configuration.repositoryId
    || normalized.release.gitSha !== release.gitSha
    || normalized.release.fingerprint !== releaseFingerprint
    || normalized.drill.correlationId !== correlationId
    || normalized.drill.subject.personId !== subject.personId
    || normalized.drill.subject.agentId !== subject.agentId
    || normalized.drill.subject.artifactBundleHash !== subject.artifactBundleHash
  ) {
    throw error("RECOVERY_ISOLATION_BINDING_MISMATCH");
  }
  const evidenceHash = await sha256Canonical(normalized);
  return Object.freeze({
    evidenceHash,
    evidence: normalized,
    productionEligible: verification.productionEligible === true,
  });
}

async function normalizeTrustedOperatorKeyset(source, { allowEmpty = false } = {}) {
  let value;
  try {
    value = JSON.parse(source);
  } catch (cause) {
    throw error("RECOVERY_TRUSTED_KEYS_INVALID", { cause });
  }
  record(value, "RECOVERY_TRUSTED_KEYS_INVALID");
  extraKeys(value, ["schemaVersion", "keys"], "RECOVERY_TRUSTED_KEYS_INVALID");
  if (
    value.schemaVersion !== recoveryIsolationOperatorKeysetVersion
    || !Array.isArray(value.keys)
    || (!allowEmpty && value.keys.length === 0)
    || value.keys.length > 32
  ) {
    throw error("RECOVERY_TRUSTED_KEYS_INVALID");
  }
  const keys = [];
  for (const entry of value.keys) {
    record(entry, "RECOVERY_TRUSTED_KEYS_INVALID");
    extraKeys(entry, ["keyId", "publicKey", "keyFingerprint"], "RECOVERY_TRUSTED_KEYS_INVALID");
    const keyId = requiredIdentifier(entry.keyId, "RECOVERY_TRUSTED_KEYS_INVALID");
    if (
      typeof entry.publicKey !== "string"
      || !/^[A-Za-z0-9_-]{43}$/.test(entry.publicKey)
      || typeof entry.keyFingerprint !== "string"
      || !sha256Pattern.test(entry.keyFingerprint)
    ) {
      throw error("RECOVERY_TRUSTED_KEYS_INVALID");
    }
    let fingerprint;
    try {
      fingerprint = await runtimeRecoveryIsolationKeyFingerprint(entry.publicKey);
    } catch (cause) {
      throw error("RECOVERY_TRUSTED_KEYS_INVALID", { cause });
    }
    if (fingerprint !== entry.keyFingerprint) {
      throw error("RECOVERY_TRUSTED_KEYS_INVALID");
    }
    keys.push(Object.freeze({
      keyId,
      publicKey: entry.publicKey,
      keyFingerprint: entry.keyFingerprint,
    }));
  }
  keys.sort((left, right) => left.keyId.localeCompare(right.keyId));
  if (new Set(keys.map((entry) => entry.keyId)).size !== keys.length) {
    throw error("RECOVERY_TRUSTED_KEYS_INVALID");
  }
  return Object.freeze({
    schemaVersion: recoveryIsolationOperatorKeysetVersion,
    keys: Object.freeze(keys),
  });
}

async function assertOperatorPrivateKeyEnrollment({
  operatorPrivateKeyJwk,
  operatorKeyId,
  trustedKeys,
}) {
  if (
    !operatorPrivateKeyJwk
    || operatorPrivateKeyJwk.kty !== "OKP"
    || operatorPrivateKeyJwk.crv !== "Ed25519"
    || typeof operatorPrivateKeyJwk.d !== "string"
    || typeof operatorPrivateKeyJwk.x !== "string"
  ) {
    throw error("RECOVERY_OPERATOR_PRIVATE_KEY_INVALID");
  }
  let publicKey;
  let fingerprint;
  try {
    const bytes = Buffer.from(operatorPrivateKeyJwk.x, "base64url");
    if (
      bytes.length !== 32
      || bytes.toString("base64url") !== operatorPrivateKeyJwk.x
    ) {
      throw new Error("non-canonical operator public key");
    }
    publicKey = bytes.toString("base64url");
    fingerprint = await runtimeRecoveryIsolationKeyFingerprint(publicKey);
  } catch (cause) {
    throw error("RECOVERY_OPERATOR_PRIVATE_KEY_INVALID", { cause });
  }
  const enrolled = trustedKeys.find((entry) => entry.keyId === operatorKeyId);
  if (!enrolled) throw error("RECOVERY_OPERATOR_KEY_ID_NOT_ENROLLED");
  if (
    enrolled.publicKey !== publicKey
    || enrolled.keyFingerprint !== fingerprint
  ) {
    throw error("RECOVERY_OPERATOR_KEY_NOT_ENROLLED");
  }
}

function requiredSetting(environment, name, code, maximumLength) {
  const value = environment?.[name];
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maximumLength
    || value.trim() !== value
    || /[\0\r\n]/.test(value)
  ) {
    throw error(code);
  }
  return value;
}

function requiredIdentifier(value, code) {
  if (typeof value !== "string" || !identifierPattern.test(value)) throw error(code);
  return value;
}

function assertOptionalExactSetting(environment, name, expected, code) {
  const value = environment?.[name];
  if (value === undefined) return;
  if (
    typeof value !== "string"
    || value !== expected
    || value.trim() !== value
    || /[\0\r\n]/.test(value)
  ) {
    throw error(code);
  }
}

function record(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw error(code);
}

function extraKeys(value, allowed, code) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw error(code);
}

function error(code, options) {
  return new GithubIndependentRecoveryIsolationError(code, options);
}
