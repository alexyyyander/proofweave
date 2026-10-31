import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { normalizeLeanRunnerLimits } from "../../packages/protocol/lean-runner.mjs";
import { D1InlineArtifactBucket } from "../../services/artifacts/d1-inline-artifact-store.mjs";
import { D1InlineRunnerBundleResolver } from "../../services/lean-runner/d1-inline-runner-bundle-resolver.mjs";
import { D1RunnerLeaseQueue } from "../../services/lean-runner/d1-runner-lease-queue.mjs";
import { D1RunStore } from "../../services/lean-runner/d1-run-store.mjs";
import { D1InlineRunnerOutputStore } from "../../services/lean-runner/d1-inline-runner-output-store.mjs";
import { D1InlineVerificationReplayEvidenceStore } from "../../services/verification/d1-inline-verification-replay-evidence-store.mjs";
import { RunnerContainerExecutionClient } from "../../services/lean-runner/runner-container-execution-client.mjs";
import { RunnerExecutionFinalizer } from "../../services/lean-runner/runner-execution-finalizer.mjs";
import { RunnerExecutionResultSigner } from "../../services/lean-runner/runner-execution-result-signer.mjs";
import { PinnedRunnerImageRegistry } from "../../services/lean-runner/runner-image-policy.mjs";
import { RunnerWorkspaceTransfer } from "../../services/lean-runner/runner-workspace-transfer.mjs";
import { TrustedRunnerProcess } from "../../services/lean-runner/trusted-runner-process.mjs";
import { RunnerJobAuthenticator } from "../../services/lean-runner/queue.mjs";
import { ContainerLeanExecutor } from "../../services/lean-runner/container-lean-executor.mjs";
import { createContainerWorkspaceHttpHandler } from "../../services/lean-runner/container-workspace-runtime.mjs";

