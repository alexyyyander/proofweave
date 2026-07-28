#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createReleaseManifest } from "./print-release-manifest.mjs";
import { createRemoteLibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import {
  loadProofweaveMigrations,
  verifyProofweaveControlPlane,
} from "../services/database/libsql-migrations.mjs";
import {
  contributionReceiptVerificationBundleHash,
  verifyContributionReceiptVerificationBundleWithIssuerKeyset,
} from "../packages/protocol/contribution-receipt-verification-bundle.mjs";
import {
  contributionReceiptHash,
} from "../packages/protocol/contribution-receipt.mjs";
import { sha256Canonical } from "../packages/protocol/canonical-json.mjs";
import { tursoDatabaseFingerprint } from "../db/control-plane-authority.mjs";
import {
  bindLiveEvidence,
  fetchCurrentIssuerKeyset,
  normalizeLiveEvidence,
  probeTursoLiveClosureEvidence,
} from "./lib/github-independent-live-evidence.mjs";
import {
  bindLiveReleaseAuthority,
  inspectRunnerReleaseHealth,
  inspectSiteReleaseDiagnostics,
} from "./lib/github-independent-live-release-binding.mjs";
import {
  beginRecoveryIsolationSnapshot,
  normalizeRecoveryIsolationState,
  recoveryIsolationReleaseConfiguration,
  verifyPersistedRecoveryIsolation,
} from "./lib/github-independent-recovery-isolation.mjs";
import { productionDrillPolicyHash } from "./lib/production-drill-policy.mjs";

export const githubIndependentDrillSchemaVersion = "pw-github-independent-production-drill-v4";
export const githubIndependentDrillConfirmations = Object.freeze({
  begin: "I-CONFIRM-REVIEWED-GITHUB-WORKFLOWS-ARE-DISABLED-AT-BEGIN",
  record: "I-CONFIRM-REAL-PRODUCTION-EVIDENCE-WAS-OBSERVED",
  finalize: "I-CONFIRM-PORTABLE-RECEIPT-CLOSURE-IS-FINAL",
});

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultDownloadPaths = Object.freeze([
  "/downloads/proofweave-research-marketplace.tar",
  "/downloads/proofweave-research-marketplace.tar.sha256",
  "/downloads/proofweave-research-marketplace.json",
]);
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const revisionPattern = /^[a-f0-9]{40,64}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9:._+/-]{0,511}$/;
const forbiddenProductionMarker = /(mock|demo|smoke|fixture)/i;
const maxPublicDownloadBytes = 40 * 1024 * 1024;

export class GithubIndependentDrillError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = "GithubIndependentDrillError";
    this.code = code;
  }
}

/**
 * Build a drill controller. Supplying any transport, manifest, database, clock,
 * or verifier dependency permanently makes that controller fixture-only.
 */
