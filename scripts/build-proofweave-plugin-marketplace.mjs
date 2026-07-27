import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const marketplaceManifestPath = resolve(repositoryRoot, ".agents/plugins/marketplace.json");
const pluginRoot = resolve(repositoryRoot, "plugins/proofweave-research");
const archiveFilename = "proofweave-research-marketplace.tar";
const checksumFilename = `${archiveFilename}.sha256`;
const expectedMarketplaceName = "proofweave-private-beta";
const expectedPluginName = "proofweave-research";

export async function buildProofweavePluginMarketplace({
  outputDirectory = resolve(repositoryRoot, "public/downloads"),
} = {}) {
  const entries = await collectArchiveEntries();
  const archiveBytes = createTar(entries);
  const digest = createHash("sha256").update(archiveBytes).digest("hex");
  const resolvedOutputDirectory = resolve(outputDirectory);
  const archivePath = resolve(resolvedOutputDirectory, archiveFilename);
  const checksumPath = resolve(resolvedOutputDirectory, checksumFilename);

  await mkdir(resolvedOutputDirectory, { recursive: true });
  await writeFile(archivePath, archiveBytes);
  await writeFile(checksumPath, `${digest}  ${archiveFilename}\n`, "utf8");

  return {
    archivePath,
    checksumPath,
    digest,
    entries: entries.map(({ path, type }) => ({ path, type })),
  };
}

async function collectArchiveEntries() {
  const marketplaceBytes = await readFile(marketplaceManifestPath);
  const marketplace = parseJson(marketplaceBytes, ".agents/plugins/marketplace.json");
  validateMarketplace(marketplace);

  const pluginManifestPath = resolve(pluginRoot, ".codex-plugin/plugin.json");
  const pluginManifestBytes = await readFile(pluginManifestPath);
  const pluginManifest = parseJson(
    pluginManifestBytes,
    "plugins/proofweave-research/.codex-plugin/plugin.json",
  );
  await validatePluginManifest(pluginManifest);

  const entries = [
    directoryEntry(".agents/"),
    directoryEntry(".agents/plugins/"),
    fileEntry(".agents/plugins/marketplace.json", marketplaceBytes),
    directoryEntry("plugins/"),
  ];
  await appendTree(entries, pluginRoot, "plugins/proofweave-research");
  entries.sort((left, right) => comparePaths(left.path, right.path));
  return entries;
}

async function appendTree(entries, sourceDirectory, archiveDirectory) {
  assertSafeArchivePath(`${archiveDirectory}/`);
  entries.push(directoryEntry(`${archiveDirectory}/`));

  const children = await readdir(sourceDirectory, { withFileTypes: true });
  children.sort((left, right) => comparePaths(left.name, right.name));

  for (const child of children) {
    const sourcePath = resolve(sourceDirectory, child.name);
    assertInside(pluginRoot, sourcePath);
    const archivePath = `${archiveDirectory}/${child.name}`;
    const metadata = await lstat(sourcePath);

    if (metadata.isSymbolicLink()) {
      throw new Error(`Plugin archives must not contain symbolic links: ${archivePath}`);
    }
    if (metadata.isDirectory()) {
      await appendTree(entries, sourcePath, archivePath);
      continue;
    }
    if (!metadata.isFile()) {
      throw new Error(`Plugin archives accept only regular files and directories: ${archivePath}`);
    }
    entries.push(fileEntry(archivePath, await readFile(sourcePath)));
  }
}

function validateMarketplace(marketplace) {
  if (marketplace?.name !== expectedMarketplaceName) {
    throw new Error(`Marketplace name must be ${expectedMarketplaceName}`);
  }
  if (!marketplace.interface?.displayName) {
    throw new Error("Marketplace interface.displayName is required");
  }
  if (!Array.isArray(marketplace.plugins)) {
    throw new Error("Marketplace plugins must be an array");
  }
  const pluginEntries = marketplace.plugins.filter(({ name }) => name === expectedPluginName);
  if (pluginEntries.length !== 1) {
    throw new Error(`Marketplace must contain exactly one ${expectedPluginName} entry`);
  }
  const [entry] = pluginEntries;
  if (entry.source?.source !== "local" || entry.source?.path !== `./plugins/${expectedPluginName}`) {
    throw new Error("Proofweave marketplace source must use the bundled local plugin path");
  }
  if (entry.policy?.installation !== "AVAILABLE") {
    throw new Error("Proofweave marketplace installation policy must be AVAILABLE");
  }
  if (entry.policy?.authentication !== "ON_INSTALL") {
    throw new Error("Proofweave marketplace authentication policy must be ON_INSTALL");
  }
  if (typeof entry.category !== "string" || entry.category.length === 0) {
    throw new Error("Proofweave marketplace category is required");
  }
}

