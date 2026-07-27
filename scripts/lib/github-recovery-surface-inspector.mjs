import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Canonical } from "../../packages/protocol/canonical-json.mjs";
import {
  runtimeRecoveryIsolationActiveStates,
  runtimeRecoveryIsolationMaximumTtlMilliseconds,
  runtimeRecoveryIsolationProtocolVersion,
  signRuntimeRecoveryIsolationEvidence,
} from "../../packages/protocol/runtime-recovery-isolation.mjs";

export const githubRecoveryApiVersion = "2022-11-28";
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const expectedGithubRecoverySurfaces = Object.freeze({
  ".github/workflows/build-week-live-receipt.yml": "manual_queue_consumer",
  ".github/workflows/e2b-lean-runner.yml": "recovery_queue_consumer",
});

export class GithubRecoverySurfaceInspectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GithubRecoverySurfaceInspectionError";
    this.code = code;
  }
}

/**
 * Enumerate every Actions workflow and fail closed when a queue-consumer
 * signature is present outside the reviewed surface allowlist.
 */
export async function scanGithubRecoverySurfaces({
  repoRoot = repositoryRoot,
  readdirImpl = readdir,
  readFileImpl = readFile,
} = {}) {
  const workflowDirectory = path.join(repoRoot, ".github", "workflows");
  let names;
  try {
    names = await readdirImpl(workflowDirectory);
  } catch {
    throw inspectionError("WORKFLOW_SCAN_FAILED", "GitHub workflow surfaces could not be enumerated.");
  }
  const workflowNames = names
    .filter((name) => typeof name === "string" && /\.ya?ml$/.test(name))
    .sort(compareStrings);
  const detected = [];
  for (const name of workflowNames) {
    const workflowPath = `.github/workflows/${name}`;
    let source;
    try {
      source = await readFileImpl(path.join(workflowDirectory, name));
    } catch {
      throw inspectionError("WORKFLOW_SCAN_FAILED", "A GitHub workflow surface could not be read.");
    }
    const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw inspectionError("WORKFLOW_SCAN_FAILED", "A GitHub workflow surface is not valid UTF-8.");
    }
    if (!isQueueConsumerWorkflow(text)) continue;
    const role = expectedGithubRecoverySurfaces[workflowPath];
    if (!role) {
      throw inspectionError(
        "UNKNOWN_QUEUE_CONSUMER",
        "An unreviewed GitHub workflow can consume the production Runner queue.",
      );
    }
    detected.push({
      path: workflowPath,
      role,
      sourceSha256: await sha256Bytes(bytes),
      sourceBytes: bytes,
    });
  }

  const expectedPaths = Object.keys(expectedGithubRecoverySurfaces).sort(compareStrings);
  const detectedPaths = detected.map((entry) => entry.path);
  if (
    expectedPaths.length !== detectedPaths.length
    || expectedPaths.some((entry, index) => entry !== detectedPaths[index])
  ) {
    throw inspectionError(
      "EXPECTED_QUEUE_CONSUMER_MISSING",
      "A reviewed GitHub recovery workflow is absent or no longer has a queue-consumer signature.",
    );
  }

  const workflows = detected.map((entry) => ({
    path: entry.path,
    role: entry.role,
    sourceSha256: entry.sourceSha256,
  }));
  return Object.freeze({
    hash: await sha256Canonical({ workflows }),
    workflows: workflows.map(Object.freeze),
    sources: Object.freeze(Object.fromEntries(detected.map((entry) => [entry.path, entry.sourceBytes]))),
  });
}

/**
 * Observe recovery isolation only at the start of a production drill. GitHub
 * must report each reviewed workflow disabled manually and with no active run.
 */
