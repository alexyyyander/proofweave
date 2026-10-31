import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  RESEARCH_WINDOW_DOCUMENT_SCHEMA_VERSION,
  ResearchWindowError,
  addResearchWindowEntry,
  containsPlaceholderIdentifiers,
  inspectResearchWindowFile,
  loadValidResearchWindowFile,
  removeResearchWindowEntry,
  renderResearchWindowEnv,
  runResearchWindowCli,
  setResearchWindowNewAttempts,
  summarizeResearchWindow,
  validateResearchWindowDocument,
  writeResearchWindowDocumentAtomically,
} from "../scripts/research-window.mjs";

const personA = "person:11111111-1111-4111-8111-111111111111";
const personB = "person:22222222-2222-4222-8222-222222222222";
const agentA = "urn:pw:agent:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const agentB = "urn:pw:agent:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const attemptA = "attempt:cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const attemptB = "attempt:dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const examplePath = fileURLToPath(new URL("../config/research-write-window.example.json", import.meta.url));
const scriptPath = fileURLToPath(new URL("../scripts/research-window.mjs", import.meta.url));

function surface(persons = [personA], agents = [agentA], attempts = [attemptA], allowNewAttempts = false) {
  return { persons, agents, attempts, allowNewAttempts };
}

function windowDocument({
  participant = surface(),
  mcp = surface(),
} = {}) {
  return {
    schemaVersion: RESEARCH_WINDOW_DOCUMENT_SCHEMA_VERSION,
    participant,
    mcp,
  };
}

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "pw-research-window-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writeDocument(directory, document, name = "window.json") {
  const path = join(directory, name);
  await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return path;
}

function runCli(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], { encoding: "utf8" });
}

function captureCli() {
  let out = "";
  let err = "";
  return {
    streams: {
      stdout: { write: (chunk) => { out += chunk; } },
      stderr: { write: (chunk) => { err += chunk; } },
    },
    stdout: () => out,
    stderr: () => err,
  };
}

test("the example document is valid and `show` summaries never expose identifiers", async () => {
  const summary = await summarizeResearchWindow(examplePath);
  assert.equal(summary.valid, true);
  assert.equal(summary.failureCode, null);
  for (const name of ["participant", "mcp"]) {
    assert.equal(summary.surfaces[name].valid, true);
    assert.equal(summary.surfaces[name].personCount, 1);
    assert.equal(summary.surfaces[name].agentCount, 1);
    assert.equal(summary.surfaces[name].attemptCount, 1);
    assert.equal(summary.surfaces[name].allowNewAttempts, false);
  }
  const rendered = JSON.stringify(summary);
  assert.equal(rendered.includes("person:"), false);
  assert.equal(rendered.includes("urn:pw:agent:"), false);
  assert.equal(rendered.includes("attempt:"), false);
});

test("add and remove work on the selected surface and keep surfaces independent", async (t) => {
  const directory = await temporaryDirectory(t);
  const file = await writeDocument(directory, windowDocument());

  let loaded = await loadValidResearchWindowFile(file);
  let result = addResearchWindowEntry(loaded, "participant", "person", personB);
  assert.equal(result.changed, true);
  await writeResearchWindowDocumentAtomically(file, result.document);

  loaded = await loadValidResearchWindowFile(file);
  assert.deepEqual(loaded.participant.persons, [personA, personB]);
  assert.deepEqual(loaded.mcp.persons, [personA]);
  assert.equal(renderResearchWindowEnv(loaded, "participant")[0].includes(personB), true);
  assert.equal(renderResearchWindowEnv(loaded, "mcp")[0].includes(personB), false);

  result = addResearchWindowEntry(loaded, "both", "agent", agentB);
  assert.equal(result.changed, true);
  await writeResearchWindowDocumentAtomically(file, result.document);

  loaded = await loadValidResearchWindowFile(file);
  assert.deepEqual(loaded.participant.agents, [agentA, agentB]);
  assert.deepEqual(loaded.mcp.agents, [agentA, agentB]);

  result = addResearchWindowEntry(loaded, "mcp", "attempt", attemptB);
  assert.equal(result.changed, true);
  await writeResearchWindowDocumentAtomically(file, result.document);

  loaded = await loadValidResearchWindowFile(file);
  assert.deepEqual(loaded.participant.attempts, [attemptA]);
  assert.deepEqual(loaded.mcp.attempts, [attemptA, attemptB]);

  result = removeResearchWindowEntry(loaded, "participant", "person", personB);
  assert.equal(result.changed, true);
  await writeResearchWindowDocumentAtomically(file, result.document);

  loaded = await loadValidResearchWindowFile(file);
  assert.deepEqual(loaded.participant.persons, [personA]);
  assert.deepEqual(loaded.mcp.persons, [personA]);
  assert.deepEqual(loaded.participant.agents, [agentA, agentB]);
  assert.deepEqual(loaded.mcp.agents, [agentA, agentB]);
});

