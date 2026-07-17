import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const fixturePath = resolve(repositoryRoot, "demo/fixtures/build-week-demo.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const sourcePath = resolve(repositoryRoot, fixture.source.path);

if (!sourcePath.startsWith(`${repositoryRoot}/`)) {
  throw new Error("The demo source path must stay inside the repository.");
}

const source = await readFile(sourcePath);
const sourceHash = sha256Bytes(source);
if (sourceHash !== fixture.source.contentHash || source.toString("utf8") !== fixture.source.content) {
  throw new Error("The local Lean source no longer matches the signed demo fixture.");
}

const cwd = dirname(sourcePath);
const sourceFilename = sourcePath.slice(cwd.length + 1);
const [execution, version] = await Promise.all([
  execFileAsync("lake", ["env", "lean", sourceFilename], { cwd, maxBuffer: 1024 * 1024 }),
  execFileAsync("lake", ["env", "lean", "--version"], { cwd, maxBuffer: 1024 * 1024 }),
]);

const checks = [
  ["Lean version", version.stdout.trim(), fixture.source.leanVersion],
  ["compiler stdout", sha256Bytes(execution.stdout), fixture.runner.result.artifacts.stdoutHash],
  ["compiler stderr", sha256Bytes(execution.stderr), fixture.runner.result.artifacts.stderrHash],
  ["runner status", fixture.runner.result.status, "succeeded"],
  ["kernel status", fixture.runner.result.kernelStatus, "accepted"],
  ["no-sorry policy", fixture.runner.result.checks.noSorry, "passed"],
];

for (const [label, actual, expected] of checks) {
  if (actual !== expected) {
    throw new Error(`${label} does not match the signed demo fixture.`);
  }
}

process.stdout.write("Build Week demo Lean replay passed: source, toolchain, outputs, kernel status, and no-sorry policy match the signed fixture.\n");

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
