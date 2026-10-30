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


export const LEAN_STRUCTURE_SCHEMA_VERSION = "pw-lean-structure-v1";

export function validateLeanStructure(data) {
  expectObject(data, "lean structure data");
  if (data.schemaVersion !== LEAN_STRUCTURE_SCHEMA_VERSION) fail(`leanStructure.schemaVersion must be ${LEAN_STRUCTURE_SCHEMA_VERSION}`);
  if (data.status !== "draft") fail('leanStructure.status must be "draft"');
  if (data.reviewStatus !== "unreviewed") fail('leanStructure.reviewStatus must be "unreviewed"');
  expectDate(data.generatedAt, "leanStructure.generatedAt");
  expectString(data.root, "leanStructure.root");
  expectString(data.commit, "leanStructure.commit");
  expectString(data.sourceNote, "leanStructure.sourceNote");

  const summary = expectObject(data.summary, "leanStructure.summary");
  for (const field of ["fetchedModules", "oaiModules", "totalLines", "declarations", "sorry", "axioms", "mathlibImports", "pntImports", "leanImports"]) {
    if (!Number.isInteger(summary[field]) || summary[field] < 0) fail(`leanStructure.summary.${field} must be a non-negative integer`);
  }
  if (summary.fetchedModules < 1) fail("leanStructure.summary.fetchedModules must be positive");
  expectArray(summary.failedModules, "leanStructure.summary.failedModules");
  if (typeof summary.truncated !== "boolean") fail("leanStructure.summary.truncated must be a boolean");

  const subsystems = expectArray(data.subsystems, "leanStructure.subsystems");
  if (subsystems.length === 0) fail("leanStructure.subsystems must not be empty");
  const subsystemIds = new Set();
  let subsystemModuleCount = 0;
  for (const [index, subsystem] of subsystems.entries()) {
    const label = `leanStructure.subsystems[${index}]`;
    expectObject(subsystem, label);
    expectString(subsystem.id, `${label}.id`);
    expectString(subsystem.label, `${label}.label`);
    if (subsystemIds.has(subsystem.id)) fail(`duplicate Lean subsystem id ${subsystem.id}`);
    subsystemIds.add(subsystem.id);
    expectPositiveInteger(subsystem.moduleCount, `${label}.moduleCount`, 1000);
    expectPositiveInteger(subsystem.lines, `${label}.lines`, 1000000);
    if (!Number.isInteger(subsystem.declarations) || subsystem.declarations < 0) fail(`${label}.declarations must be a non-negative integer`);
    expectArray(subsystem.modules, `${label}.modules`);
    if (subsystem.modules.length !== subsystem.moduleCount) fail(`${label}.moduleCount does not match modules.length`);
    subsystemModuleCount += subsystem.moduleCount;
  }
  if (subsystemModuleCount !== summary.oaiModules) fail("Lean subsystem module counts do not sum to summary.oaiModules");

  const modules = expectArray(data.modules, "leanStructure.modules");
  if (modules.length !== summary.oaiModules) fail("leanStructure.modules length does not match summary.oaiModules");
  const moduleIds = new Set();
  for (const [index, module] of modules.entries()) {
    const label = `leanStructure.modules[${index}]`;
    expectObject(module, label);
    expectString(module.id, `${label}.id`);
    if (moduleIds.has(module.id)) fail(`duplicate Lean module id ${module.id}`);
    moduleIds.add(module.id);
    if (!subsystemIds.has(module.subsystem)) fail(`${label}.subsystem references unknown subsystem ${module.subsystem}`);
    expectPositiveInteger(module.lines, `${label}.lines`, 1000000);
    if (!Number.isInteger(module.declarations) || module.declarations < 0) fail(`${label}.declarations must be a non-negative integer`);
    if (!Number.isInteger(module.importsOai) || module.importsOai < 0) fail(`${label}.importsOai must be a non-negative integer`);
    if (!Number.isInteger(module.importsExternal) || module.importsExternal < 0) fail(`${label}.importsExternal must be a non-negative integer`);
    expectHttpsUrl(module.url, `${label}.url`);
  }

  const edges = expectArray(data.subsystemEdges, "leanStructure.subsystemEdges");
  for (const [index, edge] of edges.entries()) {
    const label = `leanStructure.subsystemEdges[${index}]`;
    expectObject(edge, label);
    expectString(edge.from, `${label}.from`);
    expectString(edge.to, `${label}.to`);
    if (!subsystemIds.has(edge.from)) fail(`${label}.from references unknown subsystem ${edge.from}`);
    if (!subsystemIds.has(edge.to)) fail(`${label}.to references unknown subsystem ${edge.to}`);
    expectPositiveInteger(edge.count, `${label}.count`, 1000000);
  }

  const topLevelModules = expectArray(data.topLevelModules, "leanStructure.topLevelModules");
  if (topLevelModules.length === 0) fail("leanStructure.topLevelModules must not be empty");
  for (const [index, id] of topLevelModules.entries()) {
    expectString(id, `leanStructure.topLevelModules[${index}]`);
    if (!moduleIds.has(id)) fail(`leanStructure.topLevelModules references unknown module ${id}`);
  }

  const anchors = expectArray(data.anchors, "leanStructure.anchors");
  if (anchors.length === 0) fail("leanStructure.anchors must not be empty");
  const anchorIds = new Set();
  for (const [index, anchor] of anchors.entries()) {
    const label = `leanStructure.anchors[${index}]`;
    expectObject(anchor, label);
    for (const field of ["id", "declaration", "fullName", "kind", "paperStepId", "role", "note"]) expectString(anchor[field], `${label}.${field}`);
    if (anchorIds.has(anchor.id)) fail(`duplicate Lean anchor id ${anchor.id}`);
    anchorIds.add(anchor.id);
    if (anchor.module !== null) {
      expectString(anchor.module, `${label}.module`);
      if (!moduleIds.has(anchor.module)) fail(`${label}.module references unknown module ${anchor.module}`);
    }
    if (anchor.line !== null && (!Number.isInteger(anchor.line) || anchor.line < 1)) fail(`${label}.line must be a positive integer or null`);
    if (anchor.url !== null) expectHttpsUrl(anchor.url, `${label}.url`);
  }

  const alignments = expectArray(data.paperAlignments, "leanStructure.paperAlignments");
  if (alignments.length === 0) fail("leanStructure.paperAlignments must not be empty");
  for (const [index, alignment] of alignments.entries()) {
    const label = `leanStructure.paperAlignments[${index}]`;
    expectObject(alignment, label);
    expectString(alignment.versionId, `${label}.versionId`);
    expectString(alignment.stepId, `${label}.stepId`);
    expectEnum(alignment.confidence, new Set(["source-anchored", "inferred"]), `${label}.confidence`);
    expectString(alignment.note, `${label}.note`);
    expectArray(alignment.subsystems, `${label}.subsystems`);
    for (const subsystem of alignment.subsystems) {
      if (!subsystemIds.has(subsystem)) fail(`${label}.subsystems references unknown subsystem ${subsystem}`);
    }
    expectArray(alignment.modules, `${label}.modules`);
    for (const moduleId of alignment.modules) {
      if (moduleId !== null && !moduleIds.has(moduleId)) fail(`${label}.modules references unknown module ${moduleId}`);
    }
    expectArray(alignment.anchors, `${label}.anchors`);
    for (const anchorId of alignment.anchors) {
      if (!anchorIds.has(anchorId)) fail(`${label}.anchors references unknown anchor ${anchorId}`);
    }
  }

  const external = expectObject(data.externalImports, "leanStructure.externalImports");
  if (!Number.isInteger(external.mathlibCount) || external.mathlibCount < 0) fail("leanStructure.externalImports.mathlibCount must be non-negative");
  expectArray(external.mathlibPrefixes, "leanStructure.externalImports.mathlibPrefixes");
  for (const [index, prefix] of external.mathlibPrefixes.entries()) {
    const label = `leanStructure.externalImports.mathlibPrefixes[${index}]`;
    expectObject(prefix, label);
    expectString(prefix.prefix, `${label}.prefix`);
    expectPositiveInteger(prefix.count, `${label}.count`, 1000000);
  }
  for (const field of ["pnt", "lean"]) {
    expectArray(external[field], `leanStructure.externalImports.${field}`);
    for (const [index, value] of external[field].entries()) expectString(value, `leanStructure.externalImports.${field}[${index}]`);
  }

  expectString(data.formalizedVersionId, "leanStructure.formalizedVersionId");
  const caveats = expectArray(data.caveats, "leanStructure.caveats");
  if (caveats.length === 0) fail("leanStructure.caveats must not be empty");
  for (const [index, caveat] of caveats.entries()) expectString(caveat, `leanStructure.caveats[${index}]`);

  return data;
}