test("duplicate additions are idempotent and a no-op CLI call leaves the file untouched", async (t) => {
  const directory = await temporaryDirectory(t);
  const document = windowDocument();
  const file = await writeDocument(directory, document);

  assert.equal(addResearchWindowEntry(document, "both", "person", personA).changed, false);
  assert.equal(addResearchWindowEntry(document, "participant", "agent", agentA).changed, false);

  const added = addResearchWindowEntry(document, "participant", "person", personB);
  assert.equal(added.changed, true);
  await writeResearchWindowDocumentAtomically(file, added.document);
  assert.deepEqual((await loadValidResearchWindowFile(file)).participant.persons, [personA, personB]);

  const inodeBefore = (await stat(file)).ino;
  const capture = captureCli();
  const exitCode = await runResearchWindowCli(
    ["add-person", "--file", file, "--surface", "participant", "--id", personB],
    capture.streams,
  );
  assert.equal(exitCode, 0);
  assert.equal(JSON.parse(capture.stdout()).changed, false);
  assert.equal((await stat(file)).ino, inodeBefore);
  assert.deepEqual((await loadValidResearchWindowFile(file)).participant.persons, [personA, personB]);
});

test("removing a missing identifier fails explicitly and never touches any surface", async (t) => {
  const directory = await temporaryDirectory(t);
  // Person B exists only in participant; a `both` removal must fail atomically.
  const document = windowDocument({
    participant: surface([personA, personB]),
    mcp: surface([personA]),
  });
  const file = await writeDocument(directory, document);
  const original = await readFile(file, "utf8");

  assert.throws(
    () => removeResearchWindowEntry(document, "participant", "person", personB.replace("2222", "3333")),
    /not found in participant/,
  );
  assert.throws(
    () => removeResearchWindowEntry(document, "both", "person", personB),
    /not found in mcp/,
  );
  assert.deepEqual(document.participant.persons, [personA, personB]);

  const exitCode = await runResearchWindowCli(
    ["remove-person", "--file", file, "--surface", "both", "--id", personB],
    captureCli().streams,
  );
  assert.equal(exitCode, 1);
  assert.equal(await readFile(file, "utf8"), original);
});

test("empty Attempt lists are allowed while the last Person or Agent is protected", () => {
  const document = windowDocument();

  const emptied = removeResearchWindowEntry(document, "both", "attempt", attemptA);
  assert.deepEqual(emptied.document.participant.attempts, []);
  assert.deepEqual(emptied.document.mcp.attempts, []);

  assert.throws(
    () => removeResearchWindowEntry(document, "participant", "person", personA),
    /last person from participant/,
  );
  assert.throws(
    () => removeResearchWindowEntry(document, "mcp", "agent", agentA),
    /last agent from mcp/,
  );
  assert.throws(
    () => removeResearchWindowEntry(document, "both", "person", personA),
    /last person from participant/,
  );
});

