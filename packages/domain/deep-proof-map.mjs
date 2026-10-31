export const DEEP_PROOF_MAP_SCHEMA_VERSION = "pw-deep-proof-map-v1";

const STEP_KINDS = new Set(["theorem", "lemma", "corollary", "construction", "bound", "assembly", "external"]);
const PROOF_DETAIL_LEVELS = new Set(["lemma", "grouped", "summary", "section"]);
const LEAN_STATUSES = new Set(["formalized_upstream", "not_formalized", "not_separately_formalized"]);
const EDGE_TYPES = new Set(["proves", "implies", "same-role", "replaces", "bypasses"]);
const CONFIDENCES = new Set(["source-anchored", "inferred"]);

function fail(message) {
  throw new Error(`Deep proof map: ${message}`);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function expectObject(value, label) {
  if (!isObject(value)) fail(`${label} must be an object`);
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

function expectHttps(value, label) {
  expectString(value, label);
  if (!/^https:\/\//.test(value)) fail(`${label} must be an https URL`);
  return value;
}

function expectDate(value, label) {
  expectString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${label} must be YYYY-MM-DD`);
  return value;
}

function expectEnum(value, allowed, label) {
  if (!allowed.has(value)) fail(`${label} must be one of: ${[...allowed].join(", ")}`);
  return value;
}

function expectId(value, label) {
  expectString(value, label);
  if (!/^[a-z0-9-]+$/.test(value)) fail(`${label} must contain only lowercase letters, digits, and hyphens`);
  return value;
}

function qualified(strategyId, nodeId) {
  return `${strategyId}:${nodeId}`;
}

function assertAcyclic(nodes, strategyId) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) fail(`${strategyId}: dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    const node = byId.get(id);
    for (const dependency of node.dependsOn) {
      if (!byId.has(dependency)) fail(`${strategyId}: node ${id} depends on unknown node ${dependency}`);
      if (dependency === id) fail(`${strategyId}: node ${id} depends on itself`);
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of nodes) visit(node.id);
}

/**
 * Validate one curated deep proof map. The collection and optional Lean coverage
 * are used to reject family numbers and Lean alignments that are not source-backed.
 * @param {any} data
 * @param {any} collection
 * @param {any} [leanCoverage]
 * @returns {any}
 */
export function validateDeepProofMap(data, collection, leanCoverage = null) {
  expectObject(data, "deep proof map");
  if (data.schemaVersion !== DEEP_PROOF_MAP_SCHEMA_VERSION) fail(`schemaVersion must be ${DEEP_PROOF_MAP_SCHEMA_VERSION}`);
  if (data.status !== "deep") fail('status must be "deep"');
  if (data.reviewStatus !== "unreviewed") fail('reviewStatus must be "unreviewed"');
  expectDate(data.curatedAt, "curatedAt");
  expectString(data.familyNumber, "familyNumber");
  if (!/^\d{3}$/.test(data.familyNumber)) fail("familyNumber must be three digits");
  expectString(data.title, "title");
  if (!isObject(collection) || !Array.isArray(collection.families)) fail("collection must contain families");
  const family = collection.families.find((candidate) => candidate.number === data.familyNumber);
  if (!family) fail(`familyNumber references unknown family ${data.familyNumber}`);

  const result = expectObject(data.result, "result");
  expectString(result.id, "result.id");
  expectString(result.label, "result.label");
  expectString(result.statement, "result.statement");
  expectString(result.source, "result.source");
  if (result.detail !== undefined) expectString(result.detail, "result.detail");
  if (result.roleNote !== undefined) expectString(result.roleNote, "result.roleNote");

  const roles = expectArray(data.roles, "roles");
  if (roles.length === 0) fail("roles must not be empty");
  const roleIds = new Set();
  for (const [index, role] of roles.entries()) {
    const label = `roles[${index}]`;
    expectObject(role, label);
    expectId(role.id, `${label}.id`);
    expectString(role.label, `${label}.label`);
    expectString(role.description, `${label}.description`);
    if (roleIds.has(role.id)) fail(`duplicate role ${role.id}`);
    roleIds.add(role.id);
  }

  const strategies = expectArray(data.strategies, "strategies");
  if (strategies.length === 0) fail("strategies must not be empty");
  const strategyIds = new Set();
  const nodeByQualifiedId = new Map();
  const resultNodesByStrategy = new Map();
  for (const [index, strategy] of strategies.entries()) {
    const label = `strategies[${index}]`;
    expectObject(strategy, label);
    expectId(strategy.id, `${label}.id`);
    if (strategyIds.has(strategy.id)) fail(`duplicate strategy ${strategy.id}`);
    strategyIds.add(strategy.id);
    for (const field of ["label", "title", "sourceUrl", "sourceLabel", "note"]) expectString(strategy[field], `${label}.${field}`);
    expectHttps(strategy.sourceUrl, `${label}.sourceUrl`);
    if (!Array.isArray(strategy.authors) || strategy.authors.length === 0) fail(`${label}.authors must not be empty`);
    for (const author of strategy.authors) expectString(author, `${label}.authors entry`);
    expectDate(strategy.date, `${label}.date`);
    if (!Number.isInteger(strategy.pages) || strategy.pages < 1 || strategy.pages > 1000) fail(`${label}.pages must be an integer between 1 and 1000`);
    if (typeof strategy.color !== "string" || !/^#[0-9a-f]{6}$/i.test(strategy.color)) fail(`${label}.color must be a six-digit hex color`);
    expectEnum(strategy.proofDetail, PROOF_DETAIL_LEVELS, `${label}.proofDetail`);
    if (strategy.leanStatus !== undefined) expectEnum(strategy.leanStatus, LEAN_STATUSES, `${label}.leanStatus`);
    if (strategy.leanLabel !== undefined) expectString(strategy.leanLabel, `${label}.leanLabel`);
    if (strategy.leanUrl !== undefined && strategy.leanUrl !== null) expectHttps(strategy.leanUrl, `${label}.leanUrl`);
    if (strategy.leanNote !== undefined) expectString(strategy.leanNote, `${label}.leanNote`);

    const nodes = expectArray(strategy.nodes, `${label}.nodes`);
    if (nodes.length === 0) fail(`${label}.nodes must not be empty`);
    const nodeIds = new Set();
    let resultNodeCount = 0;
    for (const [nodeIndex, node] of nodes.entries()) {
      const nodeLabel = `${label}.nodes[${nodeIndex}]`;
      expectObject(node, nodeLabel);
      expectId(node.id, `${nodeLabel}.id`);
      if (nodeIds.has(node.id)) fail(`${label}: duplicate node ${node.id}`);
      nodeIds.add(node.id);
      if (!roleIds.has(node.role)) fail(`${nodeLabel}.role references unknown role ${node.role}`);
      for (const field of ["label", "fullLabel", "source", "detail"]) expectString(node[field], `${nodeLabel}.${field}`);
      expectEnum(node.kind, STEP_KINDS, `${nodeLabel}.kind`);
      expectArray(node.dependsOn, `${nodeLabel}.dependsOn`);
      for (const dependency of node.dependsOn) expectId(dependency, `${nodeLabel}.dependsOn entry`);
      if (node.role === "result") resultNodeCount += 1;
      const fullId = qualified(strategy.id, node.id);
      if (nodeByQualifiedId.has(fullId)) fail(`duplicate qualified node id ${fullId}`);
      nodeByQualifiedId.set(fullId, { strategyId: strategy.id, node });
    }
    if (resultNodeCount === 0) fail(`${label} must contain at least one node with role "result"`);
    resultNodesByStrategy.set(strategy.id, resultNodeCount);
    assertAcyclic(nodes, strategy.id);
  }

  const finalEdges = expectArray(data.finalEdges, "finalEdges");
  if (finalEdges.length === 0) fail("finalEdges must not be empty");
  const strategiesWithFinalEdge = new Set();
  const finalEdgeKeys = new Set();
  for (const [index, edge] of finalEdges.entries()) {
    const label = `finalEdges[${index}]`;
    expectObject(edge, label);
    expectString(edge.from, `${label}.from`);
    expectString(edge.to, `${label}.to`);
    if (!nodeByQualifiedId.has(edge.from)) fail(`${label}.from references unknown node ${edge.from}`);
    if (edge.to !== result.id) fail(`${label}.to must reference the shared result ${result.id}`);
    if (edge.from === edge.to) fail(`${label} must not be a self-edge`);
    expectEnum(edge.type, EDGE_TYPES, `${label}.type`);
    expectString(edge.label, `${label}.label`);
    const strategyId = nodeByQualifiedId.get(edge.from).strategyId;
    strategiesWithFinalEdge.add(strategyId);
    const key = `${edge.from}|${edge.to}|${edge.type}`;
    if (finalEdgeKeys.has(key)) fail(`duplicate final edge ${key}`);
    finalEdgeKeys.add(key);
  }
  for (const strategyId of strategyIds) {
    if (!strategiesWithFinalEdge.has(strategyId)) fail(`strategy ${strategyId} has no final edge to the shared result`);
  }

  const crossEdges = Array.isArray(data.crossEdges) ? data.crossEdges : fail("crossEdges must be an array");
  const crossKeys = new Set();
  for (const [index, edge] of crossEdges.entries()) {
    const label = `crossEdges[${index}]`;
    expectObject(edge, label);
    expectString(edge.from, `${label}.from`);
    expectString(edge.to, `${label}.to`);
    const from = nodeByQualifiedId.get(edge.from);
    const to = nodeByQualifiedId.get(edge.to);
    if (!from) fail(`${label}.from references unknown node ${edge.from}`);
    if (!to) fail(`${label}.to references unknown node ${edge.to}`);
    if (from.strategyId === to.strategyId) fail(`${label} must connect two different strategies`);
    expectEnum(edge.type, new Set(["same-role", "replaces", "bypasses"]), `${label}.type`);
    expectString(edge.label, `${label}.label`);
    if (edge.note !== undefined) expectString(edge.note, `${label}.note`);
    if (edge.directed !== undefined && typeof edge.directed !== "boolean") fail(`${label}.directed must be a boolean`);
    const key = `${edge.from}|${edge.to}|${edge.type}`;
    if (crossKeys.has(key)) fail(`duplicate cross edge ${key}`);
    crossKeys.add(key);
  }

  const comparisons = Array.isArray(data.comparisons) ? data.comparisons : fail("comparisons must be an array");
  const comparisonPairs = new Set();
  for (const [index, comparison] of comparisons.entries()) {
    const label = `comparisons[${index}]`;
    expectObject(comparison, label);
    expectString(comparison.a, `${label}.a`);
    expectString(comparison.b, `${label}.b`);
    if (!strategyIds.has(comparison.a)) fail(`${label}.a references unknown strategy ${comparison.a}`);
    if (!strategyIds.has(comparison.b)) fail(`${label}.b references unknown strategy ${comparison.b}`);
    if (comparison.a === comparison.b) fail(`${label} must compare two different strategies`);
    expectString(comparison.summary, `${label}.summary`);
    for (const field of ["sharedRoles", "uniqueARoles", "uniqueBRoles"]) {
      expectArray(comparison[field], `${label}.${field}`);
      for (const role of comparison[field]) if (!roleIds.has(role)) fail(`${label}.${field} references unknown role ${role}`);
    }
    const key = [comparison.a, comparison.b].sort().join("|");
    if (comparisonPairs.has(key)) fail(`duplicate comparison ${key}`);
    comparisonPairs.add(key);
  }

  const sharedInputs = expectArray(data.sharedInputs, "sharedInputs");
  for (const [index, input] of sharedInputs.entries()) expectString(input, `sharedInputs[${index}]`);
  if (data.summaryNote !== undefined) expectString(data.summaryNote, "summaryNote");

  const related = expectArray(data.relatedManuscripts, "relatedManuscripts");
  for (const [index, manuscript] of related.entries()) {
    const label = `relatedManuscripts[${index}]`;
    expectObject(manuscript, label);
    for (const field of ["title", "date", "pdfUrl", "readmeUrl", "relation", "note"]) expectString(manuscript[field], `${label}.${field}`);
    expectDate(manuscript.date, `${label}.date`);
    expectHttps(manuscript.pdfUrl, `${label}.pdfUrl`);
    expectHttps(manuscript.readmeUrl, `${label}.readmeUrl`);
    if (!Array.isArray(manuscript.authors) || manuscript.authors.length === 0) fail(`${label}.authors must not be empty`);
    for (const author of manuscript.authors) expectString(author, `${label}.authors entry`);
  }

  const leanFamily = leanCoverage?.families?.find((candidate) => candidate.familyNumber === data.familyNumber);
  const alignments = expectArray(data.leanAlignments, "leanAlignments");
  const alignmentKeys = new Set();
  for (const [index, alignment] of alignments.entries()) {
    const label = `leanAlignments[${index}]`;
    expectObject(alignment, label);
    expectString(alignment.strategyId, `${label}.strategyId`);
    expectString(alignment.nodeId, `${label}.nodeId`);
    const strategyId = alignment.strategyId;
    const node = nodeByQualifiedId.get(qualified(strategyId, alignment.nodeId));
    if (!node) fail(`${label} references unknown node ${strategyId}:${alignment.nodeId}`);
    if (!Array.isArray(alignment.theoremNames) || alignment.theoremNames.length === 0) fail(`${label}.theoremNames must not be empty`);
    for (const theorem of alignment.theoremNames) expectString(theorem, `${label}.theoremNames entry`);
    expectString(alignment.solutionModule, `${label}.solutionModule`);
    expectHttps(alignment.solutionUrl, `${label}.solutionUrl`);
    expectEnum(alignment.confidence, CONFIDENCES, `${label}.confidence`);
    expectString(alignment.note, `${label}.note`);
    const key = `${strategyId}:${alignment.nodeId}|${alignment.solutionModule}`;
    if (alignmentKeys.has(key)) fail(`duplicate Lean alignment ${key}`);
    alignmentKeys.add(key);

    if (leanCoverage) {
      if (!leanFamily) fail(`${label} has no comparator family ${data.familyNumber} in the Lean coverage`);
      const comparator = leanFamily.comparators.find((candidate) => candidate.solutionModule === alignment.solutionModule);
      if (!comparator) fail(`${label}.solutionModule is not present in the Lean coverage for ${data.familyNumber}`);
      for (const theorem of alignment.theoremNames) {
        if (!comparator.theoremNames.includes(theorem)) fail(`${label}.theoremName ${theorem} is not present in comparator ${comparator.label}`);
      }
      if (comparator.solutionUrl !== alignment.solutionUrl) fail(`${label}.solutionUrl does not match the comparator solution URL`);
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
    expectHttps(source.url, `${label}.url`);
    expectString(source.kind, `${label}.kind`);
  }

  return data;
}
