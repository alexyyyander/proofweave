#!/usr/bin/env node
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { validateDeepProofMap } from "../packages/domain/deep-proof-map.mjs";
import { publicationPlainText } from "../packages/domain/proof-map-index.mjs";

/**
 * Promote paper-derived structures to theorem-level maps, keeping only the
 * references that the surrounding sentence presents as a premise: a dependency
 * cue immediately before the reference ("by Lemma X") or a dependency verb
 * immediately after it ("Lemma X gives ..."). Background citations and bare
 * mentions stay out of the graph. The result is still unreviewed.
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
const machineMarker = "Machine-promoted from the paper structure";

const backgroundPattern = /(cf\.|see also|compare|recall|as discussed|mentioned|independent of|does not (?:use|depend)|apart from|analogous|similarly|\bas in\b|in the same way)/i;
const identificationPattern = /(?:\bthe case of[^.;]{0,60}\bis\b|\bthe remaining assertions are\b|\bthe other (?:case )?is\b|\bthe (?:vanishing |first |second )?alternative is\b|\bis\s+(?:Lemma|Proposition|Theorem|Corollary))\s*~?\s*$/i;
const objectPattern = /(?:\b(?:the|a|an|its|their|this|these|those|such)\s+[^.;]{0,90}(?:of|in|from)\s+(?:the\s+)?(?:proof of\s+)?(?:Lemma|Proposition|Theorem|Corollary)|\b(?:constructed|defined|introduced|proved|stated|obtained|given|established|produced|described|used)\s+in\s+(?:the\s+)?(?:proof of\s+)?(?:Lemma|Proposition|Theorem|Corollary))\s*~?\s*$/i;
const listContinuation = /(?:and|,|&)\s*~?\s*$/;
const listReference = /(?:Lemmas?|Propositions?|Theorems?|Corollary|Corollaries)\s*~?\s*\\(?:c|C|auto)?ref\{[^}]+\}/;
const passiveDependency = /^\s*(?:\([^)]{0,24}\))?\s*(?:is|are|was|were)\s+(?:used|applied|cited|invoked|required|needed|employed|quoted|recalled)\b/i;
const beforeDependency = /(?:by|using|via|from|apply|applying|through|thanks to|in view of|as a consequence of|consequence of|combining|combine|combined with|invoking|appeal(?:ing)? to|utiliz\w*|rel(?:y|ies|ying) on|based on|uses?|use)\s+(?:the\s+)?[^.;]{0,100}(?:Lemma|Proposition|Theorem|Corollary)\s*~?\s*$/i;
const afterDependency = /^\s*(?:\([^)]{0,24}\))?\s*(?:(?:then|now|also|therefore|thus|consequently|hence|further|finally)\s+)?(?:[^.;]{0,120}?)\b(applies?|apply|gives?|give|shows?|show|yields?|yield|implies?|imply|provides?|provide|supplies?|supply|guarantees?|guarantee|ensures?|ensure|forces?|force|makes?|make|identifies?|identify|places?|place|bounds?|bound|permits?|permit|allows?|allow|says?|say|states? that|state that|establishes?|establish|confirms?|confirm|proves?|prove|reduces?|reduce|extends?|extend|determines?|determine|recovers?|recover|controls?|control|characteri[sz]es?|expresses?|preserves?|transports?|takes?|handles?|lets?)\b/i;
const listDependency = /^\s*(?:,|and|&)\s+(?:Lemma|Proposition|Theorem|Corollary)\s*~?\s*\\(?:c|C|auto)?ref\{[^}]+\}[^.;]{0,80}?\b(?:applies|give|gives|show|shows|yield|yields|imply|implies|provide|provides|supply|supplies|guarantee|guarantees|ensure|ensures|force|forces|make|makes|identify|identifies|place|places|bound|bounds|permit|permits|allow|allows|establish|establishes|confirm|confirms|prove|proves|reduce|reduces|extend|extends|determine|determines|recover|recovers|control|controls)\b/i;

const colors = ["#8b75c9", "#5c8fd6", "#c98b5c", "#5cc9a0", "#b07cc6"];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const pointerPattern = /\b(?:see|proved in|shown in|given in|stated in|recalled in|appears in)\b/i;
const restatementPattern = /\bwe (?:now |next )?(?:state|record|restate|quote)\b|\bthe statement of\b|\bis stated\b/i;
const headerPattern = /Proof of (?:the )?[^.]{0,50}$/;

function classifyEdge(edge) {
  if (!edge.context || !edge.label) return "unclear";
  const pattern = new RegExp(`\\\\(?:c|C|auto)?ref\\{${escapeRegExp(edge.label)}\\}`);
  const match = pattern.exec(edge.context);
  if (!match) return "unclear";
  const start = match.index;
  const before = edge.context.slice(Math.max(0, start - 200), start);
  const after = edge.context.slice(start + match[0].length, start + match[0].length + 140);
  if (backgroundPattern.test(before) || backgroundPattern.test(after)) return "background";
  if (headerPattern.test(before)) return "header";
  if (beforeDependency.test(before) || afterDependency.test(after) || listDependency.test(after)) return "dependency";
  if (listContinuation.test(before) && listReference.test(before)) return "dependency";
  if (passiveDependency.test(after)) return "dependency";
  if (objectPattern.test(before)) return "object";
  if (identificationPattern.test(before) || pointerPattern.test(before) || pointerPattern.test(after) || restatementPattern.test(before + " " + after)) return "mentions";
  return "mention";
}

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
      if (reaches(from, to)) {
        dropped += 1;
        continue;
      }
      kept.get(to).push(from);
    }
  }
  return { dependencies: kept, dropped };
}

const minCrossLabelLength = 12;

function normalizedStatementLabel(label) {
  return String(label).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Cross-strategy links are intentionally conservative: an exact normalized
 * statement label in two different manuscripts is a candidate for review, not
 * an inferred mathematical dependency. This recovers relationships the
 * per-manuscript extractor cannot see without treating background citations as
 * proof dependencies.
 */
