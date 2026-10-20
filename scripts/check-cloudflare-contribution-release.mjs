#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { checkCredentialedContributionGraph, loadCredentialedContributionEvidence, rejectCredentialMaterial } from "./check-credentialed-contribution-release.mjs";
import { bindCloudflareReleaseEvidence, CloudflareReleaseEvidenceError, validateCloudflareComponentManifest } from "./lib/cloudflare-release-evidence.mjs";

export const cloudflareContributionSchema = "pw-cloudflare-contribution-release-evidence-v2";

/** Offline consistency only. Neither this function nor its input authorizes operations. */
export async function checkCloudflareContributionRelease({ evidence, manifest, expectedManifestHash } = {}) {
  rejectCredentialMaterial(evidence);
  manifest = structuredClone(validateCloudflareComponentManifest(manifest, expectedManifestHash));
  evidence = structuredClone(evidence);
  if (evidence?.schemaVersion !== cloudflareContributionSchema) throw new CloudflareReleaseEvidenceError("CONTRIBUTION_SCHEMA_UNSUPPORTED");
  if (Object.keys(evidence).sort().join(",") !== ["schemaVersion", "release", "researcher", "attempt", "bundle", "runner", "reviews", "receipt", "publicReceiptVerification"].sort().join(",")) throw new CloudflareReleaseEvidenceError("CONTRIBUTION_FIELDS_INVALID");
  const release = evidence.release;
  if (!release || Object.keys(release).sort().join(",") !== "after,before") throw new CloudflareReleaseEvidenceError("RELEASE_OBSERVATIONS_REQUIRED");
  // No synthetic same-SHA/Sites observation is passed to the v1 release checker.
  const before = await bindCloudflareReleaseEvidence({ manifest, expectedManifestHash, observation: release.before });
  const after = await bindCloudflareReleaseEvidence({ manifest, expectedManifestHash, observation: release.after });
  if (Date.parse(before.observedAt) > Date.parse(after.observedAt)) throw new CloudflareReleaseEvidenceError("RELEASE_WINDOW_INVALID");
  if (manifest.modes.global !== "read_write" || manifest.modes.participant !== "read_write" || manifest.modes.mcp !== "read_write" || manifest.modes.runner !== "ready") throw new CloudflareReleaseEvidenceError("CONTRIBUTION_EXECUTION_EVIDENCE_REQUIRED");
  const graph = checkCredentialedContributionGraph(evidence, { before: before.observedAt, after: after.observedAt });
  return {
    schemaVersion: "pw-cloudflare-contribution-release-check-v2", outcome: "consistent", executionMode: "offline_dry_run",
    release: { manifestHash: expectedManifestHash, environment: manifest.environment, componentsIndependentlyBound: true, databaseFingerprint: before.databaseFingerprint, migrationHead: before.migrationHead },
    ...graph,
    boundary: { ...graph.boundary, executionAuthorized: false, releaseApproved: false, liveProviderStateVerified: false, fineGrainedWriteGateVerified: false, statement: "Offline evidence consistency only; not authorization, cryptographic signature verification, live provider attestation, or proof of a Person/Agent/Attempt write gate." },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const bindingOnly = args[0] === "--binding-only";
    if (bindingOnly) args.shift();
    if (args.length !== 6 || args[0] !== "--evidence-file" || args[2] !== "--manifest-file" || args[4] !== "--expected-manifest-hash") throw new CloudflareReleaseEvidenceError("CLI_ARGUMENT_INVALID");
    // Reuse the bounded, non-symlink input loader; do not read credential env vars.
    const evidence = await loadCredentialedContributionEvidence({ filePath: args[1], environment: {} });
    const manifest = await loadCredentialedContributionEvidence({ filePath: args[3], environment: {} });
    const result = bindingOnly
      ? { schemaVersion: "pw-cloudflare-component-release-check-v1", outcome: "consistent",
          binding: await bindCloudflareReleaseEvidence({ manifest, expectedManifestHash: args[5], observation: evidence }),
          boundary: { networkRequestsMade: false, executionAuthorized: false, releaseApproved: false, liveProviderStateVerified: false } }
      : await checkCloudflareContributionRelease({ evidence, manifest, expectedManifestHash: args[5] });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (error) {
    process.stderr.write(JSON.stringify({ outcome: "failed", errorCode: error?.code ?? "CLOUDFLARE_CONTRIBUTION_CHECK_FAILED", executionAuthorized: false }) + "\n");
    process.exitCode = 1;
  }
}
