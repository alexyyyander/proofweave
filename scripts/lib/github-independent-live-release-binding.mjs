const diagnosticsSchemaVersion = "pw-live-release-diagnostics-v1";
const diagnosticsKeys = Object.freeze([
  "authority",
  "databaseFingerprint",
  "failureCode",
  "ledgerHead",
  "schemaVersion",
  "state",
]);
const runnerPolicyKeys = Object.freeze([
  "approvedImages",
  "sandboxImageApproved",
  "sandboxImageDigest",
  "state",
  "templateBuildId",
  "templateId",
]);
const approvedImageKeys = Object.freeze([
  "imageDigest",
  "leanToolchain",
  "mathlibRevision",
]);
const fingerprintPattern = /^[a-f0-9]{16}$/;
const ledgerHeadPattern = /^\d{4}_[a-z0-9_]+\.sql$/;
const revisionPattern = /^[a-f0-9]{40,64}$/;
const imageDigestPattern = /^[A-Za-z0-9][A-Za-z0-9./:_-]*@sha256:[a-f0-9]{64}$/;
const publicLabelPattern = /^[A-Za-z0-9][A-Za-z0-9:._+/-]{0,319}$/;
const maxJsonBytes = 65_536;

export class GithubIndependentLiveReleaseBindingError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = "GithubIndependentLiveReleaseBindingError";
    this.code = code;
  }
}

export async function inspectSiteReleaseDiagnostics({
  fetcher,
  siteOrigin,
} = {}) {
  const url = fixedHttpsUrl(siteOrigin, "/api/mcp/capabilities", "SITE_ORIGIN_INVALID");
  const body = await fetchBoundedJson({
    fetcher,
    url,
    timeoutMilliseconds: 15_000,
    prefix: "SITE_CAPABILITIES",
  });
  if (!isRecord(body)) {
    throw error("SITE_CAPABILITIES_INVALID");
  }
  return normalizeReadyReleaseDiagnostics(
    body.releaseDiagnostics,
    "SITE_RELEASE_DIAGNOSTICS_INVALID",
  );
}

export async function inspectRunnerReleaseHealth({
  fetcher,
  runnerOrigin,
  expected,
} = {}) {
  const url = fixedHttpsUrl(runnerOrigin, "/healthz", "RUNNER_ORIGIN_INVALID");
  const health = await fetchBoundedJson({
    fetcher,
    url,
    timeoutMilliseconds: 15_000,
    prefix: "RUNNER_HEALTH",
  });
  if (
    !isRecord(health) ||
    health.service !== "proofweave-trusted-runner" ||
    health.state !== "ready" ||
    health.provider !== "e2b" ||
    health.revision !== expected?.revision ||
    health.executionEnabled !== true ||
    health.executionBoundary !== "isolated-sandbox-only" ||
    !Object.hasOwn(health, "lastWakeAt")
  ) {
    throw error("RUNNER_HEALTH_MISMATCH");
  }
  const releaseDiagnostics = normalizeReadyReleaseDiagnostics(
    health.releaseDiagnostics,
    "RUNNER_RELEASE_DIAGNOSTICS_INVALID",
  );
  const runnerPolicy = normalizeRunnerPolicy(health.runnerPolicy, expected);
  return Object.freeze({
    service: health.service,
    state: health.state,
    provider: health.provider,
    revision: health.revision,
    executionEnabled: true,
    executionBoundary: health.executionBoundary,
    lastWakeAt: normalizeOptionalTimestamp(health.lastWakeAt),
    releaseDiagnostics,
    runnerPolicy,
  });
}

export function bindLiveReleaseAuthority({
  manifest,
  database,
  siteDiagnostics,
  runnerDiagnostics,
} = {}) {
  const expectedFingerprint = manifest?.database?.gatewayFingerprint;
  const expectedLedgerHead = manifest?.database?.repositoryMigrationHead;
  if (
    manifest?.database?.authority !== "turso" ||
    manifest.database.runnerFingerprint !== expectedFingerprint ||
    manifest.database.deployedMigrationHead !== expectedLedgerHead ||
    database?.authority !== "turso" ||
    database.fingerprint !== expectedFingerprint ||
    database.migrationHead !== expectedLedgerHead ||
    siteDiagnostics?.databaseFingerprint !== expectedFingerprint ||
    siteDiagnostics.ledgerHead !== expectedLedgerHead ||
    runnerDiagnostics?.databaseFingerprint !== expectedFingerprint ||
    runnerDiagnostics.ledgerHead !== expectedLedgerHead
  ) {
    throw error("LIVE_RELEASE_AUTHORITY_MISMATCH");
  }
}

function normalizeReadyReleaseDiagnostics(value, code) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, diagnosticsKeys) ||
    value.schemaVersion !== diagnosticsSchemaVersion ||
    value.state !== "ready" ||
    value.authority !== "turso" ||
    !fingerprintPattern.test(value.databaseFingerprint ?? "") ||
    typeof value.ledgerHead !== "string" ||
    value.ledgerHead.length > 128 ||
    !ledgerHeadPattern.test(value.ledgerHead) ||
    value.failureCode !== null
  ) {
    throw error(code);
  }
  return Object.freeze({
    schemaVersion: diagnosticsSchemaVersion,
    state: "ready",
    authority: "turso",
    databaseFingerprint: value.databaseFingerprint,
    ledgerHead: value.ledgerHead,
    failureCode: null,
  });
}

