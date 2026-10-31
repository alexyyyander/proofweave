#!/usr/bin/env node
/**
 * Operator tool for the environment-only Person/Agent/Attempt research-write
 * window. It edits one local window document, validates every change with the
 * same parser the runtime gate uses, and renders the exact env value to deploy.
 *
 * It never deploys, never changes a surface mode, and never touches a database.
 */

import { randomUUID } from "node:crypto";
import { open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RESEARCH_WRITE_ALLOWLIST_SCHEMA_VERSION,
  researchWriteAllowlistEnvKey,
  researchWriteAllowlistState,
  researchWriteAllowlistValues,
  researchWriteGateSummary,
} from "../services/database/research-write-allowlist.mjs";

export const RESEARCH_WINDOW_DOCUMENT_SCHEMA_VERSION = "pw-research-window-document-v1";

export const researchWindowSurfaces = Object.freeze(["participant", "mcp"]);

const topLevelKeys = new Set(["schemaVersion", "participant", "mcp"]);
const surfaceKeys = new Set(["persons", "agents", "attempts", "allowNewAttempts"]);
const surfaceSelections = new Set(["participant", "mcp", "both"]);
// Mirrors maximumEntries in services/database/research-write-allowlist.mjs.
const maximumEntries = 100;
const maximumIdentifierLength = 240;

const dimensions = Object.freeze({
  person: Object.freeze({ list: "persons", prefix: "person:" }),
  agent: Object.freeze({ list: "agents", prefix: "urn:pw:agent:" }),
  attempt: Object.freeze({ list: "attempts", prefix: "attempt:" }),
});

const mutationCommands = Object.freeze({
  "add-person": Object.freeze({ dimension: "person", remove: false }),
  "remove-person": Object.freeze({ dimension: "person", remove: true }),
  "add-agent": Object.freeze({ dimension: "agent", remove: false }),
  "remove-agent": Object.freeze({ dimension: "agent", remove: true }),
  "add-attempt": Object.freeze({ dimension: "attempt", remove: false }),
  "remove-attempt": Object.freeze({ dimension: "attempt", remove: true }),
});

const commandFlags = Object.freeze({
  show: ["file"],
  "add-person": ["file", "surface", "id"],
  "remove-person": ["file", "surface", "id"],
  "add-agent": ["file", "surface", "id"],
  "remove-agent": ["file", "surface", "id"],
  "add-attempt": ["file", "surface", "id"],
  "remove-attempt": ["file", "surface", "id"],
  "set-new-attempts": ["file", "surface", "allow"],
  export: ["file", "surface"],
});

const usage = `Usage:
  node scripts/research-window.mjs show --file <path>
  node scripts/research-window.mjs add-person|remove-person --file <path> --surface participant|mcp|both --id <person:<uuid>>
  node scripts/research-window.mjs add-agent|remove-agent --file <path> --surface participant|mcp|both --id <urn:pw:agent:<uuid>>
  node scripts/research-window.mjs add-attempt|remove-attempt --file <path> --surface participant|mcp|both --id <attempt:<uuid>>
  node scripts/research-window.mjs set-new-attempts --file <path> --surface participant|mcp|both --allow true|false
  node scripts/research-window.mjs export --file <path> --surface participant|mcp|both

Via package script, insert "--" before tool arguments:
  npm run research:window -- show --file <path>
`;

export class ResearchWindowError extends Error {
  constructor(message) {
    super(message);
    this.name = "ResearchWindowError";
  }
}

class ResearchWindowUsageError extends ResearchWindowError {
  constructor(message) {
    super(message);
    this.name = "ResearchWindowUsageError";
  }
}

/**
 * Validate a parsed window document. Never throws on bad content; the returned
 * surface summaries contain counts and failure codes, never identifiers.
 */
export function validateResearchWindowDocument(document) {
  if (!isRecord(document)) {
    return freezeValidation(false, "invalid_document", { participant: null, mcp: null });
  }
  const surfaces = {};
  for (const surface of researchWindowSurfaces) {
    surfaces[surface] = summarizeSurface(document[surface], surface);
  }
  if (Object.keys(document).some((key) => !topLevelKeys.has(key))) {
    return freezeValidation(false, "unknown_field", surfaces);
  }
  if (document.schemaVersion !== RESEARCH_WINDOW_DOCUMENT_SCHEMA_VERSION) {
    return freezeValidation(false, "invalid_schema_version", surfaces);
  }
  const invalidSurface = researchWindowSurfaces.find((surface) => !surfaces[surface].valid);
  if (invalidSurface) {
    return freezeValidation(false, `invalid_${invalidSurface}`, surfaces);
  }
  return freezeValidation(true, null, surfaces);
}