export function createGithubIndependentProductionDrill(options = {}) {
  const injected = [
    "root",
    "fetcher",
    "manifestProvider",
    "databaseProbe",
    "liveEvidenceProbe",
    "receiptVerifier",
    "recoveryIsolationInspector",
    "recoveryIsolationVerifier",
    "operatorPrivateKeyProvider",
    "productionDrillPolicyProvider",
    "gitOriginProvider",
    "now",
  ].some((key) => Object.hasOwn(options, key));
  const root = resolve(options.root ?? repositoryRoot);
  const fetcher = options.fetcher ?? globalThis.fetch;
  const manifestProvider = options.manifestProvider ?? ((input) => createReleaseManifest(input));
  const databaseProbe = options.databaseProbe ?? probeTursoControlPlane;
  const liveEvidenceProbe = options.liveEvidenceProbe ?? probeTursoLiveClosureEvidence;
  const receiptVerifier = options.receiptVerifier ?? verifyPortableReceipt;
  const recoveryIsolationInspector = options.recoveryIsolationInspector;
  const recoveryIsolationVerifier = options.recoveryIsolationVerifier;
  const operatorPrivateKeyProvider = options.operatorPrivateKeyProvider;
  const productionDrillPolicyProvider = options.productionDrillPolicyProvider;
  const gitOriginProvider = options.gitOriginProvider;
  const now = options.now ?? (() => new Date());
  if (
    typeof fetcher !== "function" ||
    typeof manifestProvider !== "function" ||
    typeof databaseProbe !== "function" ||
    typeof liveEvidenceProbe !== "function" ||
    typeof receiptVerifier !== "function" ||
    (recoveryIsolationInspector !== undefined && typeof recoveryIsolationInspector !== "function") ||
    (recoveryIsolationVerifier !== undefined && typeof recoveryIsolationVerifier !== "function") ||
    (operatorPrivateKeyProvider !== undefined && typeof operatorPrivateKeyProvider !== "function") ||
    (productionDrillPolicyProvider !== undefined
      && typeof productionDrillPolicyProvider !== "function") ||
    (gitOriginProvider !== undefined && typeof gitOriginProvider !== "function") ||
    typeof now !== "function"
  ) {
    throw new GithubIndependentDrillError("DRILL_DEPENDENCY_INVALID");
  }

  async function preflight({ environment = process.env } = {}) {
    requireNoNodePreload(environment);
    requireRecoveryDisabled(environment);
    const releaseResult = await manifestProvider({
      root,
      environment,
      mode: "release",
    });
    const manifest = requireStrictReleaseManifest(releaseResult);
    const recoveryIsolation = await recoveryIsolationReleaseConfiguration({
      environment,
      root,
      policyBinding: manifest.productionDrill,
      policyProvider: productionDrillPolicyProvider,
      gitOriginProvider,
    });
    const database = await databaseProbe({ environment, manifest });
    validateDatabaseProbe(database, manifest);
    const siteOrigin = requireHttpsOrigin(
      environment.PROOFWEAVE_DRILL_SITE_ORIGIN,
      "SITE_ORIGIN_INVALID",
    ).origin;
    const expectedRunnerConsumerId = requireProductionIdentifier(
      environment.PROOFWEAVE_DRILL_EXPECTED_RUNNER_CONSUMER_ID,
      "EXPECTED_RUNNER_CONSUMER_ID_MISSING",
    );
    const siteReleaseDiagnostics = await inspectSiteReleaseDiagnostics({
      fetcher,
      siteOrigin,
    });
    const downloads = await inspectPublishedDownloads({
      fetcher,
      siteOrigin,
      paths: parseDownloadPaths(environment.PROOFWEAVE_DRILL_PLUGIN_DOWNLOADS_JSON),
      root,
    });
    const runner = await inspectRunnerReleaseHealth({
      fetcher,
      runnerOrigin: environment.PROOFWEAVE_RUNNER_URL,
      expected: {
        revision: manifest.source.gitSha,
        templateId: manifest.runner.e2b.deployedTemplateId,
        templateBuildId: manifest.runner.e2b.deployedTemplateBuildId,
        imageDigest: manifest.runner.image.deployedDigest,
        leanToolchain: manifest.runner.image.leanToolchain,
        mathlibRevision: manifest.runner.image.mathlibRevision,
      },
    });
    bindLiveReleaseAuthority({
      manifest,
      database,
      siteDiagnostics: siteReleaseDiagnostics,
      runnerDiagnostics: runner.releaseDiagnostics,
    });
    const release = releaseProjection({
      manifest,
      database,
      downloads,
      siteOrigin,
      expectedRunnerConsumerId,
      recoveryIsolation,
      siteReleaseDiagnostics,
      runner,
    });
    return Object.freeze({
      schemaVersion: githubIndependentDrillSchemaVersion,
      phase: "preflight",
      outcome: "preflight_passed",
      productionEligible: !injected,
      release,
      releaseFingerprint: await sha256Canonical(release),
      runner,
    });
  }

  async function begin({
    environment = process.env,
    statePath,
    confirmation,
    correlationId,
    personId,
    agentId,
    artifactBundleHash,
  } = {}) {
    requireConfirmation(confirmation, githubIndependentDrillConfirmations.begin);
    const path = requireExternalStatePath(statePath, root);
    const identity = {
      correlationId: requireProductionIdentifier(correlationId, "CORRELATION_ID_INVALID"),
      personId: requireProductionIdentifier(personId, "PERSON_ID_INVALID"),
      agentId: requireProductionIdentifier(agentId, "AGENT_ID_INVALID"),
      artifactBundleHash: requireSha256(artifactBundleHash, "BUNDLE_HASH_INVALID"),
    };
    const checked = await preflight({ environment });
    const recoveryIsolation = await beginRecoveryIsolationSnapshot({
      environment,
      release: checked.release,
      releaseFingerprint: checked.releaseFingerprint,
      correlationId: identity.correlationId,
      subject: {
        personId: identity.personId,
        agentId: identity.agentId,
        artifactBundleHash: identity.artifactBundleHash,
      },
      root,
      inspector: recoveryIsolationInspector,
      verifier: recoveryIsolationVerifier,
      operatorPrivateKeyProvider,
      policyProvider: productionDrillPolicyProvider,
      gitOriginProvider,
      now: now(),
    });
    const timestamp = recoveryIsolation.evidence.drill.observedAt;
    const productionEligible = checked.productionEligible
      && recoveryIsolation.productionEligible;
    const state = {
      schemaVersion: githubIndependentDrillSchemaVersion,
      phase: "begun",
      productionEligible,
      createdAt: timestamp,
      updatedAt: timestamp,
      correlationId: identity.correlationId,
      participant: {
        personId: identity.personId,
        agentId: identity.agentId,
      },
      artifactBundleHash: identity.artifactBundleHash,
      release: checked.release,
      releaseFingerprint: checked.releaseFingerprint,
      recoveryIsolation: {
        evidenceHash: recoveryIsolation.evidenceHash,
        evidence: recoveryIsolation.evidence,
      },
      evidence: null,
      liveEvidence: null,
      portableClosure: null,
    };
    await createStateFile(path, state);
    return publicStateResult(state, "begun");
  }

  async function record({
    environment = process.env,
    statePath,
    confirmation,
    evidence,
  } = {}) {
    requireConfirmation(confirmation, githubIndependentDrillConfirmations.record);
    const path = requireExternalStatePath(statePath, root);
    const state = await readDrillState(path, "begun");
    const recoveryIsolation = await verifyPersistedRecoveryIsolation({
      recoveryIsolation: state.recoveryIsolation,
      environment,
      release: state.release,
      releaseFingerprint: state.releaseFingerprint,
      correlationId: state.correlationId,
      subject: {
        personId: state.participant.personId,
        agentId: state.participant.agentId,
        artifactBundleHash: state.artifactBundleHash,
      },
      createdAt: state.createdAt,
      verifier: recoveryIsolationVerifier,
      root,
      policyProvider: productionDrillPolicyProvider,
      gitOriginProvider,
      now: now(),
    });
    const checked = await preflight({ environment });
    requireReleaseUnchanged(state, checked);
    requireProductionEligibilityUnchanged(state, checked, recoveryIsolation);
    const normalizedEvidence = normalizeObservedEvidence(evidence);
    bindObservedEvidence(state, normalizedEvidence);
    const liveEvidence = normalizeLiveEvidence(await liveEvidenceProbe({
      environment,
      state,
      evidence: normalizedEvidence,
    }));
    bindLiveEvidence({ state, evidence: normalizedEvidence, live: liveEvidence });
    const next = {
      ...state,
      phase: "evidence_recorded",
      updatedAt: utcTimestamp(now(), "DRILL_CLOCK_INVALID"),
      evidence: normalizedEvidence,
      liveEvidence,
    };
    await replaceStateFile(path, next);
    return publicStateResult(next, "evidence_recorded");
  }

  async function finalize({
    environment = process.env,
    statePath,
    confirmation,
    correlationId,
    verificationBundle,
  } = {}) {
    requireConfirmation(confirmation, githubIndependentDrillConfirmations.finalize);
    const path = requireExternalStatePath(statePath, root);
    const state = await readDrillState(path, "evidence_recorded");
    if (correlationId !== state.correlationId) {
      throw new GithubIndependentDrillError("CORRELATION_ID_DRIFT");
    }
    const recoveryIsolation = await verifyPersistedRecoveryIsolation({
      recoveryIsolation: state.recoveryIsolation,
      environment,
      release: state.release,
      releaseFingerprint: state.releaseFingerprint,
      correlationId: state.correlationId,
      subject: {
        personId: state.participant.personId,
        agentId: state.participant.agentId,
        artifactBundleHash: state.artifactBundleHash,
      },
      createdAt: state.createdAt,
      verifier: recoveryIsolationVerifier,
      root,
      policyProvider: productionDrillPolicyProvider,
      gitOriginProvider,
      now: now(),
    });
    const checked = await preflight({ environment });
    requireReleaseUnchanged(state, checked);
    requireProductionEligibilityUnchanged(state, checked, recoveryIsolation);
    const liveEvidence = normalizeLiveEvidence(await liveEvidenceProbe({
      environment,
      state,
      evidence: state.evidence,
    }));
    bindLiveEvidence({ state, evidence: state.evidence, live: liveEvidence });
    if (JSON.stringify(liveEvidence) !== JSON.stringify(state.liveEvidence)) {
      throw new GithubIndependentDrillError("LIVE_EVIDENCE_DRIFT");
    }
    const issuerKeyset = await fetchCurrentIssuerKeyset({
      fetcher,
      siteOrigin: checked.release.siteOrigin,
    });
    const portable = await receiptVerifier({ verificationBundle, issuerKeyset });
    const closure = await bindPortableReceipt(state, portable);
    const outcome = checked.productionEligible && recoveryIsolation.productionEligible
      ? "production_closure_observed"
      : "fixture_verified";
    const next = {
      ...state,
      phase: outcome,
      updatedAt: utcTimestamp(now(), "DRILL_CLOCK_INVALID"),
      portableClosure: closure,
    };
    await replaceStateFile(path, next);
    return publicStateResult(next, outcome);
  }

  return Object.freeze({ preflight, begin, record, finalize });
}

