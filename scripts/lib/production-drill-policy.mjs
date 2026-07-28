import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { canonicalJson } from "../../packages/protocol/canonical-json.mjs";

export const productionDrillPolicySchemaVersion = "pw-production-drill-policy-v2";
export const productionDrillPolicyPath = "config/production-drill-policy.json";

const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9:._+/-]{0,511}$/;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const projectIdPattern = /^appgprj_[a-f0-9]{32}$/;
const databaseFingerprintPattern = /^[a-f0-9]{16}$/;

export class ProductionDrillPolicyError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = "ProductionDrillPolicyError";
    this.code = code;
  }
}

export function loadProductionDrillPolicy({ root }) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(resolve(root, productionDrillPolicyPath), "utf8"));
  } catch (cause) {
    throw error("PRODUCTION_DRILL_POLICY_READ_FAILED", { cause });
  }
  return normalizeProductionDrillPolicy(parsed);
}

export function normalizeProductionDrillPolicy(value) {
  record(value, "PRODUCTION_DRILL_POLICY_INVALID");
  extraKeys(value, [
    "schemaVersion",
    "policyVersion",
    "githubRepository",
    "productionAuthorities",
    "recoveryOperatorKeys",
  ]);
  record(value.githubRepository, "PRODUCTION_DRILL_POLICY_INVALID");
  extraKeys(value.githubRepository, ["fullName", "id"]);
  record(value.productionAuthorities, "PRODUCTION_DRILL_POLICY_INVALID");
  extraKeys(value.productionAuthorities, ["site", "runner", "turso"]);
  record(value.productionAuthorities.site, "PRODUCTION_DRILL_POLICY_INVALID");
  extraKeys(value.productionAuthorities.site, ["origin", "projectId"]);
  record(value.productionAuthorities.runner, "PRODUCTION_DRILL_POLICY_INVALID");
  extraKeys(value.productionAuthorities.runner, ["origin"]);
  record(value.productionAuthorities.turso, "PRODUCTION_DRILL_POLICY_INVALID");
  extraKeys(value.productionAuthorities.turso, ["databaseFingerprint"]);
  const siteOrigin = normalizeHttpsOrigin(
    value.productionAuthorities.site.origin,
    "PRODUCTION_DRILL_POLICY_INVALID",
  );
  const runnerOrigin = value.productionAuthorities.runner.origin === null
    ? null
    : normalizeHttpsOrigin(
      value.productionAuthorities.runner.origin,
      "PRODUCTION_DRILL_POLICY_INVALID",
    );
  const databaseFingerprint = value.productionAuthorities.turso.databaseFingerprint;
  if (
    value.schemaVersion !== productionDrillPolicySchemaVersion
    || !Number.isSafeInteger(value.policyVersion)
    || value.policyVersion <= 0
    || !repositoryPattern.test(value.githubRepository.fullName ?? "")
    || !Number.isSafeInteger(value.githubRepository.id)
    || value.githubRepository.id <= 0
    || !projectIdPattern.test(value.productionAuthorities.site.projectId ?? "")
    || (
      databaseFingerprint !== null
      && !databaseFingerprintPattern.test(databaseFingerprint ?? "")
    )
    || !Array.isArray(value.recoveryOperatorKeys)
    || value.recoveryOperatorKeys.length > 32
  ) {
    throw error("PRODUCTION_DRILL_POLICY_INVALID");
  }
  const keys = value.recoveryOperatorKeys.map((entry) => {
    record(entry, "PRODUCTION_DRILL_POLICY_INVALID");
    extraKeys(entry, ["keyId", "publicKey", "keyFingerprint"]);
    if (
      typeof entry.keyId !== "string"
      || !identifierPattern.test(entry.keyId)
      || typeof entry.publicKey !== "string"
      || !/^[A-Za-z0-9_-]{43}$/.test(entry.publicKey)
      || Buffer.from(entry.publicKey, "base64url").length !== 32
      || Buffer.from(entry.publicKey, "base64url").toString("base64url") !== entry.publicKey
      || typeof entry.keyFingerprint !== "string"
      || !sha256Pattern.test(entry.keyFingerprint)
      || operatorKeyFingerprint(entry.publicKey) !== entry.keyFingerprint
    ) {
      throw error("PRODUCTION_DRILL_POLICY_INVALID");
    }
    return Object.freeze({
      keyId: entry.keyId,
      publicKey: entry.publicKey,
      keyFingerprint: entry.keyFingerprint,
    });
  }).sort((left, right) => left.keyId.localeCompare(right.keyId));
  if (new Set(keys.map((entry) => entry.keyId)).size !== keys.length) {
    throw error("PRODUCTION_DRILL_POLICY_INVALID");
  }
  return Object.freeze({
    schemaVersion: productionDrillPolicySchemaVersion,
    policyVersion: value.policyVersion,
    githubRepository: Object.freeze({
      fullName: value.githubRepository.fullName,
      id: value.githubRepository.id,
    }),
    productionAuthorities: Object.freeze({
      site: Object.freeze({
        origin: siteOrigin,
        projectId: value.productionAuthorities.site.projectId,
      }),
      runner: Object.freeze({
        origin: runnerOrigin,
      }),
      turso: Object.freeze({
        databaseFingerprint,
      }),
    }),
    recoveryOperatorKeys: Object.freeze(keys),
  });
}

