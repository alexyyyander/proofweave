import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const metadataPath = process.env.PROOFWEAVE_IMAGE_METADATA;
const expectedLeanToolchain = process.env.EXPECTED_LEAN_TOOLCHAIN;
const expectedMathlibRevision = process.env.EXPECTED_MATHLIB_REVISION;
const packagesRoot = process.env.PROOFWEAVE_LAKE_PACKAGES_ROOT;
const smokeTimeoutMs = 300_000;

if (!metadataPath || !expectedLeanToolchain || !expectedMathlibRevision) {
  throw new Error("Expected image metadata and exact Lean environment values are required.");
}

const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
if (
  metadata.protocolVersion !== "pw-lean-image-v1"
  || metadata.leanToolchain !== expectedLeanToolchain
  || metadata.mathlibRevision !== expectedMathlibRevision
) {
  throw new Error("Runner image metadata does not match the selected exact environment.");
}

run("node", ["--version"]);
run("lean", ["--version"]);
run("lake", ["--version"]);

if (expectedMathlibRevision === "none") {
  if (packagesRoot) throw new Error("Lean Core image unexpectedly declares a Mathlib package closure.");
} else {
  if (!packagesRoot) throw new Error("Mathlib image does not declare its package closure.");
  const mathlibRoot = join(packagesRoot, "mathlib");
  const smokePath = "/tmp/proofweave/ProofweaveImageSmoke.lean";
  await writeFile(smokePath, "import Mathlib\n#check Nat\n", "utf8");
  run("lake", ["env", "lean", smokePath], { cwd: mathlibRoot });
}

function run(command, args, options = {}) {
  const startedAt = Date.now();
  process.stdout.write(`proofweave-image-smoke: ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    env: process.env,
    stdio: "inherit",
    timeout: smokeTimeoutMs,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}.`);
  }
  process.stdout.write(`proofweave-image-smoke: completed in ${Date.now() - startedAt}ms\n`);
}
