#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { schemaVersion, validateRunnerEnvironmentsConfig } from "./check-runner-environments.mjs";

export const generationSchemaVersion = "pw-runner-environment-generation-v1";
export const generationSurfaces = Object.freeze(["all", "worker", "render"]);
export const generationFormats = Object.freeze(["env", "json"]);

const defaultConfigPath = fileURLToPath(new URL("../config/runner-environments.json", import.meta.url));

export class RunnerEnvironmentGenerationError extends Error {
  constructor(message) {
    super(message);
    this.name = "RunnerEnvironmentGenerationError";
  }
}

/**
 * Derive the deployment environment values from the reviewed registry. This is
 * a read-only projection: it never approves an environment that the registry
 * does not already describe as template_ready or approved, and the execution
 * profile must carry an immutable E2B template identity.
 */
export function generateRunnerEnvironmentConfig({
  config,
  profiles = [],
  executionProfile = null,
  surface = "all",
  enableExecutionProfiles = [],
} = {}) {
  const environments = validateRunnerEnvironmentsConfig(config);
  if (!generationSurfaces.includes(surface)) {
    throw new RunnerEnvironmentGenerationError(`--surface must be one of ${generationSurfaces.join(", ")}.`);
  }
  const byProfile = new Map(environments.map((environment) => [environment.profile, environment]));
  const requestedProfiles = [...new Set(profiles)];
  const requestedEnableProfiles = [...new Set(enableExecutionProfiles)];
  if (requestedEnableProfiles.length > 0 && surface !== "worker") {
    throw new RunnerEnvironmentGenerationError("--enable-execution is only available with --surface worker.");
  }

  let execution = null;
  if (executionProfile !== null) {
    if (surface === "worker") {
      throw new RunnerEnvironmentGenerationError("--surface worker does not emit execution settings; omit --execution-profile.");
    }
    execution = byProfile.get(executionProfile);
    if (!execution) {
      throw new RunnerEnvironmentGenerationError(`Unknown Runner execution environment profile ${executionProfile}.`);
    }
    if (execution.template === null) {
      throw new RunnerEnvironmentGenerationError(
        `Runner environment ${executionProfile} has no E2B template; execution requires a template_ready or approved environment.`,
      );
    }
  }
  if (surface === "render" && execution === null) {
    throw new RunnerEnvironmentGenerationError("--surface render requires --execution-profile.");
  }

  const selectedProfiles = new Set();
  if (requestedProfiles.length === 0) {
    if (execution !== null) {
      // The trusted Runner serves one E2B template at a time. Unless the
      // operator names additional profiles explicitly, an execution profile
      // selects only itself so the emitted allowlist stays a single image.
      selectedProfiles.add(execution.profile);
    } else {
      for (const environment of environments) {
        if (environment.state === "approved") selectedProfiles.add(environment.profile);
      }
      if (selectedProfiles.size === 0) {
        throw new RunnerEnvironmentGenerationError(
          "No approved Runner environment is registered; pass --profile to stage a template_ready environment.",
        );
      }
    }
  } else {
    for (const profile of requestedProfiles) {
      const environment = byProfile.get(profile);
      if (!environment) {
        throw new RunnerEnvironmentGenerationError(`Unknown Runner environment profile ${profile}.`);
      }
      if (environment.state === "built_pending_template") {
        throw new RunnerEnvironmentGenerationError(
          `Runner environment ${profile} is built_pending_template and has no E2B template; build and register the template first.`,
        );
      }
      selectedProfiles.add(profile);
    }
  }
  if (execution !== null) selectedProfiles.add(execution.profile);

  const selected = environments.filter((environment) => selectedProfiles.has(environment.profile));
  const enabledProfiles = new Set();
  for (const profile of requestedEnableProfiles) {
    const environment = byProfile.get(profile);
    if (!environment) {
      throw new RunnerEnvironmentGenerationError(`Unknown Runner execution environment profile ${profile}.`);
    }
    if (!selectedProfiles.has(profile)) {
      throw new RunnerEnvironmentGenerationError(
        `Runner execution environment ${profile} is not in the generated allowlist; pass --profile ${profile}.`,
      );
    }
    if (environment.state !== "approved") {
      throw new RunnerEnvironmentGenerationError(
        `Runner environment ${profile} is ${environment.state}; only an approved environment may declare executionEnabled=true.`,
      );
    }
    enabledProfiles.add(profile);
  }
  const approvedImages = selected.map((environment) => Object.freeze({
    imageDigest: environment.imageDigest,
    leanToolchain: environment.leanToolchain,
    mathlibRevision: environment.mathlibRevision,
  }));
  const values = { RUNNER_APPROVED_IMAGES_JSON: approvedImages };
  if (surface === "worker") {
    // Dispatch declarations default to disabled so a Worker deployment cannot
    // route Runs to an environment whose execution window is not open.
    values.RUNNER_EXECUTION_ENVIRONMENTS_JSON = selected.map((environment) => Object.freeze({
      leanToolchain: environment.leanToolchain,
      mathlibRevision: environment.mathlibRevision,
      executionEnabled: enabledProfiles.has(environment.profile),
    }));
  }
  if (execution !== null) {
    values.PROOFWEAVE_E2B_RUNNER_IMAGE = execution.imageDigest;
    values.PROOFWEAVE_E2B_TEMPLATE_ID = execution.template.id;
    values.PROOFWEAVE_E2B_TEMPLATE_BUILD_ID = execution.template.buildId;
  }

  return {
    schemaVersion: generationSchemaVersion,
    registrySchemaVersion: schemaVersion,
    surface,
    profiles: selected.map((environment) => environment.profile),
    executionProfile: execution?.profile ?? null,
    executionEnabledProfiles: [...enabledProfiles],
    values,
  };
}

