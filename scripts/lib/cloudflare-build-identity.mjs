import { execFileSync } from "node:child_process";

/** Read only Git metadata; never load credentials or application env files. */
export function readCloudflareSourceIdentity(repositoryRoot) {
  const git = (...args) => execFileSync("git", args, {
    cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const gitSha = git("rev-parse", "HEAD");
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(gitSha)) {
    throw new Error("Cloudflare build requires a complete Git commit identity.");
  }
  return {
    gitSha,
    clean: git("status", "--porcelain=v1", "--untracked-files=all") === "",
  };
}

export function requireCommittedCloudflareSource(identity) {
  if (!identity.clean) {
    throw new Error("Cloudflare release build requires a clean committed checkout.");
  }
}

export function bindCloudflareBuildIdentity(configuration, before, after) {
  if (configuration.vars?.PROOFWEAVE_HOSTING_PLATFORM !== "cloudflare") {
    throw new Error("Cloudflare build must use the direct Worker configuration.");
  }
  const committed = before.clean && after.clean && before.gitSha === after.gitSha;
  const vars = { ...configuration.vars };
  delete vars.PROOFWEAVE_RELEASE_SOURCE_REVISION;
  if (committed) vars.PROOFWEAVE_RELEASE_SOURCE_REVISION = before.gitSha;
  return {
    configuration: { ...configuration, vars },
    identity: {
      schemaVersion: "pw-cloudflare-git-build-v1",
      state: committed ? "committed" : "uncommitted",
      sourceRevision: committed ? before.gitSha : null,
    },
  };
}