async function probeTursoControlPlane({ environment, manifest }) {
  const url = requiredSetting(environment, "TURSO_DATABASE_URL", "TURSO_DATABASE_URL_MISSING");
  const authToken = requiredSetting(environment, "TURSO_AUTH_TOKEN", "TURSO_AUTH_TOKEN_MISSING");
  let fingerprint;
  try {
    fingerprint = tursoDatabaseFingerprint(url);
  } catch (cause) {
    throw new GithubIndependentDrillError("TURSO_DATABASE_URL_INVALID", { cause });
  }
  if (
    fingerprint !== manifest.database.gatewayFingerprint ||
    fingerprint !== manifest.database.runnerFingerprint
  ) {
    throw new GithubIndependentDrillError("DATABASE_FINGERPRINT_LIVE_MISMATCH");
  }
  const database = createRemoteLibsqlD1Database({ url, authToken });
  try {
    const migrations = await loadProofweaveMigrations();
    const verified = await verifyProofweaveControlPlane({ database, migrations });
    return {
      authority: "turso",
      fingerprint,
      migrationHead: verified.latestMigration,
      migrationCount: verified.migrationCount,
    };
  } catch (cause) {
    throw new GithubIndependentDrillError("DATABASE_VERIFY_FAILED", { cause });
  } finally {
    database.close();
  }
}

async function verifyPortableReceipt({ verificationBundle, issuerKeyset }) {
  if (!verificationBundle || !issuerKeyset) {
    throw new GithubIndependentDrillError("PORTABLE_RECEIPT_INPUT_MISSING");
  }
  try {
    const verified = await verifyContributionReceiptVerificationBundleWithIssuerKeyset(
      verificationBundle,
      issuerKeyset,
    );
    const root = verified.receipts.find((entry) => entry.receipt.id === verified.rootReceiptId);
    if (!root) throw new GithubIndependentDrillError("PORTABLE_ROOT_RECEIPT_MISSING");
    return {
      verified,
      root,
      bundleHash: await contributionReceiptVerificationBundleHash(verified),
      rootReceiptHash: await contributionReceiptHash(root.receipt),
    };
  } catch (cause) {
    if (cause instanceof GithubIndependentDrillError) throw cause;
    throw new GithubIndependentDrillError("PORTABLE_RECEIPT_VERIFY_FAILED", { cause });
  }
}

function requireRecoveryDisabled(environment) {
  if (environment.PROOFWEAVE_GITHUB_RECOVERY_ENABLED !== "false") {
    throw new GithubIndependentDrillError("GITHUB_RECOVERY_NOT_DISABLED");
  }
}

function requireNoNodePreload(environment) {
  const nodeOptions = environment?.NODE_OPTIONS;
  if (nodeOptions === undefined || nodeOptions === "") return;
  throw new GithubIndependentDrillError("NODE_OPTIONS_FORBIDDEN");
}

