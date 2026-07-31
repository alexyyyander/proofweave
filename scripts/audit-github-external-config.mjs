#!/usr/bin/env node

import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  auditGithubExternalConfiguration,
  GithubExternalConfigAuditError,
  githubExternalConfigAuditSchemaVersion,
} from "./lib/github-external-config-auditor.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write([
      "Usage: npm run github:external-config:audit -- [--output /absolute/path/evidence.json]",
      "",
      "Reads GH_TOKEN or GITHUB_TOKEN. The audit is read-only and refuses a dirty tracked worktree.",
      "Evidence contains secret names and variable-value hashes, never token or secret values.",
      "",
    ].join("\n"));
    return;
  }
  const releaseCommit = await cleanReleaseCommit();
  const githubToken = await githubCredential();
  const evidence = await auditGithubExternalConfiguration({
    githubToken,
    releaseCommit,
  });
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (options.output) {
    await writeFile(options.output, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    process.stdout.write(JSON.stringify({
      schemaVersion: githubExternalConfigAuditSchemaVersion,
      passed: evidence.passed,
      releaseCommit: evidence.releaseCommit,
      evidencePath: options.output,
    }) + "\n");
  } else {
    process.stdout.write(serialized);
  }
  if (!evidence.passed) process.exitCode = 1;
}

async function githubCredential() {
  const environmentToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (environmentToken) return environmentToken;
  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 16_384,
    });
    return stdout.trim();
  } catch {
    throw new GithubExternalConfigAuditError(
      "GITHUB_CREDENTIAL_UNAVAILABLE",
      "Authenticate GitHub CLI or provide GH_TOKEN through an approved secret provider.",
    );
  }
}

async function cleanReleaseCommit() {
  let commit;
  let status;
  try {
    ({ stdout: commit } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 16_384,
    }));
    ({ stdout: status } = await execFileAsync(
      "git",
      ["status", "--porcelain", "--untracked-files=no"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        maxBuffer: 64_000,
      },
    ));
  } catch {
    throw new GithubExternalConfigAuditError(
      "GIT_STATE_UNAVAILABLE",
      "The release Git state could not be inspected.",
    );
  }
  const normalizedCommit = commit.trim();
  if (!/^[a-f0-9]{40}$/.test(normalizedCommit)) {
    throw new GithubExternalConfigAuditError(
      "GIT_STATE_INVALID",
      "The release Git commit is invalid.",
    );
  }
  if (status.length !== 0) {
    throw new GithubExternalConfigAuditError(
      "DIRTY_RELEASE_WORKTREE",
      "External configuration evidence requires a clean tracked release worktree.",
    );
  }
  return normalizedCommit;
}

function parseArguments(args) {
  const options = { help: false, output: null };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--output") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new GithubExternalConfigAuditError(
          "INVALID_ARGUMENT",
          "--output requires a path.",
        );
      }
      options.output = path.resolve(value);
      index += 1;
      continue;
    }
    throw new GithubExternalConfigAuditError(
      "INVALID_ARGUMENT",
      "An unsupported external audit argument was provided.",
    );
  }
  return options;
}

main().catch((error) => {
  const code = error instanceof GithubExternalConfigAuditError
    ? error.code
    : "EXTERNAL_AUDIT_FAILED";
  const message = error instanceof GithubExternalConfigAuditError
    ? error.message
    : "GitHub external configuration audit failed.";
  process.stdout.write(`${JSON.stringify({
    schemaVersion: githubExternalConfigAuditSchemaVersion,
    passed: false,
    error: { code, message },
  }, null, 2)}\n`);
  process.exitCode = 2;
});
