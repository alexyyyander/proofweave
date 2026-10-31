import { createHash } from "node:crypto";
import { canonicalJson } from "../../packages/protocol/canonical-json.mjs";
import { loadProofweaveMigrations, verifyProofweaveMigrationLedger } from "../../services/database/libsql-migrations.mjs";
import { normalizeRunnerReleaseHealth, runnerReleaseHealthModes } from "./github-independent-live-release-binding.mjs";
import { rejectCredentialMaterial } from "../check-credentialed-contribution-release.mjs";

const maxProviderAgeMilliseconds = 5 * 60 * 1000;
const maxCollectionMilliseconds = 30 * 1000;
const systemClock = () => new Date();

const head = "0050_add_runner_queue_environment.sql";
const digest = /^sha256:[a-f0-9]{64}$/;
const revision = /^[a-f0-9]{40}$/;
const sourceDigest = /^[a-f0-9]{64}$/;
const fingerprint = /^[a-f0-9]{16}$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const project = /^appgprj_[a-f0-9]{32}$/;
const label = /^[A-Za-z0-9][A-Za-z0-9:._+/-]{0,319}$/;
const image = /^[A-Za-z0-9][A-Za-z0-9./:_-]*@sha256:[a-f0-9]{64}$/;
export const cloudflareComponentManifestSchema = "pw-cloudflare-component-release-v1";