function requireStrictReleaseManifest(result) {
  const manifest = result?.manifest;
  if (
    result?.exitCode !== 0 ||
    manifest?.validation?.mode !== "release" ||
    manifest?.validation?.state !== "valid" ||
    manifest?.schemaVersion !== "pw-release-manifest-v2" ||
    !Array.isArray(manifest.validation.issues) ||
    manifest.validation.issues.length !== 0
  ) {
    throw new GithubIndependentDrillError("RELEASE_MANIFEST_INVALID");
  }
  let canonicalPolicyHash;
  try {
    canonicalPolicyHash = productionDrillPolicyHash(manifest.productionDrill?.policy);
  } catch {
    throw new GithubIndependentDrillError("RELEASE_MANIFEST_ALIGNMENT_FAILED");
  }
  const revision = manifest.source?.gitSha;
  if (
    !revisionPattern.test(revision ?? "") ||
    manifest.source.originMainSha !== revision ||
    manifest.source.clean !== true ||
    manifest.sites?.commitSha !== revision ||
    manifest.gateway?.revision !== revision ||
    manifest.runner?.revision !== revision ||
    manifest.database?.authority !== "turso" ||
    manifest.database.gatewayFingerprint !== manifest.database.runnerFingerprint ||
    manifest.database.repositoryMigrationHead !== manifest.database.deployedMigrationHead
    || !manifest.productionDrill?.policy
    || !sha256Pattern.test(manifest.productionDrill.policyHash ?? "")
    || canonicalPolicyHash !== manifest.productionDrill.policyHash
    || manifest.productionDrill.gitOriginRepositoryFullName
      !== manifest.productionDrill.policy.githubRepository?.fullName
  ) {
    throw new GithubIndependentDrillError("RELEASE_MANIFEST_ALIGNMENT_FAILED");
  }
  return manifest;
}

function validateDatabaseProbe(database, manifest) {
  if (
    database?.authority !== "turso" ||
    database.fingerprint !== manifest.database.gatewayFingerprint ||
    database.fingerprint !== manifest.database.runnerFingerprint ||
    database.migrationHead !== manifest.database.repositoryMigrationHead ||
    !Number.isSafeInteger(database.migrationCount) ||
    database.migrationCount <= 0
  ) {
    throw new GithubIndependentDrillError("DATABASE_PROBE_MISMATCH");
  }
}

async function inspectPublishedDownloads({ fetcher, siteOrigin, paths, root }) {
  const origin = requireHttpsOrigin(siteOrigin, "SITE_ORIGIN_INVALID");
  const files = [];
  for (const path of paths) {
    const url = new URL(path, origin);
    if (url.origin !== origin.origin || url.pathname !== path || url.search || url.hash) {
      throw new GithubIndependentDrillError("PLUGIN_DOWNLOAD_PATH_INVALID");
    }
    let response;
    try {
      response = await fetcher(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        headers: { accept: "application/octet-stream,text/plain;q=0.8" },
      });
    } catch (cause) {
      throw new GithubIndependentDrillError("PLUGIN_DOWNLOAD_UNREACHABLE", { cause });
    }
    if (!response?.ok) throw new GithubIndependentDrillError("PLUGIN_DOWNLOAD_UNREACHABLE");
    const contentLength = response.headers?.get?.("content-length");
    if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxPublicDownloadBytes)) {
      throw new GithubIndependentDrillError("PLUGIN_DOWNLOAD_TOO_LARGE");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > maxPublicDownloadBytes) {
      throw new GithubIndependentDrillError("PLUGIN_DOWNLOAD_SIZE_INVALID");
    }
    files.push({
      path,
      sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      byteLength: bytes.length,
      bytes,
    });
  }
  validatePublishedChecksum(files);
  await validatePublishedDistributionManifest(files, { root });
  return files.map((file) => Object.freeze({
    path: file.path,
    sha256: file.sha256,
    byteLength: file.byteLength,
  }));
}

function validatePublishedChecksum(files) {
  const archives = files.filter((file) => file.path.endsWith(".tar"));
  const checksumFiles = files.filter((file) => file.path.endsWith(".tar.sha256"));
  if (archives.length !== 1 || checksumFiles.length !== 1) {
    throw new GithubIndependentDrillError("PLUGIN_ARCHIVE_CHECKSUM_PAIR_INVALID");
  }
  const checksumText = checksumFiles[0].bytes.toString("utf8");
  const match = /^([a-f0-9]{64})[ \t]+\*?([A-Za-z0-9._-]+)[ \t]*\n?$/i.exec(checksumText);
  const archiveName = archives[0].path.split("/").at(-1);
  if (
    !match ||
    match[2] !== archiveName ||
    `sha256:${match[1].toLowerCase()}` !== archives[0].sha256
  ) {
    throw new GithubIndependentDrillError("PLUGIN_ARCHIVE_CHECKSUM_MISMATCH");
  }
}

