import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  bindCloudflareBuildIdentity,
  readCloudflareSourceIdentity,
  requireCommittedCloudflareSource,
} from "../scripts/lib/cloudflare-build-identity.mjs";

const configuration = { vars: {
  PROOFWEAVE_HOSTING_PLATFORM: "cloudflare",
  PROOFWEAVE_RELEASE_SOURCE_REVISION: "old-snapshot-identity",
  PROOFWEAVE_PARTICIPANT_CONTROL_PLANE_MODE: "read_only",
} };

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "pw-cloudflare-build-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: directory, stdio: "pipe", encoding: "utf8" }).trim();
  git("init", "--quiet");
  await writeFile(join(directory, "source.txt"), "reviewed source\n");
  await writeFile(join(directory, ".gitignore"), ".env.local\ndist/\n");
  git("add", "source.txt", ".gitignore");
  git("-c", "user.name=Build test", "-c", "user.email=build@example.test", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "reviewed source");
  return { directory, git };
}

test("a clean checkout binds the actual Git commit instead of the historical snapshot", async (t) => {
  const { directory, git } = await fixture(t);
  const identity = readCloudflareSourceIdentity(directory);
  requireCommittedCloudflareSource(identity);
  const bound = bindCloudflareBuildIdentity(configuration, identity, identity);
  assert.equal(bound.identity.sourceRevision, git("rev-parse", "HEAD"));
  assert.equal(bound.configuration.vars.PROOFWEAVE_RELEASE_SOURCE_REVISION, bound.identity.sourceRevision);
  assert.equal(bound.configuration.vars.PROOFWEAVE_PARTICIPANT_CONTROL_PLANE_MODE, "read_only");
  assert.equal(configuration.vars.PROOFWEAVE_RELEASE_SOURCE_REVISION, "old-snapshot-identity");
});

test("tracked edits and new untracked source cannot claim committed release identity", async (t) => {
  const { directory } = await fixture(t);
  const clean = readCloudflareSourceIdentity(directory);
  await writeFile(join(directory, "new-module.mjs"), "export const newCode = true;\n");
  const untracked = readCloudflareSourceIdentity(directory);
  assert.throws(() => requireCommittedCloudflareSource(untracked), /clean committed checkout/);
  assert.equal(bindCloudflareBuildIdentity(configuration, clean, untracked).identity.sourceRevision, null);
  await rm(join(directory, "new-module.mjs"));
  await writeFile(join(directory, "source.txt"), "unreviewed edit\n");
  const dirty = readCloudflareSourceIdentity(directory);
  assert.throws(() => requireCommittedCloudflareSource(dirty), /clean committed checkout/);
  const bound = bindCloudflareBuildIdentity(configuration, dirty, dirty);
  assert.equal(bound.identity.state, "uncommitted");
  assert.ok(!Object.hasOwn(bound.configuration.vars, "PROOFWEAVE_RELEASE_SOURCE_REVISION"));
});

test("a commit switch during the build cannot receive a verified source label", async (t) => {
  const { directory, git } = await fixture(t);
  const before = readCloudflareSourceIdentity(directory);
  git("-c", "user.name=Build test", "-c", "user.email=build@example.test", "-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "-m", "changed head");
  const after = readCloudflareSourceIdentity(directory);
  assert.equal(after.clean, true);
  assert.notEqual(before.gitSha, after.gitSha);
  assert.equal(bindCloudflareBuildIdentity(configuration, before, after).identity.sourceRevision, null);
});

test("ignored local secrets are not read or emitted as source evidence", async (t) => {
  const { directory } = await fixture(t);
  await writeFile(join(directory, ".env.local"), "PRIVATE_TEST_VALUE=never-copy-this-test-value\n");
  const identity = readCloudflareSourceIdentity(directory);
  assert.equal(identity.clean, true);
  assert.doesNotMatch(JSON.stringify(bindCloudflareBuildIdentity(configuration, identity, identity)), /never-copy/);
});

test("a Sites build configuration cannot be stamped as a direct Cloudflare release", () => {
  const identity = { clean: true, gitSha: "a".repeat(40) };
  assert.throws(() => bindCloudflareBuildIdentity({ vars: {} }, identity, identity), /direct Worker configuration/);
});
