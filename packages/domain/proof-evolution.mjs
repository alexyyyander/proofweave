export const PROOF_EVOLUTION_SCHEMA_VERSION = "pw-proof-evolution-v1";

const GOALS = new Set(["origin", "simplify", "explicitize", "elementary", "recombine", "stronger"]);
const EXPLICITNESS = new Set(["existential", "explicit", "effective", "asymptotic"]);
const LEAN_STATUSES = new Set(["formalized_upstream", "not_formalized", "not_separately_formalized"]);
const PROOF_DETAIL_LEVELS = new Set(["lemma", "grouped", "summary", "section"]);
const STEP_KINDS = new Set(["theorem", "lemma", "corollary", "construction", "bound", "assembly", "external"]);
const EDGE_RELATIONS = new Set(["simplifies", "explicitizes", "recombines", "stronger"]);
const LEDGER_STATUSES = new Set(["used", "replaced", "removed", "not_used", "explicit", "existential", "effective"]);

export class ProofEvolutionValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProofEvolutionValidationError";
  }
}

function fail(message) {
  throw new ProofEvolutionValidationError(message);
}

function expectObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function expectString(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`);
  return value;
}

function expectArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}

function expectHttpsUrl(value, label) {
  expectString(value, label);
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${label} must be a valid URL`);
  }
  if (url.protocol !== "https:") fail(`${label} must use https`);
  return value;
}

function expectDate(value, label) {
  expectString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${label} must be YYYY-MM-DD`);
  return value;
}

function expectPositiveInteger(value, label, max = 1000) {
  if (!Number.isInteger(value) || value < 1 || value > max) fail(`${label} must be an integer between 1 and ${max}`);
  return value;
}

function expectEnum(value, allowed, label) {
  if (!allowed.has(value)) fail(`${label} must be one of: ${[...allowed].join(", ")}`);
  return value;
}

function assertAcyclic(steps, versionId) {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) fail(`${versionId}: proof-step cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    const step = byId.get(id);
    for (const dependency of step.dependsOn) {
      if (!byId.has(dependency)) fail(`${versionId}: step ${id} depends on unknown step ${dependency}`);
      if (dependency === id) fail(`${versionId}: step ${id} depends on itself`);
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const step of steps) visit(step.id);
}