function normalizeRunnerPolicy(value, expected) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, runnerPolicyKeys) ||
    value.state !== "configured" ||
    value.sandboxImageDigest !== expected?.imageDigest ||
    value.templateId !== expected?.templateId ||
    value.templateBuildId !== expected?.templateBuildId ||
    value.sandboxImageApproved !== true ||
    !imageDigestPattern.test(value.sandboxImageDigest ?? "") ||
    !publicLabelPattern.test(value.templateId ?? "") ||
    !publicLabelPattern.test(value.templateBuildId ?? "") ||
    !Array.isArray(value.approvedImages) ||
    value.approvedImages.length === 0 ||
    value.approvedImages.length > 8
  ) {
    throw error("RUNNER_POLICY_MISMATCH");
  }
  const approvedImages = value.approvedImages.map((image) => {
    if (
      !isRecord(image) ||
      !hasExactKeys(image, approvedImageKeys) ||
      !imageDigestPattern.test(image.imageDigest ?? "") ||
      !publicLabelPattern.test(image.leanToolchain ?? "") ||
      !revisionPattern.test(image.mathlibRevision ?? "")
    ) {
      throw error("RUNNER_POLICY_MISMATCH");
    }
    return {
      imageDigest: image.imageDigest,
      leanToolchain: image.leanToolchain,
      mathlibRevision: image.mathlibRevision,
    };
  }).sort((left, right) => (
    left.imageDigest.localeCompare(right.imageDigest) ||
    left.leanToolchain.localeCompare(right.leanToolchain) ||
    left.mathlibRevision.localeCompare(right.mathlibRevision)
  ));
  if (
    new Set(approvedImages.map((image) => JSON.stringify(image))).size !== approvedImages.length ||
    !approvedImages.some((image) => (
      image.imageDigest === expected.imageDigest &&
      image.leanToolchain === expected.leanToolchain &&
      image.mathlibRevision === expected.mathlibRevision
    ))
  ) {
    throw error("RUNNER_POLICY_MISMATCH");
  }
  return Object.freeze({
    state: "configured",
    sandboxImageDigest: value.sandboxImageDigest,
    templateId: value.templateId,
    templateBuildId: value.templateBuildId,
    approvedImages: Object.freeze(approvedImages.map((image) => Object.freeze(image))),
    sandboxImageApproved: true,
  });
}

async function fetchBoundedJson({
  fetcher,
  url,
  timeoutMilliseconds,
  prefix,
}) {
  if (typeof fetcher !== "function") throw error(`${prefix}_UNREACHABLE`);
  let response;
  try {
    response = await fetcher(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMilliseconds),
      headers: { accept: "application/json" },
    });
  } catch (cause) {
    throw error(`${prefix}_UNREACHABLE`, { cause });
  }
  if (
    response?.redirected === true ||
    (typeof response?.url === "string" && response.url !== "" && response.url !== url.toString())
  ) {
    throw error(`${prefix}_REDIRECTED`);
  }
  if (response?.ok !== true || response.status !== 200) {
    throw error(`${prefix}_STATUS_INVALID`);
  }
  const contentType = response.headers?.get?.("content-type");
  if (
    typeof contentType !== "string" ||
    !/^application\/json(?:\s*;|$)/i.test(contentType)
  ) {
    throw error(`${prefix}_CONTENT_TYPE_INVALID`);
  }
  const declaredLength = response.headers?.get?.("content-length");
  if (
    declaredLength !== null &&
    declaredLength !== undefined &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxJsonBytes)
  ) {
    throw error(`${prefix}_TOO_LARGE`);
  }
  let source;
  try {
    source = await response.text();
  } catch (cause) {
    throw error(`${prefix}_INVALID`, { cause });
  }
  if (Buffer.byteLength(source, "utf8") === 0 || Buffer.byteLength(source, "utf8") > maxJsonBytes) {
    throw error(`${prefix}_TOO_LARGE`);
  }
  try {
    return JSON.parse(source);
  } catch (cause) {
    throw error(`${prefix}_INVALID`, { cause });
  }
}

function fixedHttpsUrl(originValue, path, code) {
  let origin;
  try {
    origin = new URL(originValue);
  } catch {
    throw error(code);
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    (origin.pathname !== "" && origin.pathname !== "/")
  ) {
    throw error(code);
  }
  const url = new URL(path, origin);
  if (
    url.origin !== origin.origin ||
    url.pathname !== path ||
    url.search ||
    url.hash
  ) {
    throw error(code);
  }
  return url;
}

function normalizeOptionalTimestamp(value) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 64) {
    throw error("RUNNER_LAST_WAKE_INVALID");
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw error("RUNNER_LAST_WAKE_INVALID");
  return instant.toISOString();
}

function hasExactKeys(value, expected) {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function error(code, options) {
  return new GithubIndependentLiveReleaseBindingError(code, options);
}
