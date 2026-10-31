import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  recordRunnerTemplateBuild,
  templateBuildReportSchemaVersion,
} from "../scripts/record-e2b-template-build.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(root, "config", "runner-environments.json");
const scriptPath = path.join(root, "scripts", "record-e2b-template-build.mjs");
const pendingDigest = "ghcr.io/alexyyyander/proofweave-lean-runner@sha256:3a7e335f2f1acae3296f7e0c5933e5b160ccdc37fe4e363c2c81aa73118f86b0";

async function repositoryConfig() {
  return JSON.parse(await readFile(configPath, "utf8"));
}

function buildReport(overrides = {}) {
  return {
    schemaVersion: templateBuildReportSchemaVersion,
    templateId: "c5e6a7b8c9d0e1f2g3h4",
    templateReference: "c5e6a7b8c9d0e1f2g3h4:mathlib-4.27-a3a10",
    buildId: "7c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
    imageReference: pendingDigest,
    ...overrides,
  };
}

test("records an E2B template report on the matching pending environment", async () => {
  const recorded = recordRunnerTemplateBuild({
    config: await repositoryConfig(),
    profile: "mathlib-4.27-a3a10",
    report: buildReport(),
  });
  const environment = recorded.config.environments.find((entry) => entry.profile === "mathlib-4.27-a3a10");
  assert.equal(environment.state, "template_ready");
  assert.deepEqual(environment.template, {
    id: "c5e6a7b8c9d0e1f2g3h4:mathlib-4.27-a3a10",
    buildId: "7c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
    sourceImageDigest: pendingDigest,
  });
  assert.equal(recorded.previousState, "built_pending_template");
});

test("rejects a template report for a different image or schema", async () => {
  const config = await repositoryConfig();
  assert.throws(
    () => recordRunnerTemplateBuild({
      config,
      profile: "mathlib-4.27-a3a10",
      report: buildReport({ imageReference: `ghcr.io/proofweave/other@sha256:${"a".repeat(64)}` }),
    }),
    /does not match/,
  );
  assert.throws(
    () => recordRunnerTemplateBuild({
      config,
      profile: "mathlib-4.27-a3a10",
      report: buildReport({ schemaVersion: "other" }),
    }),
    /schemaVersion/,
  );
  assert.throws(
    () => recordRunnerTemplateBuild({
      config,
      profile: "mathlib-4.27-a3a10",
      report: buildReport({ buildId: "" }),
    }),
    /buildId/,
  );
});

test("refuses to rewrite an already approved environment", async () => {
  const config = await repositoryConfig();
  assert.throws(
    () => recordRunnerTemplateBuild({
      config,
      profile: "mathlib-4.31-9a948",
      report: buildReport({ imageReference: config.environments[0].imageDigest }),
    }),
    /only a pending or ready template/,
  );
});

test("CLI records the report and writes a valid registry", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "pw-template-record-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fixtureConfigPath = path.join(dir, "runner-environments.json");
  const reportPath = path.join(dir, "template.json");
  await writeFile(fixtureConfigPath, `${JSON.stringify(await repositoryConfig(), null, 2)}\n`);
  await writeFile(reportPath, `${JSON.stringify(buildReport(), null, 2)}\n`);

  const result = spawnSync(process.execPath, [
    scriptPath,
    "--profile", "mathlib-4.27-a3a10",
    "--report", reportPath,
    "--config", fixtureConfigPath,
  ], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.state, "template_ready");
  const updated = JSON.parse(await readFile(fixtureConfigPath, "utf8"));
  assert.equal(updated.environments[1].state, "template_ready");
});