/**
 * Read and inspect one window document. Unlike the mutating commands, `show`
 * reports an invalid document instead of failing without detail.
 */
export async function inspectResearchWindowFile(filePath) {
  const raw = await readWindowFile(filePath);
  let document;
  try {
    document = JSON.parse(raw);
  } catch {
    return Object.freeze({
      file: filePath,
      document: null,
      valid: false,
      failureCode: "invalid_json",
      surfaces: Object.freeze({ participant: null, mcp: null }),
    });
  }
  const validation = validateResearchWindowDocument(document);
  return Object.freeze({ file: filePath, document, ...validation });
}

/** Load a document only when it is valid; throws a precise error otherwise. */
export async function loadValidResearchWindowFile(filePath) {
  const inspected = await inspectResearchWindowFile(filePath);
  if (!inspected.valid) {
    throw new ResearchWindowError(
      `refusing to use invalid window document ${filePath}: ${formatFailure(inspected)}`,
    );
  }
  return inspected.document;
}

/** Non-identifying summary used by `show`. */
export async function summarizeResearchWindow(filePath) {
  const inspected = await inspectResearchWindowFile(filePath);
  return Object.freeze({
    file: filePath,
    schemaVersion: isRecord(inspected.document) && typeof inspected.document.schemaVersion === "string"
      ? inspected.document.schemaVersion
      : null,
    valid: inspected.valid,
    failureCode: inspected.failureCode,
    surfaces: inspected.surfaces,
  });
}

/**
 * Add one stable internal identifier to one or both surfaces. Adding an ID
 * that is already present is idempotent and reports `changed: false`.
 */
export function addResearchWindowEntry(document, surfaceSelection, dimension, identifier) {
  requireValidWindowDocument(document, `add ${dimension}`);
  const surfaces = normalizeSurfaceSelection(surfaceSelection);
  const id = requireIdentifier(dimension, identifier);
  const next = cloneWindowDocument(document);
  let changed = false;
  for (const surface of surfaces) {
    const list = next[surface][dimensions[dimension].list];
    if (list.includes(id)) continue;
    if (list.length >= maximumEntries) {
      throw new ResearchWindowError(
        `cannot add ${dimension}: ${surface} already holds ${maximumEntries} entries`,
      );
    }
    list.push(id);
    changed = true;
  }
  requireValidWindowDocument(next, `add ${dimension}`);
  return Object.freeze({ document: next, changed });
}

/**
 * Remove one identifier from every selected surface or fail without producing
 * a partially updated document. The last Person or Agent in a surface cannot
 * be removed; Attempt lists may become empty.
 */
export function removeResearchWindowEntry(document, surfaceSelection, dimension, identifier) {
  requireValidWindowDocument(document, `remove ${dimension}`);
  const surfaces = normalizeSurfaceSelection(surfaceSelection);
  const id = requireIdentifier(dimension, identifier);
  const listName = dimensions[dimension].list;
  const next = cloneWindowDocument(document);
  const missing = surfaces.filter((surface) => !next[surface][listName].includes(id));
  if (missing.length > 0) {
    throw new ResearchWindowError(
      `${dimension} ${id} was not found in ${missing.join(" and ")}`,
    );
  }
  for (const surface of surfaces) {
    const list = next[surface][listName];
    list.splice(list.indexOf(id), 1);
    if ((dimension === "person" || dimension === "agent") && list.length === 0) {
      throw new ResearchWindowError(
        `refusing to remove the last ${dimension} from ${surface}; add a replacement first`,
      );
    }
  }
  requireValidWindowDocument(next, `remove ${dimension}`);
  return Object.freeze({ document: next, changed: true });
}

/** Set the new-Attempt creation window for one or both surfaces. */
export function setResearchWindowNewAttempts(document, surfaceSelection, allow) {
  requireValidWindowDocument(document, "set allowNewAttempts");
  if (typeof allow !== "boolean") {
    throw new ResearchWindowError("allowNewAttempts must be true or false");
  }
  const surfaces = normalizeSurfaceSelection(surfaceSelection);
  const next = cloneWindowDocument(document);
  let changed = false;
  for (const surface of surfaces) {
    if (next[surface].allowNewAttempts === allow) continue;
    next[surface].allowNewAttempts = allow;
    changed = true;
  }
  requireValidWindowDocument(next, "set allowNewAttempts");
  return Object.freeze({ document: next, changed });
}

/**
 * Render the deployable env assignment line(s) for the selected surface(s).
 * The value is the literal JSON expected by the runtime gate; no other keys,
 * secrets, or identifiers are added.
 */
