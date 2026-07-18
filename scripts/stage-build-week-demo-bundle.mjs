import { pathToFileURL } from "node:url";
import { createRemoteLibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import { stageBuildWeekDemoBundle } from "../services/demo/d1-build-week-demo-bundle.mjs";

export async function runStageBuildWeekDemoBundle({ sourceArtifactBundleHash, environment = process.env }) {
  const database = createRemoteLibsqlD1Database({
    url: required(environment, "TURSO_DATABASE_URL"),
    authToken: required(environment, "TURSO_AUTH_TOKEN"),
  });
  try {
    return await stageBuildWeekDemoBundle({ database, sourceArtifactBundleHash });
  } finally {
    database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStageBuildWeekDemoBundle({ sourceArtifactBundleHash: process.argv[2] }).then((result) => {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: "pw-audit-v1",
      kind: "build_week_local_demo_bundle_staged",
      component: "build_week_demo_bundle",
      outcome: result.state,
      sourceArtifactBundleHash: result.sourceArtifactBundleHash,
      artifactBundleHash: result.artifactBundleHash,
      personId: result.personId,
      agentId: result.agentId,
      attemptId: result.attemptId,
      privateKeysPersisted: result.privateKeysPersisted,
    })}\n`);
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: "pw-audit-v1",
      kind: "build_week_local_demo_bundle_stage_failed",
      component: "build_week_demo_bundle",
      outcome: "failed",
      errorCode: safeErrorCode(error),
    })}\n`);
    process.exitCode = 1;
  });
}

function required(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0 || value.length > 16_384) throw new Error(`${name} is required.`);
  return value;
}

function safeErrorCode(error) {
  const value = typeof error?.name === "string" ? error.name : "demo_bundle_error";
  const normalized = value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
  return /^[a-z][a-z0-9_]{2,63}$/.test(normalized) ? normalized : "demo_bundle_error";
}