export function formatEnvironmentAssignments(values) {
  const lines = Object.entries(values).map(([key, value]) => {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    return `${key}=${shellQuote(serialized)}`;
  });
  return `${lines.join("\n")}\n`;
}

export function formatGenerationReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function readRegistry(configPath) {
  let text;
  try {
    text = await readFile(configPath, "utf8");
  } catch {
    throw new RunnerEnvironmentGenerationError(`Unable to read Runner environment registry at ${configPath}.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new RunnerEnvironmentGenerationError(`Runner environment registry at ${configPath} is not valid JSON.`);
  }
}

const usage = `Usage: node scripts/generate-runner-environment-config.mjs [options]

Generate deployment environment values from config/runner-environments.json.

Options:
  --profile <profile>            Include an environment in RUNNER_APPROVED_IMAGES_JSON (repeatable).
                                 Defaults to every approved environment.
  --execution-profile <profile>  Emit PROOFWEAVE_E2B_RUNNER_IMAGE and E2B template id/build values.
  --surface <worker|render|all>  Target deployment surface (default: all). render requires --execution-profile.
                                 worker also emits RUNNER_EXECUTION_ENVIRONMENTS_JSON, execution disabled.
  --enable-execution <profile>   Declare executionEnabled=true for an approved environment in the
                                 worker execution declaration (repeatable, --surface worker only).
  --format <env|json>            Output format (default: env).
  --config <path>                Registry path (default: config/runner-environments.json).
  --help                         Show this help.
`;

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
    return;
  }
  const report = generateRunnerEnvironmentConfig({
    config: await readRegistry(options.configPath),
    profiles: options.profiles,
    executionProfile: options.executionProfile,
    surface: options.surface,
    enableExecutionProfiles: options.enableExecutionProfiles,
  });
  process.stdout.write(
    options.format === "json"
      ? formatGenerationReport(report)
      : formatEnvironmentAssignments(report.values),
  );
}

function parseArguments(argv) {
  const options = {
    configPath: defaultConfigPath,
    profiles: [],
    executionProfile: null,
    surface: "all",
    enableExecutionProfiles: [],
    format: "env",
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--config") {
      options.configPath = requireValue(argv, ++index, argument);
    } else if (argument === "--profile") {
      options.profiles.push(requireValue(argv, ++index, argument));
    } else if (argument === "--enable-execution") {
      options.enableExecutionProfiles.push(requireValue(argv, ++index, argument));
    } else if (argument === "--execution-profile") {
      options.executionProfile = requireValue(argv, ++index, argument);
    } else if (argument === "--surface") {
      options.surface = requireValue(argv, ++index, argument);
    } else if (argument === "--format") {
      options.format = requireValue(argv, ++index, argument);
    } else {
      throw new RunnerEnvironmentGenerationError(`Unknown argument ${argument}.`);
    }
  }
  if (!generationSurfaces.includes(options.surface)) {
    throw new RunnerEnvironmentGenerationError(`--surface must be one of ${generationSurfaces.join(", ")}.`);
  }
  if (!generationFormats.includes(options.format)) {
    throw new RunnerEnvironmentGenerationError(`--format must be one of ${generationFormats.join(", ")}.`);
  }
  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new RunnerEnvironmentGenerationError(`${flag} requires a value.`);
  }
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
