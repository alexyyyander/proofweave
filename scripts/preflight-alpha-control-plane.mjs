import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateMcpControlPlaneManifest } from "./preflight-mcp-control-plane.mjs";
import { validateLeanRunnerDeploymentManifest } from "./preflight-lean-runner-deployment.mjs";

/**
 * The MCP gateway and isolated Runner may be deployed separately, but they
 * cannot use independently valid D1/R2 resources. This non-secret preflight
 * checks the pair before any Worker configuration is rendered or deployed.
 */
export function validateAlphaControlPlaneTopology({ mcpManifest, runnerManifest } = {}) {
  const mcp = validateMcpControlPlaneManifest(mcpManifest);
  const runner = validateLeanRunnerDeploymentManifest(runnerManifest);
  assertSame("D1 database name", mcp.controlPlane.databaseName, runner.controlPlane.databaseName);
  assertSame("D1 database ID", mcp.controlPlane.databaseId, runner.controlPlane.databaseId);
  assertSame("R2 bucket name", mcp.controlPlane.bucketName, runner.controlPlane.bucketName);

  return Object.freeze({
    controlPlane: Object.freeze({ ...mcp.controlPlane }),
    gateway: Object.freeze({ ...mcp.gateway }),
    identity: Object.freeze({ ...mcp.identity }),
    runner: Object.freeze({
      workerName: runner.runner.workerName,
      queueName: runner.queue.name,
      deadLetterQueue: runner.queue.deadLetterQueue,
      image: Object.freeze({ ...runner.runner.image }),
      controlPlaneKeyId: runner.keys.controlPlaneIssuer.id,
      runnerResultKeyId: runner.keys.runnerResultKeyId,
      executionEnabled: false,
    }),
  });
}

async function main() {
  const [mcpPath, runnerPath] = process.argv.slice(2);
  if (!mcpPath || !runnerPath || process.argv.length !== 4) {
    throw new Error("Usage: node scripts/preflight-alpha-control-plane.mjs <mcp-manifest.json> <runner-manifest.json>");
  }
  const [mcpManifest, runnerManifest] = await Promise.all([
    readJson(mcpPath, "MCP control-plane manifest"),
    readJson(runnerPath, "Runner deployment manifest"),
  ]);
  const topology = validateAlphaControlPlaneTopology({ mcpManifest, runnerManifest });
  process.stdout.write(`${JSON.stringify(topology, null, 2)}\n`);
  process.stdout.write("MCP and Runner manifests share one D1/R2 authority. This check does not deploy a Worker, create a resource, enable Runner execution, or verify provider isolation.\n");
}

async function readJson(path, label) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (cause) {
    throw new Error(`${label} could not be read.`, { cause });
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}

function assertSame(label, left, right) {
  if (left !== right) {
    throw new Error(`MCP and Runner manifests must use the same ${label}.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Invalid alpha control-plane topology."}\n`);
    process.exitCode = 1;
  });
}
