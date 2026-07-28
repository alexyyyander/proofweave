#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const releaseManifestSchemaVersion = "pw-release-manifest-v1";

const revisionPattern = /^[a-f0-9]{40,64}$/;
const publicLabelPattern = /^[A-Za-z0-9][A-Za-z0-9:._+/-]{0,191}$/;
const imageDigestPattern = /^[A-Za-z0-9][A-Za-z0-9./:_-]*@sha256:[a-f0-9]{64}$/;
const migrationPattern = /^\d{4}_[A-Za-z0-9._-]+\.sql$/;
const databaseFingerprintPattern = /^[a-f0-9]{16}$/;
const databaseAuthorities = new Set(["turso", "sites_d1"]);

const releaseEnvironmentKeys = Object.freeze({
  sitesVersion: "PROOFWEAVE_RELEASE_SITES_VERSION",
  sitesCommitSha: "PROOFWEAVE_RELEASE_SITES_COMMIT_SHA",
  gatewayRevision: "PROOFWEAVE_RELEASE_GATEWAY_REVISION",
  runnerRevision: "PROOFWEAVE_RELEASE_RUNNER_REVISION",
  templateId: "PROOFWEAVE_RELEASE_E2B_TEMPLATE_ID",
  templateBuildId: "PROOFWEAVE_RELEASE_E2B_TEMPLATE_BUILD_ID",
  imageDigest: "PROOFWEAVE_RELEASE_RUNNER_IMAGE_DIGEST",
  migrationHead: "PROOFWEAVE_RELEASE_MIGRATION_HEAD",
  databaseAuthority: "PROOFWEAVE_RELEASE_DATABASE_AUTHORITY",
  gatewayFingerprint: "PROOFWEAVE_RELEASE_GATEWAY_FINGERPRINT",
  runnerFingerprint: "PROOFWEAVE_RELEASE_RUNNER_FINGERPRINT",
});

/**
 * Collect a privacy-minimal, offline release projection. Only explicitly
 * allowlisted, non-secret environment variables are read.
 */
export function collectReleaseManifest({
  root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  environment = process.env,
  source = collectGitState(root),
} = {}) {
  const hosting = readJson(resolve(root, ".openai", "hosting.json"));
  const runnerEnvironment = parseRenderEnvironment(
    readText(resolve(root, "deploy", "huggingface-runner", "render.yaml")),
  );
  const configuredImageDigest = safeImageDigest(runnerEnvironment.PROOFWEAVE_E2B_RUNNER_IMAGE);
  const approvedImage = selectApprovedImage(
    runnerEnvironment.RUNNER_APPROVED_IMAGES_JSON,
    configuredImageDigest,
  );

  return {
    schemaVersion: releaseManifestSchemaVersion,
    source: normalizeSourceState(source),
    sites: {
      projectId: safePublicLabel(hosting?.project_id),
      version: safePublicLabel(
        environment[releaseEnvironmentKeys.sitesVersion]
          ?? hosting?.version_id
          ?? hosting?.version,
      ),
      commitSha: safeRevision(
        environment[releaseEnvironmentKeys.sitesCommitSha]
          ?? hosting?.commit_sha
          ?? hosting?.commit,
      ),
    },
    gateway: {
      revision: safeRevision(environment[releaseEnvironmentKeys.gatewayRevision]),
    },
    runner: {
      revision: safeRevision(environment[releaseEnvironmentKeys.runnerRevision]),
      e2b: {
        configuredTemplateId: safePublicLabel(runnerEnvironment.PROOFWEAVE_E2B_TEMPLATE_ID),
        configuredTemplateBuildId: safePublicLabel(runnerEnvironment.PROOFWEAVE_E2B_TEMPLATE_BUILD_ID),
        deployedTemplateId: safePublicLabel(environment[releaseEnvironmentKeys.templateId]),
        deployedTemplateBuildId: safePublicLabel(environment[releaseEnvironmentKeys.templateBuildId]),
      },
      image: {
        configuredDigest: configuredImageDigest,
        approvedDigest: safeImageDigest(approvedImage?.imageDigest),
        deployedDigest: safeImageDigest(environment[releaseEnvironmentKeys.imageDigest]),
        leanToolchain: safePublicLabel(approvedImage?.leanToolchain),
        mathlibRevision: safeRevision(approvedImage?.mathlibRevision),
      },
    },
    database: {
      authority: safeDatabaseAuthority(environment[releaseEnvironmentKeys.databaseAuthority]),
      gatewayFingerprint: safeDatabaseFingerprint(environment[releaseEnvironmentKeys.gatewayFingerprint]),
      runnerFingerprint: safeDatabaseFingerprint(environment[releaseEnvironmentKeys.runnerFingerprint]),
      repositoryMigrationHead: repositoryMigrationHead(resolve(root, "drizzle")),
      deployedMigrationHead: safeMigrationHead(environment[releaseEnvironmentKeys.migrationHead]),
    },
  };
}