export async function inspectRuntimeRecoveryIsolationAtDrillBegin(options = {}) {
  requireBeginOptions(options);
  const {
    githubToken,
    repositoryFullName,
    releaseSha,
    releaseFingerprint,
    correlationId,
    subject,
    operatorPrivateKeyJwk,
    operatorKeyId,
    ttlMilliseconds = runtimeRecoveryIsolationMaximumTtlMilliseconds,
    fetchImpl = globalThis.fetch,
    repoRoot = repositoryRoot,
    readdirImpl = readdir,
    readFileImpl = readFile,
    now = new Date(),
    apiBaseUrl = "https://api.github.com",
  } = options;
  if (typeof fetchImpl !== "function") {
    throw inspectionError("FETCH_UNAVAILABLE", "GitHub API observation is unavailable.");
  }
  requireSecret(githubToken);
  requireRepository(repositoryFullName);
  requireReleaseSha(releaseSha);
  requireSha256(releaseFingerprint, "Release fingerprint");
  requireIdentifier(correlationId, "Correlation id");
  requireSubject(subject);
  if (
    !Number.isSafeInteger(ttlMilliseconds)
    || ttlMilliseconds <= 0
    || ttlMilliseconds > runtimeRecoveryIsolationMaximumTtlMilliseconds
  ) {
    throw inspectionError("INVALID_TTL", "Recovery isolation TTL is outside the allowed bound.");
  }
  const observedAt = normalizeInstant(now);
  const validUntil = new Date(Date.parse(observedAt) + ttlMilliseconds).toISOString();
  const surfaceManifest = await scanGithubRecoverySurfaces({
    repoRoot,
    readdirImpl,
    readFileImpl,
  });
  const apiRoot = normalizeApiBase(apiBaseUrl);
  const repository = await githubJson(
    fetchImpl,
    `${apiRoot}/repos/${encodeRepository(repositoryFullName)}`,
    githubToken,
    "REPOSITORY_OBSERVATION_FAILED",
  );
  if (
    !Number.isSafeInteger(repository?.id)
    || repository.id <= 0
    || repository.full_name !== repositoryFullName
  ) {
    throw inspectionError("MALFORMED_GITHUB_RESPONSE", "GitHub repository identity is malformed.");
  }
  const workflowIndex = await githubJson(
    fetchImpl,
    `${apiRoot}/repos/${encodeRepository(repositoryFullName)}/actions/workflows?per_page=100`,
    githubToken,
    "WORKFLOW_OBSERVATION_FAILED",
  );
  if (
    !Number.isSafeInteger(workflowIndex?.total_count)
    || workflowIndex.total_count < 0
    || !Array.isArray(workflowIndex.workflows)
    || workflowIndex.total_count > workflowIndex.workflows.length
  ) {
    throw inspectionError("MALFORMED_GITHUB_RESPONSE", "GitHub workflow inventory is malformed or incomplete.");
  }

  const observedWorkflows = [];
  for (const manifestEntry of surfaceManifest.workflows) {
    const matches = workflowIndex.workflows.filter((entry) => entry?.path === manifestEntry.path);
    if (matches.length !== 1) {
      throw inspectionError("WORKFLOW_IDENTITY_MISMATCH", "A reviewed GitHub workflow could not be identified uniquely.");
    }
    const workflow = matches[0];
    if (!Number.isSafeInteger(workflow.id) || workflow.id <= 0 || typeof workflow.state !== "string") {
      throw inspectionError("MALFORMED_GITHUB_RESPONSE", "GitHub workflow identity is malformed.");
    }
    if (workflow.state !== "disabled_manually") {
      throw inspectionError("RECOVERY_WORKFLOW_ENABLED", "A GitHub recovery workflow is not disabled manually.");
    }

    const contentUrl = `${apiRoot}/repos/${encodeRepository(repositoryFullName)}/contents/${encodePath(manifestEntry.path)}?ref=${encodeURIComponent(releaseSha)}`;
    const content = await githubJson(
      fetchImpl,
      contentUrl,
      githubToken,
      "WORKFLOW_SOURCE_OBSERVATION_FAILED",
    );
    if (
      content?.path !== manifestEntry.path
      || typeof content.sha !== "string"
      || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(content.sha)
      || content.encoding !== "base64"
      || typeof content.content !== "string"
    ) {
      throw inspectionError("MALFORMED_GITHUB_RESPONSE", "GitHub workflow source identity is malformed.");
    }
    const remoteSource = decodeGithubBase64(content.content);
    if (await sha256Bytes(remoteSource) !== manifestEntry.sourceSha256) {
      throw inspectionError(
        "WORKFLOW_SOURCE_MISMATCH",
        "The release workflow bytes do not match the locally reviewed source.",
      );
    }

    const activeRuns = {};
    for (const state of runtimeRecoveryIsolationActiveStates) {
      const runs = await githubJson(
        fetchImpl,
        `${apiRoot}/repos/${encodeRepository(repositoryFullName)}/actions/workflows/${workflow.id}/runs?status=${encodeURIComponent(state)}&per_page=1`,
        githubToken,
        "WORKFLOW_RUN_OBSERVATION_FAILED",
      );
      if (!Number.isSafeInteger(runs?.total_count) || runs.total_count < 0 || !Array.isArray(runs.workflow_runs)) {
        throw inspectionError("MALFORMED_GITHUB_RESPONSE", "GitHub workflow run inventory is malformed.");
      }
      activeRuns[state] = runs.total_count;
      if (runs.total_count !== 0) {
        throw inspectionError("ACTIVE_RECOVERY_RUN", "A GitHub recovery workflow has an active run.");
      }
    }
    observedWorkflows.push({
      workflowId: workflow.id,
      path: workflow.path,
      sourceBlobSha: content.sha,
      state: workflow.state,
      activeRuns,
    });
  }
  observedWorkflows.sort((left, right) => compareStrings(left.path, right.path));

  const productionEligible = ![
    "fetchImpl",
    "readdirImpl",
    "readFileImpl",
    "now",
    "apiBaseUrl",
  ].some((key) => Object.prototype.hasOwnProperty.call(options, key))
    && path.resolve(repoRoot) === repositoryRoot;
  const evidenceIdDigest = await sha256Canonical({
    repositoryId: repository.id,
    releaseSha,
    correlationId,
    subject,
    observedAt,
  });
  return signRuntimeRecoveryIsolationEvidence({
    protocolVersion: runtimeRecoveryIsolationProtocolVersion,
    evidenceId: `recovery-isolation:${evidenceIdDigest.slice("sha256:".length, "sha256:".length + 32)}`,
    productionEligible,
    release: {
      gitSha: releaseSha,
      fingerprint: releaseFingerprint,
    },
    drill: {
      correlationId,
      subject,
      observedAt,
      validUntil,
    },
    surfaceManifest: {
      hash: surfaceManifest.hash,
      workflows: surfaceManifest.workflows,
    },
    githubObservation: {
      repositoryId: repository.id,
      repositoryFullName: repository.full_name,
      apiVersion: githubRecoveryApiVersion,
      releaseSha,
      workflows: observedWorkflows,
    },
  }, {
    operatorPrivateKeyJwk,
    operatorKeyId,
    signedAt: observedAt,
  });
}

