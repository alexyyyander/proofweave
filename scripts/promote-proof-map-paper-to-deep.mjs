#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { validateDeepProofMap } from "../packages/domain/deep-proof-map.mjs";
import { publicationPlainText } from "../packages/domain/proof-map-index.mjs";

/**
 * Promote paper-derived structures to theorem-level maps by classifying every
 * recorded reference against the sentence it appears in. References that are
 * explicitly background ("cf.", "recall", "as in", ...) are dropped; the rest
 * remain as dependency edges. The result is a curated-structure candidate and
 * is still unreviewed.
 */
const root = new URL("../", import.meta.url);
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const load = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
const catalog = await load("data/publications/openai-math.json");
const lean = await load("data/proof-maps/lean-coverage.json");
const manifestPath = fileURLToPath(new URL("data/proof-maps/manifest.json", root));
const deepDir = fileURLToPath(new URL("data/proof-maps/deep", root));
const dryRun = args.includes("--dry-run");
const only = option("--family", null);

const backgroundPattern = /(cf\.|see also|compare|recall|as discussed|mentioned|independent of|does not (?:use|depend)|apart from|analogous|similarly|\bas in\b|in the same way)/i;
const colors = ["#8b75c9", "#5c8fd6", "#c98b5c", "#5cc9a0", "#b07cc6"];

function slug(value, max = 60) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max);
}

function uniqueId(base, used) {
  const normalized = /^[a-z0-9]/.test(base) ? base : `n-${base}`;
  if (!used.has(normalized)) {
    used.add(normalized);
    return normalized;
  }
  let index = 2;
  while (used.has(`${normalized}-${index}`)) index += 1;
  used.add(`${normalized}-${index}`);
  return `${normalized}-${index}`;
}

/** Remove back-edges so the dependency graph stays acyclic. */
function acyclic(nodes, dependencies) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const kept = new Map();
  for (const node of nodes) kept.set(node.id, []);
  const reaches = (from, target, seen = new Set()) => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (kept.get(from) ?? []).some((next) => reaches(next, target, seen));
  };
  let dropped = 0;
  for (const [to, froms] of dependencies) {
    for (const from of froms) {
      if (!byId.has(from) || !byId.has(to)) continue;
      // `from` is cited by the proof of `to`; the edge is from -> to.
      if (reaches(from, to)) {
        dropped += 1;
        continue;
      }
      kept.get(to).push(from);
    }
  }
  return { dependencies: kept, dropped };
}