export function createReleaseManifest(options = {}) {
  const mode = options.mode === "release" ? "release" : "inspection";
  const collected = collectReleaseManifest(options);
  const validation = validateReleaseManifest(collected, { mode });
  return {
    manifest: {
      ...collected,
      validation,
    },
    exitCode: mode === "release" && validation.issues.length > 0 ? 1 : 0,
  };
}

export function validateReleaseManifest(manifest, { mode = "inspection" } = {}) {
  const normalizedMode = mode === "release" ? "release" : "inspection";
  const issues = [];
  const add = (code, path) => issues.push({ code, path });
  const required = (value, code, path) => {
    if (value === null || value === undefined || value === "") add(code, path);
  };

  required(manifest.source.gitSha, "SOURCE_GIT_SHA_MISSING", "source.gitSha");
  required(manifest.source.originMainSha, "ORIGIN_MAIN_SHA_MISSING", "source.originMainSha");
  required(manifest.source.branch, "SOURCE_BRANCH_MISSING", "source.branch");
  if (manifest.source.clean === null) {
    add("SOURCE_CLEAN_STATE_MISSING", "source.clean");
  } else if (!manifest.source.clean) {
    add("SOURCE_DIRTY", "source.clean");
  }
  if (manifest.source.gitSha && manifest.source.originMainSha
    && manifest.source.gitSha !== manifest.source.originMainSha) {
    add("SOURCE_NOT_ORIGIN_MAIN", "source.gitSha");
  }

  required(manifest.sites.projectId, "SITES_PROJECT_MISSING", "sites.projectId");
  required(manifest.sites.version, "SITES_VERSION_MISSING", "sites.version");
  required(manifest.sites.commitSha, "SITES_COMMIT_MISSING", "sites.commitSha");
  required(manifest.gateway.revision, "GATEWAY_REVISION_MISSING", "gateway.revision");
  required(manifest.runner.revision, "RUNNER_REVISION_MISSING", "runner.revision");
  for (const [revision, code, path] of [
    [manifest.sites.commitSha, "SITES_REVISION_MISMATCH", "sites.commitSha"],
    [manifest.gateway.revision, "GATEWAY_REVISION_MISMATCH", "gateway.revision"],
    [manifest.runner.revision, "RUNNER_REVISION_MISMATCH", "runner.revision"],
  ]) {
    if (manifest.source.gitSha && revision && revision !== manifest.source.gitSha) {
      add(code, path);
    }
  }

  required(
    manifest.runner.e2b.configuredTemplateId,
    "E2B_CONFIGURED_TEMPLATE_MISSING",
    "runner.e2b.configuredTemplateId",
  );
  required(
    manifest.runner.e2b.configuredTemplateBuildId,
    "E2B_CONFIGURED_TEMPLATE_BUILD_MISSING",
    "runner.e2b.configuredTemplateBuildId",
  );
  required(
    manifest.runner.e2b.deployedTemplateId,
    "E2B_DEPLOYED_TEMPLATE_MISSING",
    "runner.e2b.deployedTemplateId",
  );
  required(
    manifest.runner.e2b.deployedTemplateBuildId,
    "E2B_DEPLOYED_TEMPLATE_BUILD_MISSING",
    "runner.e2b.deployedTemplateBuildId",
  );
  if (manifest.runner.e2b.configuredTemplateId && manifest.runner.e2b.deployedTemplateId
    && manifest.runner.e2b.configuredTemplateId !== manifest.runner.e2b.deployedTemplateId) {
    add("E2B_TEMPLATE_MISMATCH", "runner.e2b.deployedTemplateId");
  }
  if (manifest.runner.e2b.configuredTemplateBuildId && manifest.runner.e2b.deployedTemplateBuildId
    && manifest.runner.e2b.configuredTemplateBuildId !== manifest.runner.e2b.deployedTemplateBuildId) {
    add("E2B_TEMPLATE_BUILD_MISMATCH", "runner.e2b.deployedTemplateBuildId");
  }

  required(
    manifest.runner.image.configuredDigest,
    "RUNNER_CONFIGURED_IMAGE_MISSING",
    "runner.image.configuredDigest",
  );
  required(
    manifest.runner.image.approvedDigest,
    "RUNNER_APPROVED_IMAGE_MISSING",
    "runner.image.approvedDigest",
  );
  required(
    manifest.runner.image.deployedDigest,
    "RUNNER_DEPLOYED_IMAGE_MISSING",
    "runner.image.deployedDigest",
  );
  required(manifest.runner.image.leanToolchain, "LEAN_TOOLCHAIN_MISSING", "runner.image.leanToolchain");
  required(manifest.runner.image.mathlibRevision, "MATHLIB_REVISION_MISSING", "runner.image.mathlibRevision");
  if (manifest.runner.image.configuredDigest && manifest.runner.image.approvedDigest
    && manifest.runner.image.configuredDigest !== manifest.runner.image.approvedDigest) {
    add("RUNNER_IMAGE_POLICY_MISMATCH", "runner.image.approvedDigest");
  }
  if (manifest.runner.image.configuredDigest && manifest.runner.image.deployedDigest
    && manifest.runner.image.configuredDigest !== manifest.runner.image.deployedDigest) {
    add("RUNNER_IMAGE_DEPLOYMENT_MISMATCH", "runner.image.deployedDigest");
  }

  required(
    manifest.database.authority,
    "DATABASE_AUTHORITY_MISSING",
    "database.authority",
  );
  if (normalizedMode === "release"
    && manifest.database.authority
    && manifest.database.authority !== "turso") {
    add("DATABASE_AUTHORITY_NOT_TURSO", "database.authority");
  }
  required(
    manifest.database.gatewayFingerprint,
    "GATEWAY_DATABASE_FINGERPRINT_MISSING",
    "database.gatewayFingerprint",
  );
  required(
    manifest.database.runnerFingerprint,
    "RUNNER_DATABASE_FINGERPRINT_MISSING",
    "database.runnerFingerprint",
  );
  if (manifest.database.gatewayFingerprint && manifest.database.runnerFingerprint
    && manifest.database.gatewayFingerprint !== manifest.database.runnerFingerprint) {
    add("DATABASE_FINGERPRINT_MISMATCH", "database.runnerFingerprint");
  }
  required(
    manifest.database.repositoryMigrationHead,
    "REPOSITORY_MIGRATION_HEAD_MISSING",
    "database.repositoryMigrationHead",
  );
  required(
    manifest.database.deployedMigrationHead,
    "DEPLOYED_MIGRATION_HEAD_MISSING",
    "database.deployedMigrationHead",
  );
  if (manifest.database.repositoryMigrationHead && manifest.database.deployedMigrationHead
    && manifest.database.repositoryMigrationHead !== manifest.database.deployedMigrationHead) {
    add("MIGRATION_HEAD_MISMATCH", "database.deployedMigrationHead");
  }

  return {
    mode: normalizedMode,
    state: issues.length === 0
      ? "valid"
      : normalizedMode === "release"
        ? "invalid"
        : "incomplete",
    issues,
  };
}

