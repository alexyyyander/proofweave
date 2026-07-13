import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const fixturesRoot = new URL("../tests/fixtures/lean/", import.meta.url);
const fixtureDirectories = (await readdir(fixturesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const directory of fixtureDirectories) {
  const fixtureUrl = new URL(`${directory}/`, fixturesRoot);
  const fixture = JSON.parse(await readFile(new URL("fixture.json", fixtureUrl), "utf8"));
  assert.equal(fixture.fixtureProtocolVersion, "pw-lean-fixture-v1", `${directory}: unsupported fixture protocol`);
  assert.equal(fixture.id, directory, `${directory}: fixture id must equal directory name`);
  assert.deepEqual(fixture.entryCommand.slice(0, 3), ["lake", "env", "lean"], `${directory}: entry command must be a Lake argument array`);
  assert.equal(fixture.entryCommand.length, 4, `${directory}: fixture entry command is unexpectedly broad`);

  const source = await readFile(new URL(fixture.entryCommand[3], fixtureUrl), "utf8");
  const hasSorry = /\bsorry\b/.test(source);
  const result = await run(fixture.entryCommand[0], fixture.entryCommand.slice(1), fileURLToPath(fixtureUrl));
  const expectsZero = fixture.expected.leanExitCode === 0;
  assert.equal(result.code === 0, expectsZero, `${directory}: Lean exit code ${result.code}; stderr:\n${result.stderr}`);
  const noSorryAudit = result.code === 0 ? (hasSorry ? "rejected" : "passed") : "not_run";
  const kernelStatus = result.code !== 0 ? "not_run" : (hasSorry ? "not_accepted" : "accepted");
  assert.equal(noSorryAudit, fixture.expected.noSorryAudit, `${directory}: unexpected sorry audit result`);
  assert.equal(kernelStatus, fixture.expected.kernelStatus, `${directory}: unexpected kernel status`);
  console.log(`${directory}: Lean exit ${result.code}; kernel ${kernelStatus}; sorry audit ${noSorryAudit}`);
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}