async function validatePublishedDistributionManifest(files, { root }) {
  const manifestFile = files.find((file) => (
    file.path === "/downloads/proofweave-research-marketplace.json"
  ));
  const archive = files.find((file) => file.path.endsWith(".tar"));
  if (!manifestFile || !archive) {
    throw new GithubIndependentDrillError("PLUGIN_DISTRIBUTION_MANIFEST_MISSING");
  }
  let distribution;
  let marketplace;
  let plugin;
  let compatibility;
  try {
    distribution = JSON.parse(manifestFile.bytes.toString("utf8"));
    [marketplace, plugin, compatibility] = await Promise.all([
      readJsonFile(resolve(root, ".agents/plugins/marketplace.json")),
      readJsonFile(resolve(root, "plugins/proofweave-research/.codex-plugin/plugin.json")),
      readJsonFile(resolve(root, "packages/protocol/proofweave-client-compatibility.json")),
    ]);
  } catch (cause) {
    throw new GithubIndependentDrillError("PLUGIN_DISTRIBUTION_MANIFEST_INVALID", { cause });
  }
  requireRecord(distribution, "PLUGIN_DISTRIBUTION_MANIFEST_INVALID");
  rejectExtraKeys(distribution, [
    "schemaVersion", "marketplaceName", "pluginName", "pluginVersion", "archive", "compatibility",
  ], "PLUGIN_DISTRIBUTION_MANIFEST_INVALID");
  requireRecord(distribution.archive, "PLUGIN_DISTRIBUTION_MANIFEST_INVALID");
  rejectExtraKeys(distribution.archive, [
    "path", "filename", "sha256", "bytes",
  ], "PLUGIN_DISTRIBUTION_MANIFEST_INVALID");
  requireRecord(distribution.compatibility, "PLUGIN_DISTRIBUTION_MANIFEST_INVALID");
  rejectExtraKeys(distribution.compatibility, [
    "protocolVersion", "connectorApiVersion", "toolSchemaVersion",
  ], "PLUGIN_DISTRIBUTION_MANIFEST_INVALID");
  const marketplacePlugin = Array.isArray(marketplace?.plugins)
    ? marketplace.plugins.find((entry) => entry?.name === plugin?.name)
    : null;
  const archiveFilename = archive.path.split("/").at(-1);
  if (
    distribution.schemaVersion !== "pw-codex-plugin-distribution-v1" ||
    distribution.marketplaceName !== marketplace?.name ||
    distribution.pluginName !== plugin?.name ||
    distribution.pluginName !== marketplacePlugin?.name ||
    distribution.pluginVersion !== plugin?.version ||
    distribution.archive.path !== archive.path ||
    distribution.archive.filename !== archiveFilename ||
    distribution.archive.sha256 !== archive.sha256.slice("sha256:".length) ||
    distribution.archive.bytes !== archive.byteLength ||
    distribution.compatibility.protocolVersion !== compatibility?.protocolVersion ||
    distribution.compatibility.connectorApiVersion !== compatibility?.connectorApiVersion ||
    distribution.compatibility.toolSchemaVersion !== compatibility?.toolSchemaVersion
  ) {
    throw new GithubIndependentDrillError("PLUGIN_DISTRIBUTION_MANIFEST_MISMATCH");
  }
}

async function readJsonFile(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function releaseProjection({
  manifest,
  database,
  downloads,
  siteOrigin,
  expectedRunnerConsumerId,
  recoveryIsolation,
  siteReleaseDiagnostics,
  runner,
}) {
  return Object.freeze({
    gitSha: manifest.source.gitSha,
    siteOrigin,
    expectedRunnerConsumerId,
    githubRepositoryFullName: recoveryIsolation.repositoryFullName,
    githubRepositoryId: recoveryIsolation.repositoryId,
    productionDrillPolicy: recoveryIsolation.policy,
    productionDrillPolicyHash: recoveryIsolation.policyHash,
    gitOriginRepositoryFullName: recoveryIsolation.repositoryFullName,
    recoveryIsolationProtocolVersion: recoveryIsolation.protocolVersion,
    recoveryOperatorKeysetHash: recoveryIsolation.trustedKeysetHash,
    sitesVersion: manifest.sites.version,
    sitesCommitSha: manifest.sites.commitSha,
    gatewayRevision: manifest.gateway.revision,
    runnerRevision: manifest.runner.revision,
    e2bTemplateId: manifest.runner.e2b.deployedTemplateId,
    e2bTemplateBuildId: manifest.runner.e2b.deployedTemplateBuildId,
    runnerImageDigest: manifest.runner.image.deployedDigest,
    databaseAuthority: database.authority,
    databaseFingerprint: database.fingerprint,
    migrationHead: database.migrationHead,
    siteReleaseDiagnostics,
    runnerReleaseDiagnostics: runner.releaseDiagnostics,
    runnerExecutionEnabled: runner.executionEnabled,
    runnerExecutionBoundary: runner.executionBoundary,
    runnerPolicy: runner.runnerPolicy,
    pluginDownloads: downloads.map((file) => ({
      path: file.path,
      sha256: file.sha256,
      byteLength: file.byteLength,
    })),
  });
}

function parseDownloadPaths(source) {
  if (source === undefined || source === "") return [...defaultDownloadPaths];
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new GithubIndependentDrillError("PLUGIN_DOWNLOAD_LIST_INVALID");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length < 3 ||
    parsed.length > 8 ||
    new Set(parsed).size !== parsed.length ||
    defaultDownloadPaths.some((path) => !parsed.includes(path)) ||
    parsed.some((path) => (
      typeof path !== "string" ||
      path.length > 240 ||
      !/^\/[A-Za-z0-9._/-]+$/.test(path) ||
      path.includes("..")
    ))
  ) {
    throw new GithubIndependentDrillError("PLUGIN_DOWNLOAD_LIST_INVALID");
  }
  return parsed;
}