function buildDeep(structure, family) {
  const nodes = structure.nodes;
  const strategies = [];
  let droppedBackground = 0;
  let droppedUnclear = 0;
  for (const manuscript of structure.manuscripts) {
    const manuscriptNodes = nodes.filter((node) => node.manuscript === manuscript.title);
    if (manuscriptNodes.length === 0) continue;
    const ids = new Set(manuscriptNodes.map((node) => node.id));
    const dependencies = new Map(manuscriptNodes.map((node) => [node.id, []]));
    const seen = new Set();
    for (const edge of structure.edges) {
      if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
      if (!edge.context) {
        droppedUnclear += 1;
        continue;
      }
      if (backgroundPattern.test(edge.context)) {
        droppedBackground += 1;
        continue;
      }
      const key = `${edge.from}|${edge.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dependencies.get(edge.to).push(edge.from);
    }
    strategies.push({ manuscript, nodes: manuscriptNodes, dependencies });
  }
  if (strategies.length === 0) return { error: "no strategies" };

  const usedRoleIds = new Set(["result"]);
  const rolesById = new Map();
  const resultRole = { id: "result", label: "Result", description: "The paper's main stated theorem for this family." };
  rolesById.set(resultRole.id, resultRole);
  const roleForSection = (section) => {
    const base = slug(section || "document");
    const id = uniqueId(base, usedRoleIds);
    if (!rolesById.has(id)) rolesById.set(id, { id, label: section || "Document", description: "A section of the paper." });
    return id;
  };

  const finalEdges = [];
  const strategiesOut = [];
  for (const [index, strategy] of strategies.entries()) {
    const strategyId = `m${index + 1}`;
    const main = strategy.nodes.find((node) => node.kind === "theorem") ?? strategy.nodes[strategy.nodes.length - 1];
    const { dependencies, dropped } = acyclic(strategy.nodes, strategy.dependencies);
    const strategyNodes = strategy.nodes.map((node) => ({
      id: node.id,
      role: node.id === main.id ? "result" : roleForSection(node.section),
      label: node.label.slice(0, 180),
      fullLabel: node.label,
      kind: node.kind,
      source: node.section ?? strategy.manuscript.title,
      detail: node.statement || node.label,
      dependsOn: dependencies.get(node.id) ?? [],
    }));
    strategiesOut.push({
      id: strategyId,
      label: strategy.manuscript.title.slice(0, 160),
      title: strategy.manuscript.title,
      authors: ["OpenAI"],
      date: strategy.manuscript.date,
      pages: 0,
      color: colors[index % colors.length],
      sourceUrl: strategy.manuscript.pdfUrl,
      sourceLabel: "paper",
      note: `Statements and proof references extracted from ${strategy.manuscript.title}; background citations removed.`,
      proofDetail: "section",
      nodes: strategyNodes,
    });
    finalEdges.push({ from: `${strategyId}:${main.id}`, to: "paper-result", type: "proves", label: "states the result" });
    strategy.dropped = dropped;
  }

  const data = {
    schemaVersion: "pw-deep-proof-map-v1",
    status: "deep",
    reviewStatus: "unreviewed",
    curatedAt: new Date().toISOString().slice(0, 10),
    familyNumber: structure.familyNumber,
    title: structure.familyTitle,
    result: {
      id: "paper-result",
      label: structure.familyTitle,
      statement: family.claim ? publicationPlainText(family.claim) : structure.familyTitle,
      source: "OpenAI mathematics release",
      roleNote: "The family's stated result in the release.",
    },
    roles: [...rolesById.values()],
    strategies: strategiesOut,
    finalEdges,
    crossEdges: [],
    comparisons: [],
    sharedInputs: [],
    relatedManuscripts: [],
    leanAlignments: [],
    caveats: [
      "Machine-promoted from the paper structure: statements and proof references are extracted from the pinned LaTeX, and explicit background citations are removed.",
      "A reference is not an audited proof dependency; the paper remains authoritative and this map is unreviewed.",
    ],
    sources: structure.manuscripts.map((manuscript) => ({ label: manuscript.title, url: manuscript.pdfUrl, kind: "paper" })),
  };
  return { data, droppedBackground, droppedUnclear, droppedCycles: strategies.reduce((total, strategy) => total + (strategy.dropped ?? 0), 0) };
}

const deepFiles = new Set((await readdir(deepDir)).filter((name) => name.endsWith(".json")).map((name) => name.replace(/\.json$/, "")));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const existing = new Set(manifest.deep.map((entry) => entry.familyNumber));
const paperFiles = (await readdir(fileURLToPath(new URL("data/proof-maps/paper", root)))).filter((name) => name.endsWith(".json"));
const results = [];

for (const name of paperFiles) {
  const structure = JSON.parse(await readFile(fileURLToPath(new URL(`data/proof-maps/paper/${name}`, root)), "utf8"));
  if (only && structure.familyNumber !== only) continue;
  if (existing.has(structure.familyNumber)) continue;
  if (deepFiles.has(structure.familyNumber)) continue;
  const family = catalog.families.find((candidate) => candidate.number === structure.familyNumber);
  const built = buildDeep(structure, family);
  if (built.error) {
    results.push({ familyNumber: structure.familyNumber, outcome: "skipped", reason: built.error });
    continue;
  }
  try {
    validateDeepProofMap(built.data, catalog, lean);
  } catch (error) {
    results.push({ familyNumber: structure.familyNumber, outcome: "skipped", reason: error instanceof Error ? error.message : String(error) });
    continue;
  }
  results.push({
    familyNumber: structure.familyNumber,
    outcome: "promoted",
    strategies: built.data.strategies.length,
    nodes: built.data.strategies.reduce((total, strategy) => total + strategy.nodes.length, 0),
    edges: built.data.strategies.reduce((total, strategy) => total + strategy.nodes.reduce((sum, node) => sum + node.dependsOn.length, 0), 0),
    droppedBackground: built.droppedBackground,
    droppedUnclear: built.droppedUnclear,
    droppedCycles: built.droppedCycles,
    data: built.data,
  });
}

const promoted = results.filter((entry) => entry.outcome === "promoted");
if (!dryRun) {
  for (const entry of promoted) {
    await writeFile(fileURLToPath(new URL(`data/proof-maps/deep/${entry.familyNumber}.json`, root)), `${JSON.stringify(entry.data, null, 2)}\n`);
    if (!existing.has(entry.familyNumber)) {
      manifest.deep.push({
        familyNumber: entry.familyNumber,
        route: `/proof-evolution/openai-math/${entry.familyNumber}`,
        label: entry.data.title,
      });
    }
  }
  manifest.deep.sort((left, right) => left.familyNumber.localeCompare(right.familyNumber));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
for (const entry of results) delete entry.data;
process.stdout.write(`${JSON.stringify({
  families: results.length,
  promoted: promoted.length,
  skipped: results.filter((entry) => entry.outcome === "skipped").length,
  nodes: promoted.reduce((total, entry) => total + entry.nodes, 0),
  edges: promoted.reduce((total, entry) => total + entry.edges, 0),
  droppedBackground: promoted.reduce((total, entry) => total + entry.droppedBackground, 0),
  droppedUnclear: promoted.reduce((total, entry) => total + entry.droppedUnclear, 0),
  droppedCycles: promoted.reduce((total, entry) => total + entry.droppedCycles, 0),
  skippedSample: results.filter((entry) => entry.outcome === "skipped").slice(0, 8),
}, null, 2)}\n`);
