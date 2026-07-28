import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  buildProofweavePluginMarketplace,
  publishArtifactSetAtomically,
} from "../scripts/build-proofweave-plugin-marketplace.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(root, "plugins/proofweave-research");
const checkedArchivePath = resolve(root, "public/downloads/proofweave-research-marketplace.tar");
const checkedChecksumPath = `${checkedArchivePath}.sha256`;
const checkedDistributionPath = resolve(
  root,
  "public/downloads/proofweave-research-marketplace.json",
);
const compatibilityContractPath = resolve(
  root,
  "packages/protocol/proofweave-client-compatibility.json",
);

test("the public plugin marketplace archive is deterministic, complete, and checksum-bound", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "proofweave-plugin-package-"));
  try {
    const firstDirectory = join(fixtureRoot, "first");
    const secondDirectory = join(fixtureRoot, "second");
    await buildProofweavePluginMarketplace({ outputDirectory: firstDirectory });
    await buildProofweavePluginMarketplace({ outputDirectory: secondDirectory });

    const [
      firstArchive,
      firstChecksum,
      firstDistributionBytes,
      secondArchive,
      secondChecksum,
      secondDistributionBytes,
      checkedArchive,
      checkedChecksum,
      checkedDistributionBytes,
      compatibility,
    ] = await Promise.all([
      readFile(join(firstDirectory, "proofweave-research-marketplace.tar")),
      readFile(join(firstDirectory, "proofweave-research-marketplace.tar.sha256")),
      readFile(join(firstDirectory, "proofweave-research-marketplace.json")),
      readFile(join(secondDirectory, "proofweave-research-marketplace.tar")),
      readFile(join(secondDirectory, "proofweave-research-marketplace.tar.sha256")),
      readFile(join(secondDirectory, "proofweave-research-marketplace.json")),
      readFile(checkedArchivePath),
      readFile(checkedChecksumPath, "utf8"),
      readFile(checkedDistributionPath),
      readFile(compatibilityContractPath, "utf8").then((text) => JSON.parse(text)),
    ]);
    assert.deepEqual(firstArchive, secondArchive, "repeated builds must produce identical tar bytes");
    assert.deepEqual(firstChecksum, secondChecksum, "repeated builds must produce identical checksum bytes");
    assert.deepEqual(
      firstDistributionBytes,
      secondDistributionBytes,
      "repeated builds must produce identical distribution manifest bytes",
    );
    assert.deepEqual(checkedArchive, firstArchive, "the checked-in public archive must match a fresh build");
    assert.deepEqual(
      Buffer.from(checkedChecksum),
      firstChecksum,
      "the checked-in checksum must match a fresh build",
    );
    assert.deepEqual(
      checkedDistributionBytes,
      firstDistributionBytes,
      "the checked-in distribution manifest must match a fresh build",
    );
    assert.equal(firstDistributionBytes.at(-1), 0x0a, "distribution JSON must end with a newline");
    assert.deepEqual(
      (await readdir(firstDirectory)).sort(comparePaths),
      [
        "proofweave-research-marketplace.json",
        "proofweave-research-marketplace.tar",
        "proofweave-research-marketplace.tar.sha256",
      ],
      "successful builds must leave exactly one coherent public artifact set",
    );

    const digest = createHash("sha256").update(firstArchive).digest("hex");
    assert.equal(
      checkedChecksum,
      `${digest}  proofweave-research-marketplace.tar\n`,
      "the checksum file must use shasum-compatible digest and filename syntax",
    );

    const entries = parseTar(firstArchive);
    const paths = [...entries.keys()];
    assert.deepEqual(paths, [...paths].sort(comparePaths));
    for (const path of paths) assertSafePath(path);
    assert.ok(entries.has(".agents/plugins/marketplace.json"));
    assert.ok(entries.has("plugins/proofweave-research/.codex-plugin/plugin.json"));
    assert.ok(entries.has("plugins/proofweave-research/.mcp.json"));
    assert.ok(entries.has("plugins/proofweave-research/mcp/proofweave-local.mjs"));
    assert.ok(entries.has("plugins/proofweave-research/skills/proofweave-research/SKILL.md"));
    const expectedPluginFiles = (await listRegularFiles(pluginRoot))
      .map((path) => `plugins/proofweave-research/${path}`)
      .sort(comparePaths);
    const archivedPluginFiles = paths
      .filter((path) => path.startsWith("plugins/proofweave-research/"))
      .filter((path) => entries.get(path).type === "0")
      .sort(comparePaths);
    assert.deepEqual(archivedPluginFiles, expectedPluginFiles, "the archive must carry the complete plugin");

    const marketplace = parseArchivedJson(entries, ".agents/plugins/marketplace.json");
    const manifest = parseArchivedJson(
      entries,
      "plugins/proofweave-research/.codex-plugin/plugin.json",
    );
    assert.equal(marketplace.name, "proofweave-private-beta");
    assert.deepEqual(marketplace.plugins, [{
      name: "proofweave-research",
      source: { source: "local", path: "./plugins/proofweave-research" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Research",
    }]);
    assert.equal(manifest.name, "proofweave-research");
    assert.match(manifest.version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
    assert.equal(manifest.skills, "./skills/");
    assert.equal(manifest.mcpServers, "./.mcp.json");

    const bundledCompatibility = parseArchivedJson(
      entries,
      "plugins/proofweave-research/mcp/proofweave-client-compatibility.json",
    );
    assert.deepEqual(bundledCompatibility, compatibility);

    const distribution = JSON.parse(firstDistributionBytes.toString("utf8"));
    assert.deepEqual(Object.keys(distribution), [
      "schemaVersion",
      "marketplaceName",
      "pluginName",
      "pluginVersion",
      "archive",
      "compatibility",
    ]);
    assert.deepEqual(Object.keys(distribution.archive), [
      "path",
      "filename",
      "sha256",
      "bytes",
    ]);
    assert.deepEqual(Object.keys(distribution.compatibility), [
      "protocolVersion",
      "connectorApiVersion",
      "toolSchemaVersion",
    ]);
    assert.deepEqual(distribution, {
      schemaVersion: "pw-codex-plugin-distribution-v1",
      marketplaceName: marketplace.name,
      pluginName: manifest.name,
      pluginVersion: manifest.version,
      archive: {
        path: "/downloads/proofweave-research-marketplace.tar",
        filename: "proofweave-research-marketplace.tar",
        sha256: digest,
        bytes: firstArchive.byteLength,
      },
      compatibility: {
        protocolVersion: compatibility.protocolVersion,
        connectorApiVersion: compatibility.connectorApiVersion,
        toolSchemaVersion: compatibility.toolSchemaVersion,
      },
    });
    assertSafePublicArchivePath(distribution.archive);

    const publishedText = Buffer.concat([
      firstArchive,
      firstChecksum,
      firstDistributionBytes,
    ]).toString("utf8");
    assert.doesNotMatch(publishedText, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
    assert.doesNotMatch(publishedText, /\bghp_[A-Za-z0-9]{20,}\b/);
    assert.doesNotMatch(publishedText, /\bgithub_pat_[A-Za-z0-9_]{20,}\b/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("the extracted marketplace is recognized by Codex without global state or network access", async (t) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "proofweave-plugin-cli-"));
  try {
    const cli = await resolveCodexCli(t);
    if (!cli) return;

    const packageDirectory = join(fixtureRoot, "package");
    const marketplaceRoot = join(fixtureRoot, "marketplace");
    const codexHome = join(fixtureRoot, "codex-home");
    const isolatedHome = join(fixtureRoot, "home");
    await Promise.all([
      mkdir(packageDirectory, { recursive: true }),
      mkdir(marketplaceRoot, { recursive: true }),
      mkdir(codexHome, { recursive: true }),
      mkdir(isolatedHome, { recursive: true }),
    ]);
    await buildProofweavePluginMarketplace({ outputDirectory: packageDirectory });
    await extractTar(
      await readFile(join(packageDirectory, "proofweave-research-marketplace.tar")),
      marketplaceRoot,
    );

    const env = {
      ...process.env,
      CODEX_HOME: codexHome,
      HOME: isolatedHome,
      NO_PROXY: "*",
      HTTP_PROXY: "http://127.0.0.1:9",
      HTTPS_PROXY: "http://127.0.0.1:9",
      ALL_PROXY: "http://127.0.0.1:9",
    };
    const added = await runCodex(cli, [
      "plugin",
      "marketplace",
      "add",
      marketplaceRoot,
      "--json",
    ], env);
    assert.equal(JSON.parse(added.stdout).marketplaceName, "proofweave-private-beta");

    const installed = await runCodex(cli, [
      "plugin",
      "add",
      "proofweave-research@proofweave-private-beta",
      "--json",
    ], env);
    const installation = JSON.parse(installed.stdout);
    assert.equal(installation.pluginName ?? installation.name, "proofweave-research");
    await access(resolve(codexHome, "config.toml"));

    const listed = await runCodex(cli, ["plugin", "list"], env);
    assert.match(listed.stdout, /proofweave-research@proofweave-private-beta/);
    assert.doesNotMatch(listed.stdout, /not installed/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("a failed artifact-set replacement restores the prior coherent release", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "proofweave-plugin-rollback-"));
  const filenames = [
    "proofweave-research-marketplace.tar",
    "proofweave-research-marketplace.tar.sha256",
    "proofweave-research-marketplace.json",
  ];
  try {
    await Promise.all(filenames.map((filename) => (
      writeFile(resolve(fixtureRoot, filename), `old:${filename}\n`)
    )));
    let renameCalls = 0;
    await assert.rejects(
      publishArtifactSetAtomically(
        fixtureRoot,
        filenames.map((filename) => ({
          filename,
          bytes: Buffer.from(`new:${filename}\n`),
        })),
        {
          async renameFile(source, destination) {
            renameCalls += 1;
            if (renameCalls === 2) throw new Error("simulated second-file publish failure");
            await rename(source, destination);
          },
        },
      ),
      /Could not publish a complete plugin artifact set/,
    );

    assert.equal(renameCalls, 2);
    for (const filename of filenames) {
      assert.equal(await readFile(resolve(fixtureRoot, filename), "utf8"), `old:${filename}\n`);
    }
    assert.deepEqual((await readdir(fixtureRoot)).sort(comparePaths), filenames.sort(comparePaths));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

async function resolveCodexCli(t) {
  try {
    const result = await execFileAsync("codex", ["plugin", "--help"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    if (!/Manage Codex plugins/.test(result.stdout)) {
      t.skip("Codex CLI is installed but this build does not expose plugin commands");
      return null;
    }
    return "codex";
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Codex CLI is not installed in this test environment");
      return null;
    }
    throw new Error(`Codex CLI preflight failed: ${commandFailure(error)}`, { cause: error });
  }
}

async function runCodex(cli, args, env) {
  try {
    return await execFileAsync(cli, args, {
      encoding: "utf8",
      env,
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`Codex CLI command failed (${args.join(" ")}): ${commandFailure(error)}`, {
      cause: error,
    });
  }
}

function commandFailure(error) {
  return [
    `exit=${error.code ?? "unknown"}`,
    error.stdout ? `stdout=${error.stdout.trim()}` : "",
    error.stderr ? `stderr=${error.stderr.trim()}` : "",
  ].filter(Boolean).join("; ");
}

function parseTar(bytes) {
  const entries = new Map();
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const sizeText = readTarString(header, 124, 12).trim();
    const size = Number.parseInt(sizeText || "0", 8);
    const type = readTarString(header, 156, 1) || "0";
    assert.ok(Number.isSafeInteger(size) && size >= 0, `invalid tar size for ${path}`);

    const storedChecksum = Number.parseInt(readTarString(header, 148, 8).trim(), 8);
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    const computedChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
    assert.equal(storedChecksum, computedChecksum, `invalid tar checksum for ${path}`);

    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    assert.ok(contentEnd <= bytes.length, `truncated tar entry: ${path}`);
    entries.set(path, {
      type,
      bytes: Buffer.from(bytes.subarray(contentStart, contentEnd)),
    });
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

async function extractTar(bytes, destination) {
  for (const [path, entry] of parseTar(bytes)) {
    assertSafePath(path);
    const destinationPath = resolve(destination, path);
    assert.ok(
      destinationPath === destination || destinationPath.startsWith(`${destination}/`),
      `entry escapes extraction root: ${path}`,
    );
    if (entry.type === "5") {
      await mkdir(destinationPath, { recursive: true });
      continue;
    }
    assert.equal(entry.type, "0", `unsupported tar entry type for ${path}`);
    await mkdir(dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, entry.bytes, { mode: 0o644 });
  }
}

function assertSafePath(path) {
  assert.equal(path.startsWith("/"), false, `absolute archive path: ${path}`);
  assert.equal(path.includes("\\"), false, `backslash archive path: ${path}`);
  assert.equal(path.split("/").includes(".."), false, `parent traversal archive path: ${path}`);
}

function assertSafePublicArchivePath(archive) {
  assert.match(archive.filename, /^[a-z0-9.-]+\.tar$/);
  assert.equal(archive.filename.includes("/"), false);
  assert.equal(archive.filename.includes("\\"), false);
  assert.equal(archive.path, `/downloads/${archive.filename}`);
  assert.equal(archive.path.includes("\\"), false);
  assert.equal(archive.path.split("/").includes(".."), false);
}

function parseArchivedJson(entries, path) {
  const entry = entries.get(path);
  assert.ok(entry, `missing archive entry: ${path}`);
  return JSON.parse(entry.bytes.toString("utf8"));
}

function readTarString(buffer, offset, length) {
  const end = buffer.indexOf(0, offset);
  const boundary = offset + length;
  return buffer.subarray(offset, end === -1 || end > boundary ? boundary : end).toString("utf8");
}

async function listRegularFiles(directory, prefix = "") {
  const files = [];
  const children = await readdir(directory, { withFileTypes: true });
  children.sort((left, right) => comparePaths(left.name, right.name));
  for (const child of children) {
    const path = prefix ? `${prefix}/${child.name}` : child.name;
    if (child.isDirectory()) {
      files.push(...await listRegularFiles(resolve(directory, child.name), path));
      continue;
    }
    assert.equal(child.isFile(), true, `unexpected plugin entry: ${path}`);
    files.push(path);
  }
  return files;
}

function comparePaths(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