test("invalid documents are rejected with precise failure codes and cannot be modified", async (t) => {
  const emptyPersons = windowDocument({ participant: surface([], [agentA], [], false) });
  const validation = validateResearchWindowDocument(emptyPersons);
  assert.equal(validation.valid, false);
  assert.equal(validation.failureCode, "invalid_participant");
  assert.equal(validation.surfaces.participant.failureCode, "invalid_persons");
  assert.equal(validation.surfaces.mcp.valid, true);
  assert.throws(
    () => addResearchWindowEntry(emptyPersons, "participant", "person", personB),
    /invalid_participant \(participant=invalid_persons, mcp=valid\)/,
  );

  const emptyAgents = windowDocument({ mcp: surface([personA], [], [], false) });
  const agentValidation = validateResearchWindowDocument(emptyAgents);
  assert.equal(agentValidation.failureCode, "invalid_mcp");
  assert.equal(agentValidation.surfaces.mcp.failureCode, "invalid_agents");

  assert.equal(validateResearchWindowDocument([]).failureCode, "invalid_document");
  assert.equal(
    validateResearchWindowDocument({ ...windowDocument(), extra: true }).failureCode,
    "unknown_field",
  );
  assert.equal(
    validateResearchWindowDocument({ ...windowDocument(), schemaVersion: "v0" }).failureCode,
    "invalid_schema_version",
  );
  const unknownSurfaceField = windowDocument();
  unknownSurfaceField.participant.extra = true;
  const unknownValidation = validateResearchWindowDocument(unknownSurfaceField);
  assert.equal(unknownValidation.failureCode, "invalid_participant");
  assert.equal(unknownValidation.surfaces.participant.failureCode, "unknown_field");

  const missingSurface = windowDocument();
  delete missingSurface.mcp;
  const missingValidation = validateResearchWindowDocument(missingSurface);
  assert.equal(missingValidation.failureCode, "invalid_mcp");
  assert.equal(missingValidation.surfaces.mcp.failureCode, "missing_surface");
  assert.equal(missingValidation.surfaces.mcp.configured, false);

  const directory = await temporaryDirectory(t);
  const invalidJsonFile = join(directory, "invalid.json");
  await writeFile(invalidJsonFile, "{not json", "utf8");
  const inspected = await inspectResearchWindowFile(invalidJsonFile);
  assert.equal(inspected.valid, false);
  assert.equal(inspected.failureCode, "invalid_json");
  assert.equal(inspected.surfaces.participant, null);
  await assert.rejects(loadValidResearchWindowFile(invalidJsonFile), /invalid_json/);
  assert.equal(await readFile(invalidJsonFile, "utf8"), "{not json");

  const exitCode = await runResearchWindowCli(
    ["add-person", "--file", invalidJsonFile, "--surface", "participant", "--id", personB],
    captureCli().streams,
  );
  assert.equal(exitCode, 1);
  assert.equal(await readFile(invalidJsonFile, "utf8"), "{not json");
});

test("identifiers require the stable internal prefix and stay within gate limits", () => {
  const document = windowDocument();
  assert.throws(
    () => addResearchWindowEntry(document, "participant", "agent", personA),
    /agent id must start with urn:pw:agent:/,
  );
  assert.throws(
    () => addResearchWindowEntry(document, "participant", "person", ` ${personB}`),
    /surrounding whitespace/,
  );
  assert.throws(
    () => addResearchWindowEntry(document, "participant", "attempt", `attempt:${"x".repeat(240)}`),
    /at most 240 characters/,
  );
  assert.throws(
    () => addResearchWindowEntry(document, "participant", "person", "person:\u0000"),
    /control characters/,
  );
  assert.throws(
    () => addResearchWindowEntry(document, "participant", "person", "person:a=b"),
    /may contain only/,
  );
  assert.throws(
    () => addResearchWindowEntry(document, "participant", "person", ""),
    /non-empty string/,
  );
  assert.doesNotThrow(() => addResearchWindowEntry(document, "participant", "person", "person:<uuid>"));
  assert.throws(
    () => addResearchWindowEntry(document, "everywhere", "person", personB),
    /--surface must be participant, mcp, or both/,
  );
});

