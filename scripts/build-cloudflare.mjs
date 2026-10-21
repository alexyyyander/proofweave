#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  bindCloudflareBuildIdentity,
  readCloudflareSourceIdentity,
  requireCommittedCloudflareSource,
} from "./lib/cloudflare-build-identity.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const release = process.argv.slice(2);
if (release.some((value) => value !== "--release") || release.length > 1) {
  throw new Error("Usage: node scripts/build-cloudflare.mjs [--release]");
}
const before = readCloudflareSourceIdentity(repositoryRoot);
if (release.length) requireCommittedCloudflareSource(before);
const build = spawnSync(process.execPath, [
  fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url)),
  "build", "--config", "vite.cloudflare.config.ts",
], { cwd: repositoryRoot, env: process.env, stdio: "inherit" });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
const after = readCloudflareSourceIdentity(repositoryRoot);
if (release.length) {
  requireCommittedCloudflareSource(after);
  if (before.gitSha !== after.gitSha) throw new Error("Source commit changed during the Cloudflare build.");
}
const configPath = new URL("../dist/server/wrangler.json", import.meta.url);
const bound = bindCloudflareBuildIdentity(JSON.parse(await readFile(configPath, "utf8")), before, after);
await writeFile(configPath, JSON.stringify(bound.configuration, null, 2) + "\n");
await writeFile(new URL("../dist/cloudflare-source.json", import.meta.url), JSON.stringify(bound.identity, null, 2) + "\n");
process.stdout.write(`${JSON.stringify(bound.identity)}\n`);