function isQueueConsumerWorkflow(source) {
  const executesKnownConsumer = (
    /\bnpm\s+run\s+runner:trusted:once\b/.test(source)
    || /\bnode\s+\S*run-trusted-lean-runner-once\.mjs\b/.test(source)
  );
  const holdsControlPlaneCredentials = (
    /\bTURSO_DATABASE_URL\s*:/.test(source)
    && /\bTURSO_AUTH_TOKEN\s*:/.test(source)
    && (
      /\bRUNNER_EXECUTION_ENABLED\s*:/.test(source)
      || /\bRUNNER_RESULT_PRIVATE_KEY_JWK\s*:/.test(source)
      || /\bRUNNER_CONTROL_PLANE_PRIVATE_KEY_JWK\s*:/.test(source)
    )
  );
  return executesKnownConsumer || holdsControlPlaneCredentials;
}

async function githubJson(fetchImpl, url, token, failureCode) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": githubRecoveryApiVersion,
      },
      redirect: "error",
    });
  } catch {
    throw inspectionError(failureCode, "GitHub API observation failed.");
  }
  if (!response || typeof response.status !== "number" || typeof response.text !== "function") {
    throw inspectionError("MALFORMED_GITHUB_RESPONSE", "GitHub API returned an invalid response.");
  }
  if (response.status === 401 || response.status === 403) {
    throw inspectionError("GITHUB_ACCESS_DENIED", "GitHub denied the recovery-isolation observation.");
  }
  if (response.status < 200 || response.status >= 300) {
    throw inspectionError(failureCode, "GitHub API observation failed.");
  }
  let body;
  try {
    body = await response.text();
  } catch {
    throw inspectionError("MALFORMED_GITHUB_RESPONSE", "GitHub API response could not be read.");
  }
  if (typeof body !== "string" || body.length === 0 || body.length > 1_000_000) {
    throw inspectionError("MALFORMED_GITHUB_RESPONSE", "GitHub API response has an invalid size.");
  }
  try {
    return JSON.parse(body);
  } catch {
    throw inspectionError("MALFORMED_GITHUB_RESPONSE", "GitHub API returned malformed JSON.");
  }
}

async function sha256Bytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function decodeGithubBase64(value) {
  try {
    const compact = value.replace(/\s/g, "");
    const binary = atob(compact);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw inspectionError("MALFORMED_GITHUB_RESPONSE", "GitHub workflow source encoding is malformed.");
  }
}

function normalizeInstant(value) {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw inspectionError("INVALID_TIME", "Recovery isolation observation time is invalid.");
  }
  return new Date(milliseconds).toISOString();
}

function normalizeApiBase(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw inspectionError("INVALID_API_BASE", "GitHub API base URL is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw inspectionError("INVALID_API_BASE", "GitHub API base URL is invalid.");
  }
  return url.href.replace(/\/+$/, "");
}

function requireBeginOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw inspectionError("INVALID_OPTIONS", "Recovery isolation options are invalid.");
  }
  if (options.phase !== "begin") {
    throw inspectionError("BEGIN_ONLY", "Recovery isolation may only be observed at drill begin.");
  }
}

function requireSecret(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 4_096 || /[\0\r\n]/.test(value)) {
    throw inspectionError("INVALID_GITHUB_TOKEN", "A bounded GitHub token is required.");
  }
}

function requireRepository(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw inspectionError("INVALID_REPOSITORY", "GitHub repository must be owner/repository.");
  }
}

function requireReleaseSha(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value)) {
    throw inspectionError("INVALID_RELEASE_SHA", "Release SHA is invalid.");
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw inspectionError("INVALID_HASH", `${label} must be sha256:<hex>.`);
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
    throw inspectionError("INVALID_IDENTIFIER", `${label} is invalid.`);
  }
}

function requireSubject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw inspectionError("INVALID_SUBJECT", "Recovery isolation subject is invalid.");
  }
  const allowed = ["personId", "agentId", "artifactBundleHash"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw inspectionError("INVALID_SUBJECT", "Recovery isolation subject is invalid.");
  }
  requireIdentifier(value.personId, "Subject Person id");
  requireIdentifier(value.agentId, "Subject Agent id");
  requireSha256(value.artifactBundleHash, "Subject artifact Bundle hash");
}

function encodeRepository(repository) {
  return repository.split("/").map(encodeURIComponent).join("/");
}

function encodePath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function inspectionError(code, message) {
  return new GithubRecoverySurfaceInspectionError(code, message);
}