test("set-new-attempts changes only the selected surfaces", () => {
  const document = windowDocument();
  let result = setResearchWindowNewAttempts(document, "both", true);
  assert.equal(result.changed, true);
  assert.equal(result.document.participant.allowNewAttempts, true);
  assert.equal(result.document.mcp.allowNewAttempts, true);

  result = setResearchWindowNewAttempts(result.document, "participant", true);
  assert.equal(result.changed, false);

  result = setResearchWindowNewAttempts(result.document, "mcp", false);
  assert.equal(result.changed, true);
  assert.equal(result.document.participant.allowNewAttempts, true);
  assert.equal(result.document.mcp.allowNewAttempts, false);

  assert.throws(
    () => setResearchWindowNewAttempts(document, "participant", "yes"),
    /must be true or false/,
  );
});

test("export renders one deployable env assignment per surface and nothing else", () => {
  const document = windowDocument();
  const participantLines = renderResearchWindowEnv(document, "participant");
  assert.equal(participantLines.length, 1);
  const separator = participantLines[0].indexOf("=");
  assert.equal(participantLines[0].slice(0, separator), "PROOFWEAVE_PARTICIPANT_RESEARCH_WRITE_ALLOWLIST_JSON");
  const value = participantLines[0].slice(separator + 1);
  assert.equal(value.includes("\n"), false);
  const parsed = JSON.parse(value);
  assert.deepEqual(Object.keys(parsed), ["schemaVersion", "persons", "agents", "attempts", "allowNewAttempts"]);
  assert.equal(parsed.schemaVersion, "pw-research-write-allowlist-v1");
  assert.deepEqual(parsed.persons, [personA]);
  assert.deepEqual(parsed.agents, [agentA]);
  assert.deepEqual(parsed.attempts, [attemptA]);
  assert.equal(parsed.allowNewAttempts, false);

  const mcpLines = renderResearchWindowEnv(document, "mcp");
  assert.equal(mcpLines.length, 1);
  assert.equal(mcpLines[0].startsWith("PROOFWEAVE_MCP_RESEARCH_WRITE_ALLOWLIST_JSON="), true);

  const bothLines = renderResearchWindowEnv(document, "both");
  assert.equal(bothLines.length, 2);
  assert.equal(bothLines[0].startsWith("PROOFWEAVE_PARTICIPANT_RESEARCH_WRITE_ALLOWLIST_JSON="), true);
  assert.equal(bothLines[1].startsWith("PROOFWEAVE_MCP_RESEARCH_WRITE_ALLOWLIST_JSON="), true);

  const invalid = windowDocument({ participant: surface([], [agentA], [], false) });
  assert.throws(() => renderResearchWindowEnv(invalid, "participant"), /invalid/);

  assert.equal(containsPlaceholderIdentifiers(document, "both"), false);

  const placeholderDocument = {
    schemaVersion: RESEARCH_WINDOW_DOCUMENT_SCHEMA_VERSION,
    participant: surface(["person:<uuid>"], ["urn:pw:agent:<uuid>"], ["attempt:<uuid>"], false),
    mcp: surface(["person:<uuid>"], ["urn:pw:agent:<uuid>"], ["attempt:<uuid>"], false),
  };
  assert.equal(containsPlaceholderIdentifiers(placeholderDocument, "participant"), true);
});

test("setting a new-Attempts window is reflected in the exported env value", () => {
  const document = setResearchWindowNewAttempts(windowDocument(), "both", true).document;
  const parsed = JSON.parse(renderResearchWindowEnv(document, "mcp")[0].split("=").slice(1).join("="));
  assert.equal(parsed.allowNewAttempts, true);
});