export function stableManifestJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function collectGitState(root) {
  const gitSha = gitOutput(root, ["rev-parse", "HEAD"]);
  const originMainSha = gitOutput(root, ["rev-parse", "--verify", "origin/main"]);
  const branch = gitOutput(root, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const status = gitOutput(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  return {
    gitSha,
    originMainSha,
    branch,
    clean: status === null ? null : status.length === 0,
  };
}

function normalizeSourceState(value) {
  return {
    gitSha: safeRevision(value?.gitSha),
    originMainSha: safeRevision(value?.originMainSha),
    branch: safePublicLabel(value?.branch),
    clean: typeof value?.clean === "boolean" ? value.clean : null,
  };
}

function gitOutput(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function readJson(path) {
  const text = readText(path);
  if (text === null) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function parseRenderEnvironment(text) {
  if (typeof text !== "string") return {};
  const values = {};
  let currentKey = null;
  for (const line of text.split(/\r?\n/)) {
    const key = line.match(/^\s*-\s+key:\s*([A-Z][A-Z0-9_]*)\s*$/);
    if (key) {
      currentKey = key[1];
      continue;
    }
    if (!currentKey) continue;
    const value = line.match(/^\s+value:\s*(.*?)\s*$/);
    if (value) {
      values[currentKey] = parseYamlScalar(value[1]);
      currentKey = null;
      continue;
    }
    if (/^\s+sync:\s*/.test(line) || /^\s*-\s+key:/.test(line)) currentKey = null;
  }
  return values;
}

function parseYamlScalar(value) {
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith("\"") && value.endsWith("\"")) {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : null;
    } catch {
      return null;
    }
  }
  return value;
}

function selectApprovedImage(value, configuredDigest) {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const images = parsed.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
    return images.find((entry) => entry.imageDigest === configuredDigest) ?? images[0] ?? null;
  } catch {
    return null;
  }
}

function repositoryMigrationHead(directory) {
  try {
    return readdirSync(directory)
      .filter((filename) => migrationPattern.test(filename))
      .sort()
      .at(-1) ?? null;
  } catch {
    return null;
  }
}

function safeRevision(value) {
  return typeof value === "string" && revisionPattern.test(value) ? value : null;
}

function safePublicLabel(value) {
  return typeof value === "string" && publicLabelPattern.test(value) ? value : null;
}

function safeImageDigest(value) {
  return typeof value === "string" && imageDigestPattern.test(value) ? value : null;
}

function safeMigrationHead(value) {
  return typeof value === "string" && migrationPattern.test(value) ? value : null;
}

function safeDatabaseAuthority(value) {
  return typeof value === "string" && databaseAuthorities.has(value) ? value : null;
}

function safeDatabaseFingerprint(value) {
  return typeof value === "string" && databaseFingerprintPattern.test(value) ? value : null;
}

function parseArguments(args) {
  let mode = "inspection";
  let root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--strict" || argument === "--mode=release") {
      mode = "release";
    } else if (argument === "--inspection" || argument === "--mode=inspection") {
      mode = "inspection";
    } else if (argument === "--root") {
      const supplied = args[index + 1];
      if (!supplied) throw new Error("invalid arguments");
      root = resolve(supplied);
      index += 1;
    } else {
      throw new Error("invalid arguments");
    }
  }
  return { mode, root };
}

function runCli() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = createReleaseManifest(options);
    process.stdout.write(stableManifestJson(result.manifest));
    process.exitCode = result.exitCode;
  } catch {
    process.stderr.write("Proofweave release manifest could not be collected.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