export class CloudflareReleaseEvidenceError extends Error {
  constructor(code) { super(code); this.name = "CloudflareReleaseEvidenceError"; this.code = code; }
}
function requireValue(ok, code) { if (!ok) throw new CloudflareReleaseEvidenceError(code); }
function record(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function keys(v, names, code) {
  requireValue(record(v) && Object.keys(v).sort().join(",") === names.split(" ").sort().join(","), code);
}
function match(actual, expected, code) { requireValue(actual === expected, code); }
function format(v, pattern, code) { requireValue(typeof v === "string" && pattern.test(v), code); }
function origin(v) {
  let u; try { u = new URL(v); } catch { requireValue(false, "ORIGIN_INVALID"); }
  requireValue(u.protocol === "https:" && u.origin === v && !u.username && !u.password, "ORIGIN_INVALID");
}
export function releaseEvidenceHash(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
export function releaseObservationTime(v) {
  requireValue(typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v) && Number.isFinite(Date.parse(v)), "OBSERVATION_TIME_INVALID");
  const normalized = new Date(v).toISOString();
  requireValue(normalized === v || normalized.replace(".000Z", "Z") === v, "OBSERVATION_TIME_INVALID");
  return v;
}

function collectionWindow(value) {
  keys(value, "providerObservedAt startedAt completedAt", "COLLECTION_WINDOW_INVALID");
  for (const timestamp of Object.values(value)) releaseObservationTime(timestamp);
  const provider = Date.parse(value.providerObservedAt);
  const start = Date.parse(value.startedAt);
  const end = Date.parse(value.completedAt);
  requireValue(provider <= start && start - provider <= maxProviderAgeMilliseconds, "PROVIDER_OBSERVATION_TIME_MISMATCH");
  requireValue(end >= start && end - start <= maxCollectionMilliseconds, "COLLECTION_WINDOW_INVALID");
  return value;
}

function clockTime(now) {
  requireValue(typeof now === "function", "OBSERVATION_CLOCK_INVALID");
  const date = now();
  requireValue(date instanceof Date && Number.isFinite(date.getTime()), "OBSERVATION_CLOCK_INVALID");
  return date.toISOString();
}

/** The hash must come from independent review; hashing an input is not approval. */
export function validateCloudflareComponentManifest(manifest, expectedManifestHash) {
  rejectCredentialMaterial(manifest);
  format(expectedManifestHash, digest, "REVIEWED_MANIFEST_HASH_REQUIRED");
  match(releaseEvidenceHash(manifest), expectedManifestHash, "REVIEWED_MANIFEST_HASH_MISMATCH");
  keys(manifest, "schemaVersion environment database cloudflare runner e2b loginBridge modes", "MANIFEST_INVALID");
  match(manifest.schemaVersion, cloudflareComponentManifestSchema, "MANIFEST_SCHEMA_UNSUPPORTED");
  const { environment: e, database: d, cloudflare: c, runner: r, e2b: b, loginBridge: l, modes: m } = manifest;
  keys(e, "kind origin", "ENVIRONMENT_INVALID"); origin(e.origin);
  requireValue(["staging", "production"].includes(e.kind), "ENVIRONMENT_INVALID");
  keys(d, "fingerprint ledgerDigest", "DATABASE_MANIFEST_INVALID");
  format(d.fingerprint, fingerprint, "DATABASE_MANIFEST_INVALID"); format(d.ledgerDigest, digest, "DATABASE_MANIFEST_INVALID");
  if (e.kind === "production") {
    match(e.origin, "https://proofweave.org", "PRODUCTION_AUTHORITY_MISMATCH");
    match(d.fingerprint, "3f9e7934a04a22ec", "PRODUCTION_AUTHORITY_MISMATCH");
  } else {
    requireValue(e.origin !== "https://proofweave.org" && d.fingerprint !== "3f9e7934a04a22ec", "STAGING_PRODUCTION_AUTHORITY_FORBIDDEN");
  }
  keys(c, "sourceKind sourceRevision deploymentId artifactDigest", "CLOUDFLARE_MANIFEST_INVALID");
  requireValue(["git_commit", "migration_snapshot"].includes(c.sourceKind), "SOURCE_KIND_INVALID");
  format(c.sourceRevision, c.sourceKind === "git_commit" ? revision : sourceDigest, "SOURCE_IDENTITY_INVALID");
  format(c.deploymentId, uuid, "CLOUDFLARE_MANIFEST_INVALID"); format(c.artifactDigest, digest, "CLOUDFLARE_MANIFEST_INVALID");
  keys(r, "origin revision serviceId deployId sitesVersion siteProjectId", "RUNNER_MANIFEST_INVALID"); origin(r.origin);
  format(r.revision, revision, "RUNNER_MANIFEST_INVALID"); format(r.serviceId, /^srv-[a-z0-9]+$/, "RUNNER_MANIFEST_INVALID");
  format(r.deployId, /^dep-[a-z0-9]+$/, "RUNNER_MANIFEST_INVALID"); format(r.sitesVersion, label, "RUNNER_MANIFEST_INVALID");
  format(r.siteProjectId, project, "RUNNER_MANIFEST_INVALID");
  keys(b, "imageDigest templateId templateBuildId leanToolchain mathlibRevision", "E2B_MANIFEST_INVALID");
  format(b.imageDigest, image, "E2B_MANIFEST_INVALID"); format(b.mathlibRevision, revision, "E2B_MANIFEST_INVALID");
  for (const k of ["templateId", "templateBuildId", "leanToolchain"]) format(b[k], label, "E2B_MANIFEST_INVALID");
  keys(l, "origin sourceRevision sitesVersion siteProjectId artifactDigest", "BRIDGE_MANIFEST_INVALID"); origin(l.origin);
  format(l.sourceRevision, revision, "BRIDGE_MANIFEST_INVALID"); format(l.sitesVersion, label, "BRIDGE_MANIFEST_INVALID");
  format(l.siteProjectId, project, "BRIDGE_MANIFEST_INVALID"); format(l.artifactDigest, digest, "BRIDGE_MANIFEST_INVALID");
  requireValue(new Set([e.origin, r.origin, l.origin]).size === 3, "COMPONENT_ORIGINS_MUST_DIFFER");
  keys(m, "global participant mcp runner", "MODES_INVALID");
  for (const k of ["global", "participant", "mcp"]) requireValue(["read_only", "read_write"].includes(m[k]), "MODES_INVALID");
  requireValue(["paused", "ready"].includes(m.runner), "MODES_INVALID");
  requireValue(m.global === "read_write" || (m.participant === "read_only" && m.mcp === "read_only"), "MODES_INVALID");
  return manifest;
}

/** Bind captured provider records and public diagnostics. No network or database is opened. */
export async function bindCloudflareReleaseEvidence({ manifest, expectedManifestHash, observation } = {}) {
  const m = structuredClone(validateCloudflareComponentManifest(manifest, expectedManifestHash));
  rejectCredentialMaterial(observation);
  observation = structuredClone(observation);
  const hasCollectionWindow = record(observation) && Object.hasOwn(observation, "collectionWindow");
  keys(observation, "observedAt cloudflare runner e2b loginBridge database" + (hasCollectionWindow ? " collectionWindow" : ""), "OBSERVATION_INVALID");
  releaseObservationTime(observation.observedAt);
  if (hasCollectionWindow) {
    collectionWindow(observation.collectionWindow);
    match(observation.observedAt, observation.collectionWindow.completedAt, "OBSERVATION_COLLECTION_TIME_MISMATCH");
  }
  const migrations = await loadProofweaveMigrations();
  requireValue(migrations.length === 51 && migrations.at(-1).name === head, "REVIEWED_MIGRATION_HISTORY_CHANGED");
  keys(observation.database, "fingerprint ledger", "DATABASE_OBSERVATION_INVALID");
  match(observation.database.fingerprint, m.database.fingerprint, "DATABASE_FINGERPRINT_MISMATCH");
  const ledger = observation.database.ledger;
  requireValue(Array.isArray(ledger), "MIGRATION_LEDGER_INVALID");
  for (const row of ledger) keys(row, "name sha256 applied_at statement_count", "MIGRATION_LEDGER_INVALID");
  verifyProofweaveMigrationLedger({ migrations, rows: ledger });
  requireValue(ledger.every(row => Date.parse(row.applied_at) <= Date.parse(observation.observedAt)), "MIGRATION_APPLIED_AFTER_OBSERVATION");
  match(releaseEvidenceHash(ledger), m.database.ledgerDigest, "MIGRATION_LEDGER_DIGEST_MISMATCH");
  const c = observation.cloudflare;
  keys(c, "origin capabilities deployment", "CLOUDFLARE_OBSERVATION_INVALID");
  match(c.origin, m.environment.origin, "CLOUDFLARE_ORIGIN_MISMATCH");
  keys(c.deployment, "id sourceRevision artifactDigest", "CLOUDFLARE_DEPLOYMENT_INVALID");
  for (const [key, value] of Object.entries({ id: m.cloudflare.deploymentId, sourceRevision: m.cloudflare.sourceRevision, artifactDigest: m.cloudflare.artifactDigest })) {
    match(c.deployment[key], value, "CLOUDFLARE_DEPLOYMENT_MISMATCH");
  }
  const d = c.capabilities?.releaseDiagnostics;
  keys(d, "schemaVersion state authority databaseFingerprint ledgerHead sourceRevision sitesVersion siteProjectId hostingPlatform deploymentId failureCode", "CLOUDFLARE_DIAGNOSTICS_INVALID");
  for (const [key, value] of Object.entries({ schemaVersion: "pw-live-release-diagnostics-v2", state: "ready", authority: "turso", databaseFingerprint: m.database.fingerprint, ledgerHead: head, sourceRevision: m.cloudflare.sourceRevision, sitesVersion: null, siteProjectId: null, hostingPlatform: "cloudflare", deploymentId: m.cloudflare.deploymentId, failureCode: null })) {
    match(d[key], value, "CLOUDFLARE_DIAGNOSTICS_MISMATCH");
  }
  checkModes(c.capabilities, m.modes);
  const r = observation.runner;
  keys(r, "origin health deployment", "RUNNER_OBSERVATION_INVALID");
  match(r.origin, m.runner.origin, "RUNNER_ORIGIN_MISMATCH");
  keys(r.deployment, "serviceId id revision autoDeploy", "RUNNER_DEPLOYMENT_INVALID");
  for (const [key, value] of Object.entries({ serviceId: m.runner.serviceId, id: m.runner.deployId, revision: m.runner.revision, autoDeploy: "no" })) match(r.deployment[key], value, "RUNNER_DEPLOYMENT_MISMATCH");
  const health = normalizeRunnerReleaseHealth(r.health, {
    expected: { ...m.e2b, ...m.runner, databaseFingerprint: m.database.fingerprint, ledgerHead: head },
    mode: m.modes.runner === "paused" ? runnerReleaseHealthModes.phase6Paused : runnerReleaseHealthModes.liveExecution,
  });
  requireValue(health.runnerPolicy.approvedImages.length === 1, "E2B_APPROVAL_SET_MISMATCH");
  keys(observation.e2b, "imageDigest templateId templateBuildId leanToolchain mathlibRevision", "E2B_OBSERVATION_INVALID");
  for (const [key, value] of Object.entries(m.e2b)) match(observation.e2b[key], value, "E2B_BUILD_MISMATCH");
  keys(observation.loginBridge, "origin sourceRevision sitesVersion siteProjectId artifactDigest", "BRIDGE_OBSERVATION_INVALID");
  for (const [key, value] of Object.entries(m.loginBridge)) match(observation.loginBridge[key], value, "BRIDGE_DEPLOYMENT_MISMATCH");
  return { observedAt: observation.observedAt, manifestHash: expectedManifestHash, databaseFingerprint: m.database.fingerprint, migrationHead: head, runnerState: health.state,
    ...(hasCollectionWindow ? { collectionWindow: observation.collectionWindow } : {}) };
}

function checkModes(capabilities, expected) {
  const global = capabilities.globalControlPlaneOperations;
  match(global?.schemaVersion, "pw-control-plane-operation-state-v1", "SITE_MODE_MISMATCH");
  match(global?.explicitlyConfigured, true, "SITE_MODE_MISMATCH"); match(global?.failureCode, null, "SITE_MODE_MISMATCH");
  match(global?.mode, expected.global, "SITE_MODE_MISMATCH"); match(global?.writesEnabled, expected.global === "read_write", "SITE_MODE_MISMATCH");
  for (const surface of ["participant", "mcp"]) {
    const state = capabilities[`${surface}Operations`];
    match(state?.schemaVersion, "pw-control-plane-surface-operation-state-v1", "SITE_MODE_MISMATCH");
    match(state?.surface, surface, "SITE_MODE_MISMATCH"); match(state?.mode, expected[surface], "SITE_MODE_MISMATCH");
    match(state?.writesEnabled, expected[surface] === "read_write", "SITE_MODE_MISMATCH");
    match(releaseEvidenceHash(state?.global), releaseEvidenceHash(global), "SITE_MODE_MISMATCH");
    match(state?.configuration?.mode, expected[surface], "SITE_MODE_MISMATCH");
    match(state?.configuration?.explicitlyConfigured, true, "SITE_MODE_MISMATCH");
    match(state?.configuration?.failureCode, null, "SITE_MODE_MISMATCH");
    match(state?.configuration?.writesEnabled, expected[surface] === "read_write", "SITE_MODE_MISMATCH");
    const failures = [...(expected.global === "read_only" ? ["global_operation_mode_read_only"] : []), ...(expected[surface] === "read_only" ? [`${surface}_operation_mode_read_only`] : [])];
    match(releaseEvidenceHash(state?.failureCodes), releaseEvidenceHash(failures), "SITE_MODE_MISMATCH");
  }
  match(releaseEvidenceHash(capabilities.controlPlaneOperations), releaseEvidenceHash({
    schemaVersion: "pw-control-plane-operation-state-v1", mode: expected.participant,
    writesEnabled: expected.participant === "read_write", explicitlyConfigured: true,
    failureCode: capabilities.participantOperations.failureCodes[0] ?? null,
  }), "SITE_MODE_MISMATCH");
}

/** Fetch only two fixed public GETs; provider records and ledger must be collected separately. */
export async function inspectCloudflareReleaseEvidence({ manifest, expectedManifestHash, providerObservation, fetcher = globalThis.fetch, now = systemClock } = {}) {
  manifest = structuredClone(validateCloudflareComponentManifest(manifest, expectedManifestHash));
  rejectCredentialMaterial(providerObservation);
  providerObservation = structuredClone(providerObservation);
  const startedAt = clockTime(now);
  const providerObservedAt = releaseObservationTime(providerObservation?.observedAt);
  // Reject stale or future provider records before making either public GET.
  collectionWindow({ providerObservedAt, startedAt, completedAt: startedAt });
  const read = async (base, path) => {
    const url = base + path;
    let response;
    try { response = await fetcher(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(15000), headers: { accept: "application/json" } }); }
    catch { throw new CloudflareReleaseEvidenceError("PUBLIC_DIAGNOSTICS_UNREACHABLE"); }
    requireValue(response.status === 200 && !response.redirected && (!response.url || response.url === url), "PUBLIC_DIAGNOSTICS_RESPONSE_INVALID");
    requireValue(/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? ""), "PUBLIC_DIAGNOSTICS_RESPONSE_INVALID");
    const reader = response.body?.getReader(); requireValue(reader, "PUBLIC_DIAGNOSTICS_RESPONSE_INVALID");
    const chunks = []; let size = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; requireValue(size <= 65536, "PUBLIC_DIAGNOSTICS_TOO_LARGE"); chunks.push(value); }
    } finally { await reader.cancel(); }
    const data = Buffer.concat(chunks);
    try { return JSON.parse(data.toString("utf8")); } catch { throw new CloudflareReleaseEvidenceError("PUBLIC_DIAGNOSTICS_JSON_INVALID"); }
  };
  const [capabilities, health] = await Promise.all([
    read(manifest.environment.origin, "/api/mcp/capabilities"), read(manifest.runner.origin, "/healthz"),
  ]);
  const completedAt = clockTime(now);
  const window = collectionWindow({ providerObservedAt, startedAt, completedAt });
  const observation = { ...providerObservation, observedAt: completedAt, collectionWindow: window,
    cloudflare: { ...providerObservation?.cloudflare, capabilities },
    runner: { ...providerObservation?.runner, health },
  };
  const binding = await bindCloudflareReleaseEvidence({ manifest, expectedManifestHash, observation });
  return { binding, observation, boundary: { publicGetRequestsOnly: true, providerRecordsIndependentlyRequired: true, executionAuthorized: false, liveProviderStateVerified: false,
    fixtureOnly: fetcher !== globalThis.fetch || now !== systemClock } };
}