test("writes use a temporary file and atomic rename, and failures leave no debris", async (t) => {
  const directory = await temporaryDirectory(t);
  const file = join(directory, "window.json");
  const original = `${JSON.stringify(windowDocument(), null, 2)}\n`;
  await writeFile(file, original, "utf8");

  const next = addResearchWindowEntry(windowDocument(), "participant", "person", personB).document;
  await writeResearchWindowDocumentAtomically(file, next);

  assert.deepEqual(await readdir(directory), ["window.json"]);
  const text = await readFile(file, "utf8");
  assert.equal(text.endsWith("\n"), true);
  assert.deepEqual(JSON.parse(text).participant.persons, [personA, personB]);

  const invalid = windowDocument({ participant: surface([], [agentA], [], false) });
  await assert.rejects(writeResearchWindowDocumentAtomically(file, invalid), /invalid/);
  assert.equal(await readFile(file, "utf8"), text);

  // Force the rename step to fail by targeting an existing directory.
  const targetDirectory = join(directory, "target.json");
  await mkdir(targetDirectory);
  await assert.rejects(
    writeResearchWindowDocumentAtomically(targetDirectory, next),
    (error) => error instanceof ResearchWindowError && /could not write/.test(error.message),
  );
  const entries = await readdir(directory);
  assert.equal(entries.some((name) => name.endsWith(".tmp")), false);
  assert.equal(entries.includes("target.json"), true);
});

test("CLI show, mutation, export, invalid file, and usage exit codes are stable", async (t) => {
  const directory = await temporaryDirectory(t);
  const file = await writeDocument(directory, windowDocument());

  let result = runCli(["show", "--file", file]);
  assert.equal(result.status, 0, result.stderr);
  const shown = JSON.parse(result.stdout);
  assert.equal(shown.valid, true);
  assert.equal(shown.surfaces.participant.personCount, 1);
  assert.equal(JSON.stringify(shown).includes(personA), false);

  result = runCli(["add-person", "--file", file, "--surface", "participant", "--id", personB]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).changed, true);
  assert.equal(JSON.parse(result.stdout).surfaces.participant.personCount, 2);
  assert.equal(JSON.parse(result.stdout).surfaces.mcp.personCount, 1);

  result = runCli(["set-new-attempts", "--file", file, "--surface", "both", "--allow", "true"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).allow, true);

  result = runCli(["remove-person", "--file", file, "--surface", "participant", "--id", personB]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).changed, true);

  result = runCli(["export", "--file", file, "--surface", "both"]);
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[0].startsWith("PROOFWEAVE_PARTICIPANT_RESEARCH_WRITE_ALLOWLIST_JSON="), true);
  assert.equal(lines[1].startsWith("PROOFWEAVE_MCP_RESEARCH_WRITE_ALLOWLIST_JSON="), true);

  result = runCli(["add-person", "--file", file, "--surface", "participant"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /missing required option --id/);

  result = runCli(["set-new-attempts", "--file", file, "--surface", "participant", "--allow", "yes"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /must be true or false/);

  result = runCli(["unknown-command", "--file", file]);
  assert.equal(result.status, 2);

  const invalidFile = join(directory, "invalid.json");
  await writeFile(invalidFile, "{not json", "utf8");
  result = runCli(["show", "--file", invalidFile]);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).failureCode, "invalid_json");
  assert.match(result.stderr, /invalid_json/);
});

test("CLI export warns when the window still contains placeholders", () => {
  const result = runCli(["export", "--file", examplePath, "--surface", "participant"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /placeholder/);
  const [line] = result.stdout.trim().split("\n");
  assert.equal(line.startsWith("PROOFWEAVE_PARTICIPANT_RESEARCH_WRITE_ALLOWLIST_JSON="), true);
  const parsed = JSON.parse(line.slice(line.indexOf("=") + 1));
  assert.deepEqual(parsed.persons, ["person:<uuid>"]);
  assert.equal(parsed.allowNewAttempts, false);
});
