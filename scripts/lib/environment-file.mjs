import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";

const environmentKeyPattern = /^[A-Z_][A-Z0-9_]*$/;

/** Load an optional local env file without overriding process-level secrets. */
export async function loadEnvironmentFile(path, { target = process.env } = {}) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return Object.freeze({ exists: false, loaded: Object.freeze([]) });
    throw error;
  }
  const loaded = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const normalized = trimmed.startsWith("export ") ? trimmed.slice(7) : trimmed;
    const separator = normalized.indexOf("=");
    if (separator < 1) throw new Error(`Invalid environment entry on line ${index + 1}.`);
    const key = normalized.slice(0, separator).trim();
    if (!environmentKeyPattern.test(key)) throw new Error(`Invalid environment key on line ${index + 1}.`);
    if (target[key] !== undefined) continue;
    target[key] = parseEnvironmentValue(normalized.slice(separator + 1));
    loaded.push(key);
  }
  return Object.freeze({ exists: true, loaded: Object.freeze(loaded) });
}

/** Atomically update selected entries while keeping unrelated local settings. */
export async function updateEnvironmentFile(path, values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new TypeError("Environment updates must be an object.");
  }
  for (const [key, value] of Object.entries(values)) {
    if (!environmentKeyPattern.test(key)) throw new Error(`Invalid environment key ${key}.`);
    if (typeof value !== "string" || !value || /[\0\r\n]/.test(value)) {
      throw new Error(`Environment value for ${key} must be a non-empty single line.`);
    }
  }

  let source = "";
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const lines = source ? source.replace(/\r\n/g, "\n").split("\n") : [];
  if (lines.at(-1) === "") lines.pop();
  const remaining = new Map(Object.entries(values));
  const updated = lines.map((line) => {
    const match = /^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/.exec(line.trim());
    if (!match || !remaining.has(match[1])) return line;
    const value = remaining.get(match[1]);
    remaining.delete(match[1]);
    return `${match[1]}=${formatEnvironmentValue(value)}`;
  });
  if (remaining.size > 0 && updated.length > 0 && updated.at(-1) !== "") updated.push("");
  for (const [key, value] of remaining) updated.push(`${key}=${formatEnvironmentValue(value)}`);
  const rendered = `${updated.join("\n")}\n`;
  const temporaryPath = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporaryPath, rendered, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
}

function parseEnvironmentValue(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error("Invalid double-quoted environment value.");
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

function formatEnvironmentValue(value) {
  return /^[A-Za-z0-9_./:+-]+$/.test(value) ? value : JSON.stringify(value);
}