function crossStrategyEdges(strategies) {
  const groups = new Map();
  for (const strategy of strategies) {
    for (const node of strategy.nodes) {
      const key = normalizedStatementLabel(node.label);
      if (key.length < minCrossLabelLength) continue;
      const entries = groups.get(key) ?? [];
      entries.push({ strategyId: strategy.id, node });
      groups.set(key, entries);
    }
  }
  const edges = [];
  const seen = new Set();
  for (const [key, entries] of groups) {
    const byStrategy = new Map();
    for (const entry of entries) {
      const list = byStrategy.get(entry.strategyId) ?? [];
      list.push(entry);
      byStrategy.set(entry.strategyId, list);
    }
    const strategyIds = [...byStrategy.keys()].sort();
    for (let left = 0; left < strategyIds.length; left += 1) {
      for (let right = left + 1; right < strategyIds.length; right += 1) {
        const first = byStrategy.get(strategyIds[left])[0];
        const second = byStrategy.get(strategyIds[right])[0];
        const [from, to] = [`${first.strategyId}:${first.node.id}`, `${second.strategyId}:${second.node.id}`].sort();
        const edgeKey = `${from}|${to}|same-role`;
        if (seen.has(edgeKey)) continue;
        seen.add(edgeKey);
        edges.push({
          from,
          to,
          type: "same-role",
          label: `Shared statement: ${first.node.label}`.slice(0, 180),
          note: "Exact normalized statement label matches across strategies; review before treating it as a dependency.",
          directed: false,
        });
      }
    }
  }
  return edges.sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to));
}