export function validateProofEvolution(data) {
  expectObject(data, "proof evolution data");
  if (data.schemaVersion !== PROOF_EVOLUTION_SCHEMA_VERSION) {
    fail(`schemaVersion must be ${PROOF_EVOLUTION_SCHEMA_VERSION}`);
  }
  if (data.status !== "draft") fail('status must be "draft"');
  if (data.reviewStatus !== "unreviewed") fail('reviewStatus must be "unreviewed"');
  expectDate(data.curatedAt, "curatedAt");

  const theorem = expectObject(data.theorem, "theorem");
  expectString(theorem.id, "theorem.id");
  expectString(theorem.title, "theorem.title");
  expectString(theorem.statement, "theorem.statement");
  expectString(theorem.scopeNote, "theorem.scopeNote");
  expectString(theorem.sourceNote, "theorem.sourceNote");

  const tracks = expectArray(data.tracks, "tracks");
  if (tracks.length < 2) fail("tracks must contain at least two tracks");
  const trackIds = new Set();
  for (const [index, track] of tracks.entries()) {
    expectObject(track, `tracks[${index}]`);
    expectString(track.id, `tracks[${index}].id`);
    expectString(track.label, `tracks[${index}].label`);
    expectString(track.description, `tracks[${index}].description`);
    if (trackIds.has(track.id)) fail(`duplicate track id ${track.id}`);
    trackIds.add(track.id);
  }

  const versions = expectArray(data.versions, "versions");
  if (versions.length < 7) fail("versions must contain at least seven entries");
  const versionIds = new Set();
  for (const [index, version] of versions.entries()) {
    const label = `versions[${index}]`;
    expectObject(version, label);
    for (const field of ["id", "label", "title", "method", "field", "aiAssistance", "summary", "changeSummary", "sourceUrl", "sourceLabel"]) {
      expectString(version[field], `${label}.${field}`);
    }
    if (versionIds.has(version.id)) fail(`duplicate version id ${version.id}`);
    versionIds.add(version.id);
    if (!trackIds.has(version.trackId)) fail(`${label}.trackId references unknown track ${version.trackId}`);
    expectDate(version.date, `${label}.date`);
    if (version.releaseDate !== undefined) expectDate(version.releaseDate, `${label}.releaseDate`);
    expectPositiveInteger(version.pages, `${label}.pages`);
    expectEnum(version.goal, GOALS, `${label}.goal`);
    expectEnum(version.explicitConstant, EXPLICITNESS, `${label}.explicitConstant`);
    expectEnum(version.proofDetail, PROOF_DETAIL_LEVELS, `${label}.proofDetail`);
    expectHttpsUrl(version.sourceUrl, `${label}.sourceUrl`);

    const lean = expectObject(version.lean, `${label}.lean`);
    expectEnum(lean.status, LEAN_STATUSES, `${label}.lean.status`);
    expectString(lean.label, `${label}.lean.label`);
    if (lean.url !== null) expectHttpsUrl(lean.url, `${label}.lean.url`);
    expectString(lean.note, `${label}.lean.note`);

    const layout = expectObject(version.layout, `${label}.layout`);
    if (!Number.isFinite(layout.x) || !Number.isFinite(layout.y)) fail(`${label}.layout must contain finite x and y`);
    if (layout.x < 0 || layout.y < 0) fail(`${label}.layout coordinates must be non-negative`);

    const steps = expectArray(version.proofSteps, `${label}.proofSteps`);
    if (steps.length === 0) fail(`${label}.proofSteps must not be empty`);
    const stepIds = new Set();
    for (const [stepIndex, step] of steps.entries()) {
      const stepLabel = `${label}.proofSteps[${stepIndex}]`;
      expectObject(step, stepLabel);
      for (const field of ["id", "label", "detail", "source"]) expectString(step[field], `${stepLabel}.${field}`);
      expectEnum(step.kind, STEP_KINDS, `${stepLabel}.kind`);
      if (stepIds.has(step.id)) fail(`${label}: duplicate proof-step id ${step.id}`);
      stepIds.add(step.id);
      expectArray(step.dependsOn, `${stepLabel}.dependsOn`);
      for (const dependency of step.dependsOn) expectString(dependency, `${stepLabel}.dependsOn entry`);
    }
    assertAcyclic(steps, label);
  }

  const edges = expectArray(data.versionEdges, "versionEdges");
  const edgeKeys = new Set();
  for (const [index, edge] of edges.entries()) {
    const label = `versionEdges[${index}]`;
    expectObject(edge, label);
    expectString(edge.from, `${label}.from`);
    expectString(edge.to, `${label}.to`);
    if (!versionIds.has(edge.from)) fail(`${label}.from references unknown version ${edge.from}`);
    if (!versionIds.has(edge.to)) fail(`${label}.to references unknown version ${edge.to}`);
    if (edge.from === edge.to) fail(`${label} must not be a self-edge`);
    expectEnum(edge.relation, EDGE_RELATIONS, `${label}.relation`);
    expectString(edge.label, `${label}.label`);
    if (edge.secondary !== undefined && typeof edge.secondary !== "boolean") fail(`${label}.secondary must be a boolean`);
    if (edge.visible !== undefined && typeof edge.visible !== "boolean") fail(`${label}.visible must be a boolean`);
    const key = `${edge.from}|${edge.to}|${edge.relation}`;
    if (edgeKeys.has(key)) fail(`duplicate version edge ${key}`);
    edgeKeys.add(key);
  }

  const ledger = expectObject(data.ledger, "ledger");
  const columns = expectArray(ledger.columns, "ledger.columns");
  if (columns.length < 5) fail("ledger.columns must contain at least five versions");
  const columnSet = new Set();
  for (const column of columns) {
    if (!versionIds.has(column)) fail(`ledger.columns references unknown version ${column}`);
    if (columnSet.has(column)) fail(`duplicate ledger column ${column}`);
    columnSet.add(column);
  }
  const ledgerRows = expectArray(ledger.rows, "ledger.rows");
  if (ledgerRows.length === 0) fail("ledger.rows must not be empty");
  const ledgerRowIds = new Set();
  for (const [index, row] of ledgerRows.entries()) {
    const label = `ledger.rows[${index}]`;
    expectObject(row, label);
    expectString(row.id, `${label}.id`);
    expectString(row.label, `${label}.label`);
    if (ledgerRowIds.has(row.id)) fail(`duplicate ledger row id ${row.id}`);
    ledgerRowIds.add(row.id);
    expectObject(row.cells, `${label}.cells`);
    for (const column of columns) {
      expectEnum(row.cells[column], LEDGER_STATUSES, `${label}.cells.${column}`);
    }
    for (const key of Object.keys(row.cells)) {
      if (!columnSet.has(key)) fail(`${label}.cells references unknown column ${key}`);
    }
  }

  const caveats = expectArray(data.caveats, "caveats");
  if (caveats.length === 0) fail("caveats must not be empty");
  for (const [index, caveat] of caveats.entries()) expectString(caveat, `caveats[${index}]`);

  const sources = expectArray(data.sources, "sources");
  if (sources.length === 0) fail("sources must not be empty");
  for (const [index, source] of sources.entries()) {
    const label = `sources[${index}]`;
    expectObject(source, label);
    expectString(source.label, `${label}.label`);
    expectHttpsUrl(source.url, `${label}.url`);
    expectString(source.kind, `${label}.kind`);
  }

  return data;
}
