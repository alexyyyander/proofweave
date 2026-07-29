import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const repositoryRoot = new URL("../", import.meta.url);
const stepTimeoutMs = 90_000;
const startedAt = performance.now();

process.stdout.write([
  "Proofweave owner-controlled contribution smoke",
  "Mode: isolated_test",
  "Identity boundary: generated mock Persons and Agents; not an independent human review",
  "Storage boundary: temporary local Miniflare D1/R2; no production writes",
  "",
].join("\n"));

await runStep({
  number: 1,
  total: 3,
  label: "Confirm the pinned Lean toolchain is available",
  command: "lake",
  args: ["env", "lean", "--version"],
  cwd: new URL("tests/fixtures/lean/core-success/", repositoryRoot),
});

await runStep({
  number: 2,
  total: 3,
  label: "Execute Bundle → primary Lean Run → two fresh Lean replays → reviews → signed Receipt",
  command: process.execPath,
  args: ["--test", "tests/closed-alpha-evidence-flow.test.mjs"],
  cwd: repositoryRoot,
  env: {
    PROOFWEAVE_REQUIRE_LOCAL_LEAN: "1",
    PROOFWEAVE_E2E_TRACE: "1",
  },
});

await runStep({
  number: 3,
  total: 3,
  label: "Replay the public signed demo fixture with Lean",
  command: process.execPath,
  args: ["scripts/verify-build-week-demo-local-lean.mjs"],
  cwd: repositoryRoot,
});

const elapsedSeconds = ((performance.now() - startedAt) / 1_000).toFixed(1);
process.stdout.write([
  "",
  `PASS: the isolated owner-controlled chain completed in ${elapsedSeconds}s.`,
  "This proves the local protocol and real Lean execution path, not production Turso/Render/E2B availability or independent human review.",
  "",
].join("\n"));

async function runStep({ number, total, label, command, args, cwd, env = {} }) {
  process.stdout.write(`[${number}/${total}] ${label}\n`);
  const stepStartedAt = performance.now();
  await spawnChecked(command, args, {
    cwd,
    env: { ...process.env, ...env },
    timeoutMs: stepTimeoutMs,
  });
  const elapsedSeconds = ((performance.now() - stepStartedAt) / 1_000).toFixed(1);
  process.stdout.write(`[${number}/${total}] PASS (${elapsedSeconds}s)\n\n`);
}

function spawnChecked(command, args, { cwd, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
    });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    timeout.unref();
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`${command} exceeded the ${Math.round(timeoutMs / 1_000)}s smoke timeout.`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${command} exited with ${code ?? signal ?? "unknown status"}.`));
        return;
      }
      resolve();
    });
  });
}
