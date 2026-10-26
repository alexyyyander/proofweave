import { loadProofweaveMigrations } from "../../services/database/libsql-migrations.mjs";
import { controlPlaneOperationState, controlPlaneSurfaceOperationState } from "../../services/database/control-plane-operation-mode.mjs";
import { releaseEvidenceHash, cloudflareComponentManifestSchema } from "../../scripts/lib/cloudflare-release-evidence.mjs";

export async function releaseFixture({ production = false, paused = true } = {}) {
  const migrations = await loadProofweaveMigrations();
  const ledger = migrations.map(m => ({ name: m.name, sha256: m.sha256, applied_at: "2026-07-29T09:00:00Z", statement_count: m.statementCount }));
  const manifest = {
    schemaVersion: cloudflareComponentManifestSchema,
    environment: { kind: production ? "production" : "staging", origin: production ? "https://proofweave.org" : "https://staging.example" },
    database: { fingerprint: production ? "3f9e7934a04a22ec" : "0123456789abcdef", ledgerDigest: releaseEvidenceHash(ledger) },
    cloudflare: { sourceKind: "migration_snapshot", sourceRevision: "c".repeat(64), deploymentId: "12345678-1234-1234-1234-123456789abc", artifactDigest: "sha256:" + "d".repeat(64) },
    runner: { origin: "https://runner.example", revision: "a".repeat(40), serviceId: "srv-test", deployId: "dep-test", sitesVersion: "192", siteProjectId: "appgprj_" + "f".repeat(32) },
    e2b: { imageDigest: "registry.example/runner@sha256:" + "1".repeat(64), templateId: "template:immutable-label", templateBuildId: "immutable-build", leanToolchain: "leanprover/lean4:v4.31.0", mathlibRevision: "2".repeat(40) },
    loginBridge: { origin: "https://bridge.example", sourceRevision: "b".repeat(40), sitesVersion: "204", siteProjectId: "appgprj_" + "e".repeat(32), artifactDigest: "sha256:" + "3".repeat(64) },
    modes: { global: "read_write", participant: paused ? "read_only" : "read_write", mcp: paused ? "read_only" : "read_write", runner: paused ? "paused" : "ready" },
  };
  const surface = name => controlPlaneSurfaceOperationState({ globalValue: manifest.modes.global, surfaceValue: manifest.modes[name], surface: name });
  const participantOperations = surface("participant");
  const diagnostics = { schemaVersion: "pw-live-release-diagnostics-v2", state: "ready", authority: "turso", databaseFingerprint: manifest.database.fingerprint, ledgerHead: migrations.at(-1).name, sourceRevision: manifest.cloudflare.sourceRevision, sitesVersion: null, siteProjectId: null, hostingPlatform: "cloudflare", deploymentId: manifest.cloudflare.deploymentId, failureCode: null };
  const observation = {
    observedAt: "2026-07-29T10:00:00Z",
    cloudflare: { origin: manifest.environment.origin,
      capabilities: { releaseDiagnostics: diagnostics, globalControlPlaneOperations: controlPlaneOperationState("read_write"), participantOperations, mcpOperations: surface("mcp"), controlPlaneOperations: { schemaVersion: "pw-control-plane-operation-state-v1", mode: participantOperations.mode, writesEnabled: participantOperations.writesEnabled, explicitlyConfigured: true, failureCode: participantOperations.failureCodes[0] ?? null } },
      deployment: { id: manifest.cloudflare.deploymentId, sourceRevision: manifest.cloudflare.sourceRevision, artifactDigest: manifest.cloudflare.artifactDigest } },
    runner: { origin: manifest.runner.origin,
      deployment: { serviceId: manifest.runner.serviceId, id: manifest.runner.deployId, revision: manifest.runner.revision, autoDeploy: "no" },
      health: { service: "proofweave-trusted-runner", state: manifest.modes.runner, provider: "e2b", revision: manifest.runner.revision, executionEnabled: !paused, executionBoundary: "isolated-sandbox-only", lastWakeAt: null,
        releaseDiagnostics: { schemaVersion: "pw-live-release-diagnostics-v2", state: "ready", authority: "turso", databaseFingerprint: manifest.database.fingerprint, ledgerHead: migrations.at(-1).name, sourceRevision: manifest.runner.revision, sitesVersion: manifest.runner.sitesVersion, siteProjectId: manifest.runner.siteProjectId, failureCode: null },
        runnerPolicy: { state: "configured", sandboxImageDigest: manifest.e2b.imageDigest, sandboxImageApproved: true, templateId: manifest.e2b.templateId, templateBuildId: manifest.e2b.templateBuildId, approvedImages: [{ imageDigest: manifest.e2b.imageDigest, leanToolchain: manifest.e2b.leanToolchain, mathlibRevision: manifest.e2b.mathlibRevision }] } } },
    e2b: { ...manifest.e2b },
    loginBridge: { ...manifest.loginBridge },
    database: { fingerprint: manifest.database.fingerprint, ledger },
  };
  return structuredClone({ manifest, expectedManifestHash: releaseEvidenceHash(manifest), observation });
}