function normalizeObservedEvidence(value) {
  requireRecord(value, "EVIDENCE_INVALID");
  const allowed = [
    "correlationId", "revision", "personId", "agentId", "artifactBundleHash",
    "run", "reviews", "receipt",
  ];
  rejectExtraKeys(value, allowed, "EVIDENCE_INVALID");
  requireRecord(value.run, "RUN_EVIDENCE_INVALID");
  rejectExtraKeys(value.run, ["id", "resultHash"], "RUN_EVIDENCE_INVALID");
  requireRecord(value.receipt, "RECEIPT_EVIDENCE_INVALID");
  rejectExtraKeys(value.receipt, ["id", "hash"], "RECEIPT_EVIDENCE_INVALID");
  if (!Array.isArray(value.reviews) || value.reviews.length === 0 || value.reviews.length > 32) {
    throw new GithubIndependentDrillError("REVIEW_EVIDENCE_INVALID");
  }
  const reviews = value.reviews.map((review) => {
    requireRecord(review, "REVIEW_EVIDENCE_INVALID");
    rejectExtraKeys(review, [
      "verificationAttestationId", "verificationAttestationHash",
      "reviewerPersonId", "reviewerAgentId",
    ], "REVIEW_EVIDENCE_INVALID");
    return Object.freeze({
      verificationAttestationId: requireProductionIdentifier(
        review.verificationAttestationId,
        "REVIEW_EVIDENCE_INVALID",
      ),
      verificationAttestationHash: requireSha256(
        review.verificationAttestationHash,
        "REVIEW_EVIDENCE_INVALID",
      ),
      reviewerPersonId: requireProductionIdentifier(review.reviewerPersonId, "REVIEW_EVIDENCE_INVALID"),
      reviewerAgentId: requireProductionIdentifier(review.reviewerAgentId, "REVIEW_EVIDENCE_INVALID"),
    });
  }).sort((left, right) => (
    left.verificationAttestationId.localeCompare(right.verificationAttestationId)
  ));
  if (new Set(reviews.map((review) => review.verificationAttestationId)).size !== reviews.length) {
    throw new GithubIndependentDrillError("REVIEW_EVIDENCE_DUPLICATE");
  }
  return Object.freeze({
    correlationId: requireProductionIdentifier(value.correlationId, "CORRELATION_ID_INVALID"),
    revision: requireRevision(value.revision, "REVISION_INVALID"),
    personId: requireProductionIdentifier(value.personId, "PERSON_ID_INVALID"),
    agentId: requireProductionIdentifier(value.agentId, "AGENT_ID_INVALID"),
    artifactBundleHash: requireSha256(value.artifactBundleHash, "BUNDLE_HASH_INVALID"),
    run: Object.freeze({
      id: requireProductionIdentifier(value.run.id, "RUN_EVIDENCE_INVALID"),
      resultHash: requireSha256(value.run.resultHash, "RUN_EVIDENCE_INVALID"),
    }),
    reviews: Object.freeze(reviews),
    receipt: Object.freeze({
      id: requireProductionIdentifier(value.receipt.id, "RECEIPT_EVIDENCE_INVALID"),
      hash: requireSha256(value.receipt.hash, "RECEIPT_EVIDENCE_INVALID"),
    }),
  });
}

function bindObservedEvidence(state, evidence) {
  if (
    evidence.correlationId !== state.correlationId ||
    evidence.revision !== state.release.gitSha ||
    evidence.personId !== state.participant.personId ||
    evidence.agentId !== state.participant.agentId ||
    evidence.artifactBundleHash !== state.artifactBundleHash
  ) {
    throw new GithubIndependentDrillError("OBSERVED_EVIDENCE_DRIFT");
  }
  if (evidence.reviews.some((review) => review.reviewerPersonId === state.participant.personId)) {
    throw new GithubIndependentDrillError("SAME_OWNER_REVIEW");
  }
}

async function bindPortableReceipt(state, portable) {
  const { root, rootReceiptHash, bundleHash } = portable ?? {};
  const receipt = root?.receipt;
  const evidence = state.liveEvidence;
  if (
    !receipt ||
    rootReceiptHash !== evidence.receipt.hash ||
    receipt.id !== evidence.receipt.id ||
    receipt.attempt.personId !== state.participant.personId ||
    receipt.attempt.agentId !== state.participant.agentId ||
    receipt.beneficiary.personId !== state.participant.personId ||
    receipt.beneficiary.agentId !== state.participant.agentId ||
    receipt.attempt.id !== evidence.run.attemptId ||
    receipt.artifactBundleHash !== state.artifactBundleHash ||
    receipt.bundle.manifestHash !== state.artifactBundleHash ||
    receipt.run.id !== evidence.run.id ||
    receipt.run.requestHash !== evidence.run.requestHash ||
    receipt.run.resultHash !== evidence.run.resultHash ||
    utcTimestamp(receipt.issuedAt, "PORTABLE_RECEIPT_TIME_INVALID") !== evidence.receipt.issuedAt ||
    Date.parse(receipt.issuedAt) < Date.parse(state.createdAt)
  ) {
    throw new GithubIndependentDrillError("PORTABLE_RECEIPT_BINDING_MISMATCH");
  }
  const expectedReviews = new Map(evidence.reviews.map((review) => [
    review.verificationAttestationId,
    review,
  ]));
  if (
    receipt.claims.length !== expectedReviews.size ||
    receipt.claims.some((claim) => {
      const expected = expectedReviews.get(claim.verificationAttestationId);
      return (
        !expected ||
        claim.verificationAttestationHash !== expected.verificationAttestationHash ||
        claim.reviewerPersonId !== expected.reviewerPersonId ||
        claim.reviewerAgentId !== expected.reviewerAgentId ||
        claim.reviewerPersonId === state.participant.personId
      );
    })
  ) {
    throw new GithubIndependentDrillError("PORTABLE_REVIEW_BINDING_MISMATCH");
  }
  assertNoFixtureMarkers([
    state.correlationId,
    receipt.id,
    receipt.attempt.id,
    receipt.attempt.personId,
    receipt.attempt.agentId,
    receipt.beneficiary.personId,
    receipt.beneficiary.agentId,
    receipt.run.id,
    receipt.target.declaration,
    ...receipt.claims.flatMap((claim) => [
      claim.verificationAttestationId,
      claim.reviewerPersonId,
      claim.reviewerAgentId,
    ]),
  ]);
  return Object.freeze({
    rootReceiptId: receipt.id,
    rootReceiptHash,
    verificationBundleHash: requireSha256(bundleHash, "PORTABLE_BUNDLE_HASH_INVALID"),
    receiptCount: portable.verified.receipts.length,
    issuerKeyCount: portable.verified.issuerKeys.length,
  });
}