export const ARGUMENT_MAP_SCHEMA_VERSION = "pw-argument-map-v1";

export function validateArgumentMap(data, proofData) {
  expectObject(data, "argument map data");
  expectObject(proofData, "proof data for argument map");
  if (data.schemaVersion !== ARGUMENT_MAP_SCHEMA_VERSION) fail(`argumentMap.schemaVersion must be ${ARGUMENT_MAP_SCHEMA_VERSION}`);
  if (data.status !== "draft") fail('argumentMap.status must be "draft"');
  if (data.reviewStatus !== "unreviewed") fail('argumentMap.reviewStatus must be "unreviewed"');

  const result = expectObject(data.result, "argumentMap.result");
  for (const field of ["id", "label", "statement", "source"]) expectString(result[field], `argumentMap.result.${field}`);

  const roles = expectArray(data.roles, "argumentMap.roles");
  if (roles.length === 0) fail("argumentMap.roles must not be empty");
  const roleIds = new Set();
  for (const [index, role] of roles.entries()) {
    const label = `argumentMap.roles[${index}]`;
    expectObject(role, label);
    expectString(role.id, `${label}.id`);
    expectString(role.label, `${label}.label`);
    expectString(role.description, `${label}.description`);
    if (roleIds.has(role.id)) fail(`duplicate argument-map role ${role.id}`);
    roleIds.add(role.id);
  }

  const proofVersions = expectArray(proofData.versions, "proofData.versions");
  const proofByVersion = new Map(proofVersions.map((version) => [version.id, version]));
  const strategies = expectArray(data.strategies, "argumentMap.strategies");
  if (strategies.length < 2) fail("argumentMap.strategies must contain at least two strategies");
  const strategyIds = new Set();
  for (const [index, strategy] of strategies.entries()) {
    const label = `argumentMap.strategies[${index}]`;
    expectObject(strategy, label);
    expectString(strategy.versionId, `${label}.versionId`);
    if (!proofByVersion.has(strategy.versionId)) fail(`${label}.versionId references unknown proof version ${strategy.versionId}`);
    if (strategyIds.has(strategy.versionId)) fail(`duplicate argument-map strategy ${strategy.versionId}`);
    strategyIds.add(strategy.versionId);
    expectString(strategy.color, `${label}.color`);
    if (!/^#[0-9a-f]{6}$/i.test(strategy.color)) fail(`${label}.color must be a six-digit hex color`);
    expectEnum(strategy.track, new Set(["same-theorem", "stronger-theorem"]), `${label}.track`);
    expectString(strategy.note, `${label}.note`);
  }

  const validNodeIds = new Set();
  for (const strategy of strategies) {
    const version = proofByVersion.get(strategy.versionId);
    for (const step of version.proofSteps) validNodeIds.add(`${strategy.versionId}:${step.id}`);
  }
  const extraNodes = expectArray(data.extraNodes, "argumentMap.extraNodes");
  for (const [index, node] of extraNodes.entries()) {
    const label = `argumentMap.extraNodes[${index}]`;
    expectObject(node, label);
    for (const field of ["id", "versionId", "role", "label", "kind", "source", "statement"]) expectString(node[field], `${label}.${field}`);
    if (!strategyIds.has(node.versionId)) fail(`${label}.versionId references unknown strategy ${node.versionId}`);
    if (!roleIds.has(node.role)) fail(`${label}.role references unknown role ${node.role}`);
    if (validNodeIds.has(node.id)) fail(`duplicate argument-map node id ${node.id}`);
    validNodeIds.add(node.id);
  }
  validNodeIds.add(result.id);

  const nodeRoles = expectObject(data.nodeRoles, "argumentMap.nodeRoles");
  for (const strategy of strategies) {
    const version = proofByVersion.get(strategy.versionId);
    const map = expectObject(nodeRoles[strategy.versionId], `argumentMap.nodeRoles.${strategy.versionId}`);
    const stepIds = new Set(version.proofSteps.map((step) => step.id));
    for (const [stepId, role] of Object.entries(map)) {
      if (!stepIds.has(stepId)) fail(`argumentMap.nodeRoles.${strategy.versionId} references unknown step ${stepId}`);
      if (!roleIds.has(role)) fail(`argumentMap.nodeRoles.${strategy.versionId}.${stepId} references unknown role ${role}`);
    }
    for (const step of version.proofSteps) {
      if (!map[step.id]) fail(`argumentMap.nodeRoles.${strategy.versionId} is missing role for step ${step.id}`);
    }
    const hasResult = Object.values(map).includes("result") || extraNodes.some((node) => node.versionId === strategy.versionId && node.role === "result");
    if (!hasResult) fail(`argument map strategy ${strategy.versionId} has no result-role node`);
  }

  const finalEdges = expectArray(data.finalEdges, "argumentMap.finalEdges");
  if (finalEdges.length === 0) fail("argumentMap.finalEdges must not be empty");
  for (const [index, edge] of finalEdges.entries()) {
    const label = `argumentMap.finalEdges[${index}]`;
    expectObject(edge, label);
    expectString(edge.from, `${label}.from`);
    expectString(edge.to, `${label}.to`);
    if (!validNodeIds.has(edge.from)) fail(`${label}.from references unknown node ${edge.from}`);
    if (!validNodeIds.has(edge.to)) fail(`${label}.to references unknown node ${edge.to}`);
    expectEnum(edge.type, new Set(["depends", "proves", "implies"]), `${label}.type`);
    expectString(edge.label, `${label}.label`);
    if (edge.from === edge.to) fail(`${label} must not be a self-edge`);
  }
  if (!finalEdges.some((edge) => edge.to === result.id)) fail("argumentMap.finalEdges must contain an edge to the shared result");

  const crossEdges = expectArray(data.crossEdges, "argumentMap.crossEdges");
  if (crossEdges.length === 0) fail("argumentMap.crossEdges must not be empty");
  for (const [index, edge] of crossEdges.entries()) {
    const label = `argumentMap.crossEdges[${index}]`;
    expectObject(edge, label);
    expectString(edge.from, `${label}.from`);
    expectString(edge.to, `${label}.to`);
    if (!validNodeIds.has(edge.from)) fail(`${label}.from references unknown node ${edge.from}`);
    if (!validNodeIds.has(edge.to)) fail(`${label}.to references unknown node ${edge.to}`);
    if (edge.from === edge.to) fail(`${label} must not be a self-edge`);
    expectEnum(edge.type, new Set(["same-role", "replaces", "bypasses"]), `${label}.type`);
    expectString(edge.label, `${label}.label`);
    if (edge.note !== undefined) expectString(edge.note, `${label}.note`);
    if (edge.directed !== undefined && typeof edge.directed !== "boolean") fail(`${label}.directed must be a boolean`);
  }

  const comparisons = expectArray(data.comparisons, "argumentMap.comparisons");
  const comparisonKeys = new Set();
  for (const [index, comparison] of comparisons.entries()) {
    const label = `argumentMap.comparisons[${index}]`;
    expectObject(comparison, label);
    expectString(comparison.a, `${label}.a`);
    expectString(comparison.b, `${label}.b`);
    if (!strategyIds.has(comparison.a) || !strategyIds.has(comparison.b)) fail(`${label} references unknown strategy`);
    if (comparison.a === comparison.b) fail(`${label} compares a strategy with itself`);
    const key = [comparison.a, comparison.b].sort().join("|");
    if (comparisonKeys.has(key)) fail(`duplicate argument-map comparison ${key}`);
    comparisonKeys.add(key);
    expectString(comparison.summary, `${label}.summary`);
    for (const field of ["sharedRoles", "uniqueARoles", "uniqueBRoles"]) {
      expectArray(comparison[field], `${label}.${field}`);
      for (const role of comparison[field]) {
        if (!roleIds.has(role)) fail(`${label}.${field} references unknown role ${role}`);
      }
    }
  }

  for (const field of ["sharedInputs", "caveats"]) {
    const entries = expectArray(data[field], `argumentMap.${field}`);
    if (entries.length === 0) fail(`argumentMap.${field} must not be empty`);
    for (const [index, entry] of entries.entries()) expectString(entry, `argumentMap.${field}[${index}]`);
  }

  return data;
}