export function renderResearchWindowEnv(document, surfaceSelection) {
  requireValidWindowDocument(document, "export");
  const surfaces = normalizeSurfaceSelection(surfaceSelection);
  return surfaces.map((surface) => {
    const raw = JSON.stringify({
      schemaVersion: RESEARCH_WRITE_ALLOWLIST_SCHEMA_VERSION,
      persons: [...document[surface].persons],
      agents: [...document[surface].agents],
      attempts: [...document[surface].attempts],
      allowNewAttempts: document[surface].allowNewAttempts,
    });
    // Re-parse exactly as the runtime does before handing the value to an
    // operator who may paste it into a deployment configuration.
    const state = researchWriteAllowlistState(
      researchWriteAllowlistValues(surface, raw),
      surface,
    );
    if (!state.valid) {
      throw new ResearchWindowError(`cannot export ${surface}: ${state.failureCode}`);
    }
    return `${researchWriteAllowlistEnvKey(surface)}=${raw}`;
  });
}

/** True when a selected surface still contains example placeholders. */
export function containsPlaceholderIdentifiers(document, surfaceSelection) {
  const surfaces = normalizeSurfaceSelection(surfaceSelection);
  return surfaces.some((surface) => ["persons", "agents", "attempts"].some((list) =>
    document[surface][list].some((id) => id.includes("<") || id.includes(">"))));
}

/**
 * Write the document through a same-directory temporary file and atomic
 * rename. A validation or write failure leaves the previous file untouched.
 */
export async function writeResearchWindowDocumentAtomically(filePath, document) {
  requireValidWindowDocument(document, "write");
  const payload = `${JSON.stringify(document, null, 2)}\n`;
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let handle = null;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(payload, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporaryPath, filePath);
  } catch (error) {
    if (handle) {
      try { await handle.close(); } catch { /* best-effort cleanup */ }
    }
    try { await unlink(temporaryPath); } catch { /* absent or already renamed */ }
    throw new ResearchWindowError(`could not write ${filePath}: ${error.message}`);
  }
}

/** CLI entry point; returns the process exit code. */
export async function runResearchWindowCli(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const { command, options } = parseCliArguments(argv);
    if (command === "show") {
      const summary = await summarizeResearchWindow(options.file);
      stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      if (!summary.valid) {
        stderr.write(`research-window: ${options.file} is invalid: ${formatFailure(summary)}\n`);
        return 1;
      }
      return 0;
    }
    if (command === "export") {
      const document = await loadValidResearchWindowFile(options.file);
      const lines = renderResearchWindowEnv(document, options.surface);
      stdout.write(`${lines.join("\n")}\n`);
      if (containsPlaceholderIdentifiers(document, options.surface)) {
        stderr.write(
          "research-window: warning: the exported window still contains placeholder IDs; do not deploy it.\n",
        );
      }
      return 0;
    }
    const document = await loadValidResearchWindowFile(options.file);
    let result;
    let detail;
    if (command === "set-new-attempts") {
      const allow = parseBooleanOption(options.allow);
      result = setResearchWindowNewAttempts(document, options.surface, allow);
      detail = { allow };
    } else {
      const mutation = mutationCommands[command];
      result = mutation.remove
        ? removeResearchWindowEntry(document, options.surface, mutation.dimension, options.id)
        : addResearchWindowEntry(document, options.surface, mutation.dimension, options.id);
      detail = { id: options.id };
    }
    if (result.changed) {
      await writeResearchWindowDocumentAtomically(options.file, result.document);
    }
    const summary = validateResearchWindowDocument(result.document);
    stdout.write(`${JSON.stringify({
      ok: true,
      command,
      file: options.file,
      surface: options.surface,
      ...detail,
      changed: result.changed,
      surfaces: summary.surfaces,
    }, null, 2)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof ResearchWindowUsageError) {
      stderr.write(`research-window: ${error.message}\n\n${usage}`);
      return 2;
    }
    stderr.write(`research-window: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function parseCliArguments(argv) {
  const [command, ...rest] = argv;
  if (typeof command !== "string" || !Object.hasOwn(commandFlags, command)) {
    throw new ResearchWindowUsageError(
      command === undefined ? "a command is required" : `unknown command ${JSON.stringify(command)}`,
    );
  }
  const allowed = commandFlags[command];
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (!argument.startsWith("--")) {
      throw new ResearchWindowUsageError(`unexpected argument ${JSON.stringify(argument)}`);
    }
    const equals = argument.indexOf("=");
    let name;
    let value;
    if (equals === -1) {
      name = argument.slice(2);
      value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new ResearchWindowUsageError(`--${name} requires a value`);
      }
      index += 1;
    } else {
      name = argument.slice(2, equals);
      value = argument.slice(equals + 1);
    }
    if (!allowed.includes(name)) {
      throw new ResearchWindowUsageError(`unknown option --${name} for ${command}`);
    }
    if (value === "") {
      throw new ResearchWindowUsageError(`--${name} requires a non-empty value`);
    }
    if (Object.hasOwn(options, name)) {
      throw new ResearchWindowUsageError(`--${name} may only be provided once`);
    }
    options[name] = value;
  }
  for (const name of allowed) {
    if (!Object.hasOwn(options, name)) {
      throw new ResearchWindowUsageError(`missing required option --${name}`);
    }
  }
  return { command, options };
}