export function requireEnrolledProductionAuthorities(policyValue) {
  const policy = normalizeProductionDrillPolicy(policyValue);
  if (policy.productionAuthorities.runner.origin === null) {
    throw error("PRODUCTION_RUNNER_AUTHORITY_NOT_ENROLLED");
  }
  if (policy.productionAuthorities.turso.databaseFingerprint === null) {
    throw error("PRODUCTION_TURSO_AUTHORITY_NOT_ENROLLED");
  }
  return policy.productionAuthorities;
}

export function productionDrillPolicyHash(policy) {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(normalizeProductionDrillPolicy(policy)))
    .digest("hex")}`;
}

export function collectGitOriginUrl({ root }) {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (cause) {
    throw error("PRODUCTION_DRILL_GIT_ORIGIN_MISSING", { cause });
  }
}

export function parseCanonicalGithubOrigin(value) {
  if (typeof value !== "string" || value.trim() !== value || /[\0\r\n]/.test(value)) {
    throw error("PRODUCTION_DRILL_GIT_ORIGIN_INVALID");
  }
  const patterns = [
    /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/,
    /^git@github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\.git$/,
    /^ssh:\/\/git@github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\.git$/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match) return match[1];
  }
  throw error("PRODUCTION_DRILL_GIT_ORIGIN_INVALID");
}

export function assertProductionDrillOrigin({ policy, originUrl }) {
  const repositoryFullName = parseCanonicalGithubOrigin(originUrl);
  if (repositoryFullName !== policy.githubRepository.fullName) {
    throw error("PRODUCTION_DRILL_GIT_ORIGIN_POLICY_MISMATCH");
  }
  return repositoryFullName;
}

export function operatorKeyFingerprint(publicKey) {
  return `sha256:${createHash("sha256")
    .update(Buffer.from(publicKey, "base64url"))
    .digest("hex")}`;
}

function normalizeHttpsOrigin(value, code) {
  if (
    typeof value !== "string"
    || value.length > 512
    || value.trim() !== value
    || /[\0\r\n\s]/.test(value)
  ) {
    throw error(code);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw error(code);
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== "" && url.pathname !== "/")
    || value !== url.origin
  ) {
    throw error(code);
  }
  return url.origin;
}

function record(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw error(code);
}

function extraKeys(value, allowed) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw error("PRODUCTION_DRILL_POLICY_INVALID");
  }
}

function error(code, options) {
  return new ProductionDrillPolicyError(code, options);
}