function buildDeep(structure, family, preserveExisting = false) {
  const nodes = structure.nodes;
  const strategies = [];
  const counts = { background: 0, mention: 0, object: 0, mentions: 0, header: 0, unclear: 0, cycles: 0 };
  for (const manuscript of structure.manuscripts) {
    const manuscriptNodes = nodes.filter((node) => node.manuscript === manuscript.title);
    if (manuscriptNodes.length === 0) continue;
    const ids = new Set(manuscriptNodes.map((node) => node.id));
    const dependencies = new Map(manuscriptNodes.map((node) => [node.id, []]));
    const objectUses = new Map(manuscriptNodes.map((node) => [node.id, []]));
    const mentions = new Map(manuscriptNodes.map((node) => [node.id, []]));
    const seen = new Set();
    const seenObjects = new Set();
    const seenMentions = new Set();
    for (const edge of structure.edges) {
      if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
      const verdict = classifyEdge(edge);
      if (verdict === "background") {
        counts.background += 1;
        continue;
      }
      if (verdict === "mention") {
        counts.mention += 1;
        continue;
      }
      if (verdict === "object") {
        counts.object += 1;
        const objectKey = `${edge.from}|${edge.to}`;
        if (!seenObjects.has(objectKey)) {
          seenObjects.add(objectKey);
          objectUses.get(edge.to).push(edge.from);
        }
        continue;
      }
      if (verdict === "mentions") {
        counts.mentions += 1;
        const mentionKey = `${edge.from}|${edge.to}`;
        if (!seenMentions.has(mentionKey)) {
          seenMentions.add(mentionKey);
          mentions.get(edge.to).push(edge.from);
        }
        continue;
      }
      if (verdict === "header") {
        counts.header += 1;
        continue;
      }
      if (verdict === "unclear") {
        counts.unclear += 1;
        continue;
      }
      const key = `${edge.from}|${edge.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dependencies.get(edge.to).push(edge.from);
    }
    strategies.push({ manuscript, nodes: manuscriptNodes, dependencies, objectUses, mentions });
  }
  if (strategies.length === 0) return { error: "no strategies" };
  const dependencyCount = strategies.reduce((total, strategy) => total + [...strategy.dependencies.values()].reduce((sum, list) => sum + list.length, 0), 0);
  if (dependencyCount === 0 && !preserveExisting) return { error: "no dependency edges" };

  const usedRoleIds = new Set(["result"]);
  const rolesById = new Map();
  const sectionIds = new Map();
  const roleForSection = (section) => {
    if (sectionIds.has(section || "document")) return sectionIds.get(section || "document");
    const id = uniqueId(slug(section || "document"), usedRoleIds);
    sectionIds.set(section || "document", id);
    if (!rolesById.has(id)) rolesById.set(id, { id, label: section || "Document", description: "A section of the paper." });
    return id;
  };

  const finalEdges = [];
  const strategiesOut = [];
  for (const [index, strategy] of strategies.entries()) {
    const strategyId = `m${index + 1}`;
    const { dependencies, dropped } = acyclic(strategy.nodes, strategy.dependencies);
    counts.cycles += dropped;
    const strategyNodes = strategy.nodes.map((node) => ({
      id: node.id,
      role: roleForSection(node.section),
      label: `${node.kind} ${node.id}`,
      fullLabel: `${node.kind} ${node.id}`,
      kind: node.kind,
      source: node.section ?? strategy.manuscript.title,
      detail: "See the linked paper for the original statement; automatic text extraction is not a faithful quotation.",
      dependsOn: dependencies.get(node.id) ?? [],
      ...(strategy.objectUses.get(node.id)?.length ? { objectUses: strategy.objectUses.get(node.id) } : {}),
      ...(strategy.mentions.get(node.id)?.length ? { mentions: strategy.mentions.get(node.id) } : {}),
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
      note: `Statements and proof-dependency references extracted from ${strategy.manuscript.title}.`,
      proofDetail: "section",
      nodes: strategyNodes,
    });
  }

  const crossEdges = crossStrategyEdges(strategies.map((strategy, index) => ({ id: `m${index + 1}`, nodes: strategy.nodes })));
  counts.crossEdges = crossEdges.length;
  const data = {
    schemaVersion: "pw-deep-proof-map-v1",
    machineDerived: true,
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
    crossEdges,
    comparisons: [],
    sharedInputs: [],
    relatedManuscripts: [],
    leanAlignments: [],
    caveats: [
      `${machineMarker}: only references used as premises in the surrounding sentence are kept; background citations and bare mentions are removed.`,
      "A reference is not an audited proof dependency; the paper remains authoritative and this map is unreviewed.",
      "No extracted statement has been identified as proving the family result; consult the source paper for exact statements.",
      ...(crossEdges.length > 0 ? ["Cross-strategy links are exact normalized statement-label matches only; they are review candidates, not audited dependencies."] : []),
    ],
    sources: structure.manuscripts.map((manuscript) => ({ label: manuscript.title, url: manuscript.pdfUrl, kind: "paper" })),
  };
  return { data, counts };
}

const deepFiles = new Map((await readdir(deepDir)).filter((name) => name.endsWith(".json")).map((name) => [name.replace(/\.json$/, ""), name]));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const manifestByFamily = new Map(manifest.deep.map((entry) => [entry.familyNumber, entry]));
const paperFiles = (await readdir(fileURLToPath(new URL("data/proof-maps/paper", root)))).filter((name) => name.endsWith(".json"));
const results = [];

for (const name of paperFiles) {
  const structure = JSON.parse(await readFile(fileURLToPath(new URL(`data/proof-maps/paper/${name}`, root)), "utf8"));
  if (structure.familyNumber === "003") continue; // hand-curated Landau map keeps its own route
  if (only && structure.familyNumber !== only) continue;
  const existing = deepFiles.get(structure.familyNumber);
  let existingData = null;
  if (existing) {
    existingData = JSON.parse(await readFile(`${deepDir}/${existing}`, "utf8"));
    const machine = Array.isArray(existingData.caveats) && existingData.caveats.some((caveat) => caveat.includes(machineMarker));
    if (!machine) continue; // curated map: never overwrite
  }
  const family = catalog.families.find((candidate) => candidate.number === structure.familyNumber);
  const built = buildDeep(structure, family, Boolean(existing));
  if (built.error) {
    results.push({ familyNumber: structure.familyNumber, outcome: existing ? "demoted" : "skipped", reason: built.error });
    continue;
  }
  try {
    validateDeepProofMap(built.data, catalog, lean);
  } catch (error) {
    results.push({ familyNumber: structure.familyNumber, outcome: existing ? "demoted" : "skipped", reason: error instanceof Error ? error.message : String(error) });
    continue;
  }
  results.push({
    familyNumber: structure.familyNumber,
    outcome: existing ? "updated" : "promoted",
    strategies: built.data.strategies.length,
    nodes: built.data.strategies.reduce((total, strategy) => total + strategy.nodes.length, 0),
    edges: built.data.strategies.reduce((total, strategy) => total + strategy.nodes.reduce((sum, node) => sum + node.dependsOn.length, 0), 0),
    ...built.counts,
    crossEdges: built.counts.crossEdges ?? 0,
    data: built.data,
  });
}

if (!dryRun) {
  for (const entry of results) {
    if (entry.outcome === "updated" || entry.outcome === "promoted") {
      await writeFile(`${deepDir}/${entry.familyNumber}.json`, `${JSON.stringify(entry.data, null, 2)}\n`);
      if (!manifestByFamily.has(entry.familyNumber)) {
        manifest.deep.push({
          familyNumber: entry.familyNumber,
          route: `/proof-evolution/openai-math/${entry.familyNumber}`,
          label: entry.data.title,
        });
      }
    } else if (entry.outcome === "demoted") {
      await rm(`${deepDir}/${entry.familyNumber}.json`, { force: true });
      manifest.deep = manifest.deep.filter((item) => item.familyNumber !== entry.familyNumber);
    }
  }
  manifest.deep.sort((left, right) => left.familyNumber.localeCompare(right.familyNumber));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
for (const entry of results) delete entry.data;
const tally = (outcome) => results.filter((entry) => entry.outcome === outcome);
process.stdout.write(`${JSON.stringify({
  families: results.length,
  promoted: tally("promoted").length,
  updated: tally("updated").length,
  demoted: tally("demoted").length,
  skipped: tally("skipped").length,
  nodes: results.filter((entry) => entry.nodes).reduce((total, entry) => total + entry.nodes, 0),
  edges: results.filter((entry) => entry.edges !== undefined).reduce((total, entry) => total + entry.edges, 0),
  droppedBackground: results.reduce((total, entry) => total + (entry.background ?? 0), 0),
  droppedMentions: results.reduce((total, entry) => total + (entry.mention ?? 0), 0),
  objectUses: results.reduce((total, entry) => total + (entry.object ?? 0), 0),
  mentionEdges: results.reduce((total, entry) => total + (entry.mentions ?? 0), 0),
  droppedUnclear: results.reduce((total, entry) => total + (entry.unclear ?? 0), 0),
  droppedCycles: results.reduce((total, entry) => total + (entry.cycles ?? 0), 0),
  crossEdges: results.reduce((total, entry) => total + (entry.crossEdges ?? 0), 0),
  crossEdgeFamilies: results.filter((entry) => (entry.crossEdges ?? 0) > 0).map((entry) => entry.familyNumber),
  demotedSample: tally("demoted").slice(0, 8),
  skippedSample: tally("skipped").slice(0, 8),
}, null, 2)}\n`);