function assertNoFixtureMarkers(values) {
  if (values.some((value) => forbiddenProductionMarker.test(value))) {
    throw new GithubIndependentDrillError("FIXTURE_RECEIPT_FORBIDDEN");
  }
}

function requireReleaseUnchanged(state, checked) {
  if (
    state.releaseFingerprint !== checked.releaseFingerprint ||
    JSON.stringify(state.release) !== JSON.stringify(checked.release)
  ) {
    throw new GithubIndependentDrillError("RELEASE_DRIFT");
  }
}

function requireProductionEligibilityUnchanged(state, checked, recoveryIsolation) {
  const derived = checked.productionEligible && recoveryIsolation.productionEligible;
  if (state.productionEligible !== derived) {
    throw new GithubIndependentDrillError("PRODUCTION_ELIGIBILITY_DRIFT");
  }
}

async function createStateFile(path, state) {
  const normalizedState = normalizePersistedEvidenceFields(state);
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(normalizedState, null, 2)}\n`, "utf8");
  } catch (cause) {
    throw new GithubIndependentDrillError("STATE_CREATE_FAILED", { cause });
  } finally {
    await handle?.close();
  }
}

async function replaceStateFile(path, state) {
  const normalizedState = normalizePersistedEvidenceFields(state);
  const temporaryPath = `${path}.next-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(normalizedState, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, path);
  } catch (cause) {
    throw new GithubIndependentDrillError("STATE_UPDATE_FAILED", { cause });
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function readDrillState(path, expectedPhase) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (cause) {
    throw new GithubIndependentDrillError("STATE_READ_FAILED", { cause });
  }
  requireRecord(parsed, "STATE_INVALID");
  rejectExtraKeys(parsed, [
    "schemaVersion",
    "phase",
    "productionEligible",
    "createdAt",
    "updatedAt",
    "correlationId",
    "participant",
    "artifactBundleHash",
    "release",
    "releaseFingerprint",
    "recoveryIsolation",
    "evidence",
    "liveEvidence",
    "portableClosure",
  ], "STATE_INVALID");
  if (
    parsed.schemaVersion !== githubIndependentDrillSchemaVersion ||
    parsed.phase !== expectedPhase ||
    typeof parsed.productionEligible !== "boolean" ||
    utcTimestamp(parsed.createdAt, "STATE_INVALID") !== parsed.createdAt ||
    utcTimestamp(parsed.updatedAt, "STATE_INVALID") !== parsed.updatedAt ||
    !parsed.release ||
    !sha256Pattern.test(parsed.releaseFingerprint ?? "") ||
    !parsed.participant
  ) {
    throw new GithubIndependentDrillError("STATE_INVALID");
  }
  requireRecord(parsed.participant, "STATE_INVALID");
  rejectExtraKeys(parsed.participant, ["personId", "agentId"], "STATE_INVALID");
  requireProductionIdentifier(parsed.correlationId, "STATE_INVALID");
  requireProductionIdentifier(parsed.participant.personId, "STATE_INVALID");
  requireProductionIdentifier(parsed.participant.agentId, "STATE_INVALID");
  requireSha256(parsed.artifactBundleHash, "STATE_INVALID");
  const recoveryIsolation = normalizeRecoveryIsolationState(parsed.recoveryIsolation);
  if (parsed.createdAt !== recoveryIsolation.evidence.drill.observedAt) {
    throw new GithubIndependentDrillError("RECOVERY_ISOLATION_STATE_BINDING_MISMATCH");
  }
  if (
    (expectedPhase === "begun" && (
      parsed.evidence !== null
      || parsed.liveEvidence !== null
      || parsed.portableClosure !== null
    ))
    || (expectedPhase === "evidence_recorded" && (
      !parsed.evidence
      || !parsed.liveEvidence
      || parsed.portableClosure !== null
    ))
  ) {
    throw new GithubIndependentDrillError("STATE_INVALID");
  }
  const evidence = parsed.evidence === null ? null : normalizeObservedEvidence(parsed.evidence);
  const liveEvidence = parsed.liveEvidence === null ? null : normalizeLiveEvidence(parsed.liveEvidence);
  return {
    ...parsed,
    recoveryIsolation,
    evidence,
    liveEvidence,
  };
}

function normalizePersistedEvidenceFields(state) {
  return {
    ...state,
    recoveryIsolation: normalizeRecoveryIsolationState(state.recoveryIsolation),
    evidence: state.evidence === null ? null : normalizeObservedEvidence(state.evidence),
    liveEvidence: state.liveEvidence === null ? null : normalizeLiveEvidence(state.liveEvidence),
  };
}

