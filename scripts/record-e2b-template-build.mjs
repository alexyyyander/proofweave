#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  RunnerEnvironmentConfigError,
  validateRunnerEnvironmentsConfig,
} from "./check-runner-environments.mjs";

export const templateBuildReportSchemaVersion = "pw-e2b-template-build-v1";
const defaultConfigPath = fileURLToPath(new URL("../config/runner-environments.json", import.meta.url));

export class RunnerTemplateRecordError extends Error {
  constructor(message) {
    super(message);
    this.name = "RunnerTemplateRecordError";
  }
}

/**
 * Fold an operator-produced E2B template build report into the registry.
 * The report image must already be the exact digest registered for the
 * profile; this command never invents a template or changes an image.
 */
export function recordRunnerTemplateBuild({ config, profile, report }) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new RunnerTemplateRecordError("E2B template build report must be an object.");
  }
  if (report.schemaVersion !== templateBuildReportSchemaVersion) {
    throw new RunnerTemplateRecordError(`E2B template build report schemaVersion must be ${templateBuildReportSchemaVersion}.`);
  }
  const templateId = typeof report.templateReference === "string" && report.templateReference.trim() !== ""
    ? report.templateReference
    : report.templateId;
  if (typeof templateId !== "string" || templateId.trim() === "") {
    throw new RunnerTemplateRecordError("E2B template build report must include templateId or templateReference.");
  }
  if (typeof report.buildId !== "string" || report.buildId.trim() === "") {
    throw new RunnerTemplateRecordError("E2B template build report must include buildId.");
  }
  if (typeof report.imageReference !== "string" || report.imageReference.trim() === "") {
    throw new RunnerTemplateRecordError("E2B template build report must include imageReference.");
  }
  if (!Array.isArray(config?.environments)) {
    throw new RunnerTemplateRecordError("Runner environment configuration has no environments.");
  }
  const index = config.environments.findIndex((environment) => environment?.profile === profile);
  if (index === -1) {
    throw new RunnerTemplateRecordError(`Unknown Runner environment profile ${profile}.`);
  }
  const environment = config.environments[index];
  if (environment.imageDigest !== report.imageReference) {
    throw new RunnerTemplateRecordError(
      `Template build image ${report.imageReference} does not match ${profile}'s registered imageDigest.`,
    );
  }
  if (environment.state !== "built_pending_template" && environment.state !== "template_ready") {
    throw new RunnerTemplateRecordError(`Runner environment ${profile} is ${environment.state}; only a pending or ready template can be recorded.`);
  }
  const template = {
    id: templateId,
    buildId: report.buildId,
    sourceImageDigest: report.imageReference,
  };
  const environments = config.environments.map((entry, entryIndex) => entryIndex === index
    ? { ...entry, state: "template_ready", template }
    : entry);
  const candidate = { ...config, environments };
  try {
    validateRunnerEnvironmentsConfig(candidate);
  } catch (error) {
    throw new RunnerTemplateRecordError(
      error instanceof RunnerEnvironmentConfigError ? error.message : "Updated Runner environment configuration is invalid.",
    );
  }
  return Object.freeze({
    config: Object.freeze(candidate),
    profile,
    template: Object.freeze(template),
    previousState: environment.state,
  });
}

async function main() {
  const reportPath = readFlag("--report");
  if (!reportPath) throw new RunnerTemplateRecordError("--report requires the E2B template build JSON path.");
  const configPath = readFlag("--config") ?? defaultConfigPath;
  let config;
  let report;
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
    report = JSON.parse(await readFile(reportPath, "utf8"));
  } catch (error) {
    throw new RunnerTemplateRecordError("Unable to read the Runner registry or E2B template build report.");
  }
  const profile = readFlag("--profile") ?? singlePendingProfile(config);
  const recorded = recordRunnerTemplateBuild({ config, profile, report });
  await writeFile(configPath, `${JSON.stringify(recorded.config, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    profile: recorded.profile,
    previousState: recorded.previousState,
    state: "template_ready",
    template: recorded.template,
  }, null, 2)}\n`);
}

function singlePendingProfile(config) {
  const pending = Array.isArray(config?.environments)
    ? config.environments.filter((environment) => environment?.state === "built_pending_template")
    : [];
  if (pending.length !== 1) {
    throw new RunnerTemplateRecordError("--profile is required unless exactly one environment is built_pending_template.");
  }
  return pending[0].profile;
}

function readFlag(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new RunnerTemplateRecordError(`${name} requires a value.`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