function parseBooleanOption(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ResearchWindowUsageError("--allow must be true or false");
}

function summarizeSurface(value, surface) {
  if (!isRecord(value)) {
    return invalidSurfaceSummary(surface, value === undefined ? "missing_surface" : "invalid_document", value !== undefined);
  }
  if (Object.keys(value).some((key) => !surfaceKeys.has(key))) {
    return invalidSurfaceSummary(surface, "unknown_field", true);
  }
  const raw = JSON.stringify({
    schemaVersion: RESEARCH_WRITE_ALLOWLIST_SCHEMA_VERSION,
    persons: value.persons,
    agents: value.agents,
    attempts: value.attempts,
    allowNewAttempts: value.allowNewAttempts,
  });
  return researchWriteGateSummary(researchWriteAllowlistValues(surface, raw), surface);
}

function invalidSurfaceSummary(surface, failureCode, configured) {
  return Object.freeze({
    schemaVersion: RESEARCH_WRITE_ALLOWLIST_SCHEMA_VERSION,
    surface,
    configured,
    valid: false,
    failureCode,
    personCount: 0,
    agentCount: 0,
    attemptCount: 0,
    allowNewAttempts: false,
  });
}

function freezeValidation(valid, failureCode, surfaces) {
  return Object.freeze({ valid, failureCode, surfaces: Object.freeze(surfaces) });
}

function requireValidWindowDocument(document, operation) {
  const validation = validateResearchWindowDocument(document);
  if (!validation.valid) {
    throw new ResearchWindowError(
      `cannot ${operation}: window document is invalid: ${formatFailure(validation)}`,
    );
  }
  return validation;
}

function formatFailure(validation) {
  const details = researchWindowSurfaces.map((surface) => {
    const summary = validation.surfaces?.[surface];
    if (!summary) return `${surface}=missing`;
    return `${surface}=${summary.valid ? "valid" : summary.failureCode ?? "invalid"}`;
  }).join(", ");
  return `${validation.failureCode ?? "invalid"} (${details})`;
}

function normalizeSurfaceSelection(surfaceSelection) {
  if (!surfaceSelections.has(surfaceSelection)) {
    throw new ResearchWindowError(
      `--surface must be participant, mcp, or both (received ${JSON.stringify(surfaceSelection)})`,
    );
  }
  return surfaceSelection === "both" ? researchWindowSurfaces : [surfaceSelection];
}

function requireIdentifier(dimension, identifier) {
  const definition = dimensions[dimension];
  if (!definition) throw new ResearchWindowError(`unknown identifier dimension: ${dimension}`);
  if (typeof identifier !== "string" || identifier.length === 0) {
    throw new ResearchWindowError(`${dimension} id must be a non-empty string`);
  }
  if (identifier !== identifier.trim()) {
    throw new ResearchWindowError(`${dimension} id must not have surrounding whitespace`);
  }
  if (identifier.length > maximumIdentifierLength) {
    throw new ResearchWindowError(`${dimension} id must be at most ${maximumIdentifierLength} characters`);
  }
  if (/[\u0000-\u001f\u007f]/.test(identifier)) {
    throw new ResearchWindowError(`${dimension} id must not contain control characters`);
  }
  if (!identifier.startsWith(definition.prefix)) {
    throw new ResearchWindowError(`${dimension} id must start with ${definition.prefix}`);
  }
  if (!/^[A-Za-z0-9:<>_-]+$/.test(identifier)) {
    throw new ResearchWindowError(
      `${dimension} id may contain only letters, digits, ":", "<", ">", "_" or "-"`,
    );
  }
  return identifier;
}

function cloneWindowDocument(document) {
  return {
    schemaVersion: RESEARCH_WINDOW_DOCUMENT_SCHEMA_VERSION,
    participant: cloneSurface(document.participant),
    mcp: cloneSurface(document.mcp),
  };
}

function cloneSurface(surface) {
  return {
    persons: [...surface.persons],
    agents: [...surface.agents],
    attempts: [...surface.attempts],
    allowNewAttempts: surface.allowNewAttempts,
  };
}

async function readWindowFile(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new ResearchWindowError(`window document not found: ${filePath}`);
    }
    throw new ResearchWindowError(`could not read ${filePath}: ${error.message}`);
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  runResearchWindowCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