function publicStateResult(state, outcome) {
  return Object.freeze({
    schemaVersion: githubIndependentDrillSchemaVersion,
    phase: state.phase,
    outcome,
    correlationId: state.correlationId,
    revision: state.release.gitSha,
    personId: state.participant.personId,
    agentId: state.participant.agentId,
    artifactBundleHash: state.artifactBundleHash,
    recoveryIsolation: {
      evidenceId: state.recoveryIsolation.evidence.evidenceId,
      evidenceHash: state.recoveryIsolation.evidenceHash,
      validUntil: state.recoveryIsolation.evidence.drill.validUntil,
      repositoryFullName: state.recoveryIsolation.evidence.githubObservation.repositoryFullName,
      repositoryId: state.recoveryIsolation.evidence.githubObservation.repositoryId,
      surfaceManifestHash: state.recoveryIsolation.evidence.surfaceManifest.hash,
    },
    ...(state.evidence ? {
      runId: state.evidence.run.id,
      receiptId: state.evidence.receipt.id,
      receiptHash: state.evidence.receipt.hash,
      reviewCount: state.evidence.reviews.length,
    } : {}),
    ...(state.liveEvidence ? {
      runtimeAssurance: state.liveEvidence.runtimeAssurance,
    } : {}),
    ...(state.portableClosure ? { portableClosure: state.portableClosure } : {}),
  });
}

function requireExternalStatePath(value, root) {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_024) {
    throw new GithubIndependentDrillError("STATE_PATH_INVALID");
  }
  const path = resolveDrillInputPath(value, root);
  const relativePath = relative(root, path);
  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    throw new GithubIndependentDrillError("STATE_PATH_INSIDE_REPOSITORY");
  }
  return path;
}

export function resolveDrillInputPath(value, root = repositoryRoot) {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_024) {
    throw new GithubIndependentDrillError("INPUT_PATH_INVALID");
  }
  return isAbsolute(value) ? resolve(value) : resolve(root, value);
}

function requireConfirmation(actual, expected) {
  if (actual !== expected) throw new GithubIndependentDrillError("CONFIRMATION_REQUIRED");
}

function requireHttpsOrigin(value, code) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new GithubIndependentDrillError(code);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new GithubIndependentDrillError(code);
  }
  return url;
}

function requireProductionIdentifier(value, code) {
  const normalized = requireIdentifier(value, code);
  if (forbiddenProductionMarker.test(normalized)) throw new GithubIndependentDrillError("FIXTURE_IDENTIFIER_FORBIDDEN");
  return normalized;
}

function requireIdentifier(value, code) {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    throw new GithubIndependentDrillError(code);
  }
  return value;
}

function requireRevision(value, code) {
  if (typeof value !== "string" || !revisionPattern.test(value)) {
    throw new GithubIndependentDrillError(code);
  }
  return value;
}

function requireSha256(value, code) {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    throw new GithubIndependentDrillError(code);
  }
  return value;
}

function requiredSetting(environment, name, code) {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) throw new GithubIndependentDrillError(code);
  return value;
}

function utcTimestamp(value, code) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new GithubIndependentDrillError(code);
  return date.toISOString();
}

function requireRecord(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GithubIndependentDrillError(code);
  }
}

function rejectExtraKeys(value, allowed, code) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new GithubIndependentDrillError(code);
  }
}

function parseCliArguments(args) {
  const phase = args[0] && !args[0].startsWith("--") ? args[0] : "preflight";
  const offset = phase === "preflight" && args[0]?.startsWith("--") ? 0 : 1;
  if (!["preflight", "begin", "record", "finalize"].includes(phase)) {
    throw new GithubIndependentDrillError("ARGUMENTS_INVALID");
  }
  const values = {};
  for (let index = offset; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new GithubIndependentDrillError("ARGUMENTS_INVALID");
    }
    const key = flag.slice(2);
    if (Object.hasOwn(values, key)) throw new GithubIndependentDrillError("ARGUMENTS_INVALID");
    values[key] = value;
  }
  const allowed = {
    preflight: new Set(),
    begin: new Set(["state", "confirm", "correlation-id", "person-id", "agent-id", "bundle-hash"]),
    record: new Set(["state", "confirm", "evidence"]),
    finalize: new Set(["state", "confirm", "correlation-id", "receipt-bundle"]),
  }[phase];
  if (Object.keys(values).some((key) => !allowed.has(key))) {
    throw new GithubIndependentDrillError("ARGUMENTS_INVALID");
  }
  return { phase, values };
}

async function readJsonArgument(path, code, root = repositoryRoot) {
  if (typeof path !== "string") throw new GithubIndependentDrillError(code);
  try {
    const normalizedPath = resolveDrillInputPath(path, root);
    return JSON.parse(await readFile(normalizedPath, "utf8"));
  } catch (cause) {
    throw new GithubIndependentDrillError(code, { cause });
  }
}

async function runCli() {
  let phase = "preflight";
  try {
    const parsed = parseCliArguments(process.argv.slice(2));
    phase = parsed.phase;
    const drill = createGithubIndependentProductionDrill();
    let result;
    if (phase === "preflight") {
      result = await drill.preflight();
    } else if (phase === "begin") {
      result = await drill.begin({
        statePath: parsed.values.state,
        confirmation: parsed.values.confirm,
        correlationId: parsed.values["correlation-id"],
        personId: parsed.values["person-id"],
        agentId: parsed.values["agent-id"],
        artifactBundleHash: parsed.values["bundle-hash"],
      });
    } else if (phase === "record") {
      result = await drill.record({
        statePath: parsed.values.state,
        confirmation: parsed.values.confirm,
        evidence: await readJsonArgument(parsed.values.evidence, "EVIDENCE_FILE_INVALID"),
      });
    } else {
      result = await drill.finalize({
        statePath: parsed.values.state,
        confirmation: parsed.values.confirm,
        correlationId: parsed.values["correlation-id"],
        verificationBundle: await readJsonArgument(
          parsed.values["receipt-bundle"],
          "PORTABLE_RECEIPT_FILE_INVALID",
        ),
      });
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: githubIndependentDrillSchemaVersion,
      phase,
      outcome: "failed",
      errorCode: typeof error?.code === "string" ? error.code : "DRILL_FAILED",
    })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