/** Local synthetic-identity acceptance only. Never receives production credentials. */
export async function createLocalAcceptanceRunner({
  database, bucket = new D1InlineArtifactBucket(database), keys, root,
  imageDigest, leanToolchain, mathlibRevision = "none", dockerImageId,
  dockerExecutable = "docker", approvedBundleHashes,
  allowTrustedFixtureIsolationDouble = false, executablePath = "lake",
} = {}) {
  if (!Array.isArray(approvedBundleHashes) || approvedBundleHashes.length === 0 ||
      approvedBundleHashes.some((hash) => !/^sha256:[a-f0-9]{64}$/.test(hash))) {
    throw new Error("Local acceptance requires exact approved fixture manifest hashes.");
  }
  if (!root || !isAbsolute(root)) throw new Error("Local acceptance requires an absolute temporary root.");
  if (mathlibRevision !== "none") throw new Error("Local acceptance supports the generated Lean Core fixture only.");
  if (!dockerImageId && !allowTrustedFixtureIsolationDouble) {
    throw new Error("A pinned Docker image is required; the trusted fixture isolation double needs explicit opt-in.");
  }
  if (dockerImageId && !/^sha256:[a-f0-9]{64}$/.test(dockerImageId)) throw new Error("Docker image must be an immutable local image ID.");
  if (dockerImageId && !imageDigest?.endsWith(`@${dockerImageId}`)) throw new Error("Protocol image digest must match the exact local Docker manifest ID.");
  const approved = new Set(approvedBundleHashes);
  const registry = new PinnedRunnerImageRegistry({ images: [{ imageDigest, leanToolchain, mathlibRevision }] });
  const queue = new D1RunnerLeaseQueue({ database });
  const runStore = new D1RunStore(database);
  const resolver = new D1InlineRunnerBundleResolver({ database });
  const transfer = new RunnerWorkspaceTransfer({ bucket });
  const controlPlanePublic = typeof keys?.controlPlane?.publicKey === "string"
    ? keys.controlPlane.publicKey
    : Buffer.from(await crypto.subtle.exportKey("raw", keys.controlPlane.publicKey)).toString("base64url");
  const authenticator = new RunnerJobAuthenticator({ issuerKeys: [{ id: keys.controlPlane.id, publicKey: controlPlanePublic }] });
  const finalizer = new RunnerExecutionFinalizer({
    runStore,
    outputStore: new D1InlineRunnerOutputStore({ database }),
    replayEvidenceStore: new D1InlineVerificationReplayEvidenceStore({ database }),
    resultSigner: new RunnerExecutionResultSigner({ runnerKeyId: keys.runner.id, runnerPrivateKey: keys.runner.privateKey }),
  });
  const active = new Set();
  let closed = false;
  let busy = false;
  return {
    async executeNext({ runId } = {}) {
      if (closed || busy) throw new Error("Local acceptance runner is closed or already executing.");
      busy = true;
      let finalized = null;
      let execution = null;
      let isolation = null;
      let executionError = null;
      let executedRunId = null;
      try {
        const process = new TrustedRunnerProcess({
          queue, authenticator, consumerId: `runner:local-acceptance:${randomUUID()}`, onlyRunId: runId,
          leaseDurationSeconds: 300, heartbeatSeconds: 30, maxDeliveryAttempts: 1,
          execute: async (message, { beforeFinalize }) => {
            let container;
            try {
              if (!approved.has(message.request.bundle.manifestHash)) throw new Error("Bundle is outside the exact local fixture allowlist.");
              registry.resolve(message.request);
              const resolvedBundle = await resolver.resolve(message.request);
              executedRunId = message.runId;
              if (dockerImageId) {
                container = await createDockerAcceptanceContainer({
                  dockerExecutable, dockerImageId, leanToolchain, mathlibRevision,
                  limits: message.request.limits,
                });
              } else {
                await mkdir(root, { recursive: true });
                const handler = createContainerWorkspaceHttpHandler({
                  stagingRoot: join(root, "staging"), workspaceRoot: join(root, "workspaces"),
                  executor: new ContainerLeanExecutor({ networkIsolated: true, resourceLimitsEnforced: true, executablePath }),
                });
                container = { fetch: handler, close: () => handler.cleanup(), isolation: {
                  isolationVerified: false, productionAcceptance: false, provider: "trusted-fixture-isolation-test-double",
                  network: "test-double", resources: "test-double",
                } };
              }
              active.add(container);
              isolation = container.isolation;
              const preparing = await runStore.prepare(message.runId, new Date().toISOString());
              await transfer.stage({ run: preparing, resolvedBundle, container });
              const running = await runStore.start(message.runId, new Date().toISOString());
              execution = await new RunnerContainerExecutionClient({ pollMilliseconds: 100 }).execute({ container, run: running, request: message.request });
              await beforeFinalize();
              finalized = await finalizer.finalize({ runId: message.runId, execution, receivedAt: new Date().toISOString() });
            } catch (error) {
              executionError = error;
              throw error;
            } finally {
              if (container) {
                await container.close();
                active.delete(container);
              }
            }
          },
        });
        const delivery = await process.processNext();
        if (executionError) throw Object.assign(executionError, { delivery });
        return { ...delivery, runId: executedRunId, finalized, execution, isolation,
          isolationVerified: isolation?.isolationVerified ?? false, productionAcceptance: false };
      } finally { busy = false; }
    },
    async close() {
      closed = true;
      await Promise.all([...active].map((container) => container.close()));
      active.clear();
    },
  };
}