async function validatePluginManifest(manifest) {
  if (manifest?.name !== expectedPluginName) {
    throw new Error(`Plugin manifest name must be ${expectedPluginName}`);
  }
  if (!isStrictSemver(manifest.version)) {
    throw new Error("Plugin manifest version must use strict semantic versioning");
  }
  if (typeof manifest.description !== "string" || manifest.description.length === 0) {
    throw new Error("Plugin manifest description is required");
  }
  if (typeof manifest.author?.name !== "string" || manifest.author.name.length === 0) {
    throw new Error("Plugin manifest author.name is required");
  }
  for (const field of [
    "displayName",
    "shortDescription",
    "longDescription",
    "developerName",
    "category",
  ]) {
    if (typeof manifest.interface?.[field] !== "string" || manifest.interface[field].length === 0) {
      throw new Error(`Plugin manifest interface.${field} is required`);
    }
  }
  for (const field of ["skills", "mcpServers"]) {
    const manifestPath = manifest[field];
    if (typeof manifestPath !== "string" || !manifestPath.startsWith("./")) {
      throw new Error(`Plugin manifest ${field} must be a relative ./ path`);
    }
    const resolvedPath = resolve(pluginRoot, manifestPath);
    assertInside(pluginRoot, resolvedPath);
    await lstat(resolvedPath);
  }
  if (manifest.hooks !== undefined) {
    throw new Error("Unsupported plugin manifest field: hooks");
  }
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function isStrictSemver(version) {
  return typeof version === "string"
    && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version);
}

function assertInside(parent, candidate) {
  const child = relative(parent, candidate);
  if (child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !child.startsWith(sep))) {
    return;
  }
  throw new Error(`Path escapes the plugin root: ${candidate}`);
}

function directoryEntry(path) {
  return { path, type: "directory", mode: 0o755, bytes: Buffer.alloc(0) };
}

function fileEntry(path, bytes) {
  return { path, type: "file", mode: 0o644, bytes: Buffer.from(bytes) };
}

function createTar(entries) {
  const chunks = [];
  for (const entry of entries) {
    assertSafeArchivePath(entry.path);
    const header = createTarHeader(entry);
    chunks.push(header, entry.bytes);
    const remainder = entry.bytes.length % 512;
    if (remainder !== 0) chunks.push(Buffer.alloc(512 - remainder));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function createTarHeader(entry) {
  const header = Buffer.alloc(512);
  const { name, prefix } = splitUstarPath(entry.path);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, entry.mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, entry.bytes.length);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  writeString(header, 156, 1, entry.type === "directory" ? "5" : "0");
  writeString(header, 257, 6, "ustar\0");
  writeString(header, 263, 2, "00");
  writeString(header, 265, 32, "proofweave");
  writeString(header, 297, 32, "proofweave");
  writeOctal(header, 329, 8, 0);
  writeOctal(header, 337, 8, 0);
  writeString(header, 345, 155, prefix);

  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

function splitUstarPath(path) {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: "" };
  for (let separator = path.lastIndexOf("/"); separator > 0; separator = path.lastIndexOf("/", separator - 1)) {
    const prefix = path.slice(0, separator);
    const name = path.slice(separator + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }
  throw new Error(`Archive path exceeds the ustar path limit: ${path}`);
}

function writeString(buffer, offset, length, value) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length) throw new Error(`Tar header value exceeds ${length} bytes: ${value}`);
  bytes.copy(buffer, offset);
}

function writeOctal(buffer, offset, length, value) {
  writeString(buffer, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
}

function assertSafeArchivePath(path) {
  if (
    typeof path !== "string"
    || path.length === 0
    || path.startsWith("/")
    || path.includes("\\")
    || path.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(`Unsafe archive path: ${path}`);
  }
}

function comparePaths(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function parseArguments(argv) {
  let outputDirectory;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output-dir") {
      outputDirectory = argv[index + 1];
      if (!outputDirectory) throw new Error("--output-dir requires a path");
      index += 1;
      continue;
    }
    if (argument.startsWith("--output-dir=")) {
      outputDirectory = argument.slice("--output-dir=".length);
      if (!outputDirectory) throw new Error("--output-dir requires a path");
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { outputDirectory };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const { outputDirectory } = parseArguments(process.argv.slice(2));
  const result = await buildProofweavePluginMarketplace({ outputDirectory });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
