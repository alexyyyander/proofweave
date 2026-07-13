import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runnerKeyFingerprint } from "../packages/protocol/runner-key-registry.mjs";
import { validateLeanRunnerDeploymentManifest } from "./preflight-lean-runner-deployment.mjs";

/**
 * Render a parameterized, reviewable D1 enrollment plan. This is deliberately
 * not a D1 client: an operator applies it through an audited secret-bearing
 * deployment channel after the manifest and key-pair checks have passed.
 */
export async function renderRunnerKeyEnrollmentPlan(manifest) {
  const config = validateLeanRunnerDeploymentManifest(manifest);
  const runnerKey = Object.freeze({
    id: config.keys.runnerResult.id,
    publicKey: config.keys.runnerResult.publicKey,
    fingerprint: await runnerKeyFingerprint(config.keys.runnerResult.publicKey),
  });
  const parameters = Object.freeze([runnerKey.id, runnerKey.publicKey, runnerKey.fingerprint]);
  return Object.freeze({
    protocolVersion: "pw-runner-key-enrollment-v1",
    controlPlane: Object.freeze({
      databaseName: config.controlPlane.databaseName,
      databaseId: config.controlPlane.databaseId,
    }),
    runnerKey,
    precondition: Object.freeze({
      statement: "SELECT id, public_key, fingerprint, status, revoked_at FROM runner_keys WHERE id = ? OR public_key = ? OR fingerprint = ?",
      parameters,
      expectedRows: 0,
    }),
    enrollment: Object.freeze({
      statement: "INSERT INTO runner_keys (id, public_key, fingerprint, status, revoked_at) VALUES (?, ?, ?, 'active', NULL)",
      parameters,
    }),
    verification: Object.freeze({
      statement: "SELECT id, public_key, fingerprint, status, revoked_at FROM runner_keys WHERE id = ? AND public_key = ? AND fingerprint = ? AND status = 'active' AND revoked_at IS NULL",
      parameters,
      expectedRows: 1,
    }),
  });
}

async function main() {
  const [manifestPath] = process.argv.slice(2);
  if (!manifestPath || process.argv.length !== 3) {
    throw new Error("Usage: node scripts/render-runner-key-enrollment.mjs <runner-deployment-manifest.json>");
  }
  const manifest = await readJson(manifestPath);
  process.stdout.write(`${JSON.stringify(await renderRunnerKeyEnrollmentPlan(manifest), null, 2)}\n`);
  process.stdout.write("Review this public-key-only plan, verify the precondition returns no rows, apply the parameterized enrollment through the audited D1 operator channel, then verify exactly one active row. This command does not contact D1, enable execution, or handle private keys.\n");
}

async function readJson(path) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (cause) {
    throw new Error("Runner deployment manifest could not be read.", { cause });
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new Error("Runner deployment manifest must be valid JSON.");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Runner key enrollment plan failed."}\n`);
    process.exitCode = 1;
  });
}