// No host mounts, published ports, source credentials, Docker socket or signing keys
// enter the container. docker exec is only a transport to its loopback HTTP server.
export async function createDockerAcceptanceContainer({ dockerExecutable = "docker", dockerImageId, leanToolchain, mathlibRevision, limits }) {
  if (!/^sha256:[a-f0-9]{64}$/.test(dockerImageId)) throw new Error("Docker image must be pinned by immutable local ID.");
  limits = normalizeLeanRunnerLimits(limits);
  const name = `proofweave-local-acceptance-${randomUUID()}`;
  const docker = (args, options) => runCommand(dockerExecutable, args, options);
  let created = false;
  let removed = false;
  const close = async () => {
    if (created && !removed) { await docker(["rm", "--force", name]); removed = true; }
  };
  try {
    await docker([
      "run", "--detach", "--name", name, "--label", "io.proofweave.local-acceptance=true",
      "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--cpus", "1", "--memory", `${limits.memoryMiB}m`, "--memory-swap", `${limits.memoryMiB}m`,
      "--pids-limit", "128", "--ulimit", `cpu=${limits.cpuSeconds}:${limits.cpuSeconds}`,
      "--shm-size", "16m", "--tmpfs", `/tmp:rw,nosuid,nodev,size=${limits.diskMiB}m,mode=1777`,
      "--user", "10001:10001", "--env", "HOME=/tmp", "--env", "PROOFWEAVE_NETWORK_ISOLATED=true",
      "--env", "PROOFWEAVE_RESOURCE_LIMITS_ENFORCED=true", "--env", "PROOFWEAVE_LEAN_EXECUTABLE_PATH=/opt/lean/bin/lake",
      "--entrypoint", "node", dockerImageId, "/opt/proofweave/services/lean-runner/container-http-server.mjs",
    ]);
    created = true;
    const inspection = JSON.parse(await docker(["inspect", name]))[0];
    const config = inspection.HostConfig;
    if (inspection.Image !== dockerImageId || config.NetworkMode !== "none" || !config.ReadonlyRootfs ||
        config.Memory !== limits.memoryMiB * 1024 * 1024 || config.MemorySwap !== config.Memory ||
        config.NanoCpus !== 1_000_000_000 || config.PidsLimit !== 128 ||
        config.Tmpfs?.["/tmp"] !== `rw,nosuid,nodev,size=${limits.diskMiB}m,mode=1777` ||
        !config.Ulimits?.some((limit) => limit.Name === "cpu" && limit.Soft === limits.cpuSeconds && limit.Hard === limits.cpuSeconds) ||
        !config.CapDrop.includes("ALL") || !config.SecurityOpt.includes("no-new-privileges") ||
        inspection.Config.User !== "10001:10001" || inspection.Mounts.some((mount) => mount.Type === "bind")) {
      throw new Error("Docker did not enforce the requested local isolation configuration.");
    }
    const probe = JSON.parse(await docker(["exec", name, "node", "--input-type=module", "-e", runtimeProbe]));
    if (probe.metadata.leanToolchain !== leanToolchain || probe.metadata.mathlibRevision !== mathlibRevision ||
        !probe.leanVersion.includes(leanToolchain.split(":v")[1]) || probe.networkError !== "ENETUNREACH") {
      throw new Error("Docker Lean environment or actual network-denial probe failed.");
    }
    const container = {
      isolation: { isolationVerified: true, productionAcceptance: false, provider: "local-docker",
        imageId: dockerImageId, network: "actual-probe-passed", resources: "docker-inspect-verified",
        limits, cpuCount: 1, pidsLimit: 128, readonlyRootfs: true, probe },
      async fetch(input, init) {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        if (url.hostname !== "proofweave-runner.internal" || !url.pathname.startsWith("/v1/runs/")) throw new Error("Unexpected private Runner transport URL.");
        const body = Buffer.from(await request.arrayBuffer()).toString("base64");
        const payload = JSON.stringify({ path: url.pathname, method: request.method, headers: Object.fromEntries(request.headers), body });
        const response = JSON.parse(await docker(["exec", "--interactive", name, "node", "--input-type=module", "-e", httpBridge], { input: payload }));
        return new Response(response.status === 204 ? null : Buffer.from(response.body, "base64"), { status: response.status, headers: response.headers });
      },
      close,
    };
    return container;
  } catch (error) { await close(); throw error; }
}

const httpBridge = `
let input = ''; for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const response = await fetch('http://127.0.0.1:8080' + request.path, {
  method: request.method, headers: request.headers,
  body: ['GET', 'HEAD'].includes(request.method) ? undefined : Buffer.from(request.body, 'base64'),
  signal: AbortSignal.timeout(60000),
});
process.stdout.write(JSON.stringify({status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()).toString('base64')}));
`;

const runtimeProbe = `
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { connect } from 'node:net';
const metadata = JSON.parse(await readFile('/opt/proofweave/lean-environment.json', 'utf8'));
const leanVersion = execFileSync('/opt/lean/bin/lean', ['--version'], {encoding:'utf8'}).trim();
const networkError = await new Promise(resolve => {
 const socket = connect({host:'1.1.1.1',port:443});
 socket.setTimeout(2000); socket.once('connect',()=>{socket.destroy();resolve('CONNECTED')});
 socket.once('timeout',()=>{socket.destroy();resolve('TIMEOUT')}); socket.once('error',error=>resolve(error.code));
});
let ready = false;
for(let i=0;i<30;i++){try{ready=(await fetch('http://127.0.0.1:8080/ready')).status===204;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,100));}
if(!ready) throw new Error('Container HTTP runtime did not become ready');
process.stdout.write(JSON.stringify({metadata,leanVersion,networkError}));
`;

function runCommand(executable, args, { input, timeout = 75_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = []; const stderr = [];
    let bytes = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.stdout.on("data", (chunk) => { bytes += chunk.length; if (bytes > 32 * 1024 * 1024) child.kill("SIGKILL"); else stdout.push(chunk); });
    child.stderr.on("data", (chunk) => { if (Buffer.concat(stderr).length < 64 * 1024) stderr.push(chunk); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Local container command failed (${code ?? signal}): ${Buffer.concat(stderr).toString().slice(0, 4000)}`));
      else resolve(Buffer.concat(stdout).toString());
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
