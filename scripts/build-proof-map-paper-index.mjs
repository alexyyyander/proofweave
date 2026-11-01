#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createLeanSourceFetcher } from "./lib/proof-map-lean-cache.mjs";

/**
 * Extract a paper-derived structure for every result family from the pinned
 * upstream LaTeX sources: theorem-like statements as nodes, and explicit
 * references inside proof environments as edges. The result is deliberately
 * labelled a reference structure, not a verified dependency graph.
 */
const root = new URL("../", import.meta.url);
const catalog = JSON.parse(await readFile(new URL("data/publications/openai-math.json", root), "utf8"));
const commit = process.env.PROOF_MAP_TEX_COMMIT || catalog.source.revision;
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const outPath = option("--out", fileURLToPath(new URL("data/proof-maps/paper-coverage.json", root)));
const paperDir = option("--paper-dir", fileURLToPath(new URL("data/proof-maps/paper", root)));
const cacheDir = option("--cache", "/tmp/proof-map-tex-cache");
const concurrency = Math.max(1, Math.min(12, Number(option("--concurrency", "8")) || 8));
const limit = Number(option("--limit", "0")) || 0;
const maxNodesPerFamily = Number(option("--max-nodes", "80")) || 80;
const maxEdgesPerFamily = Number(option("--max-edges", "160")) || 160;
const repository = "openai/math";
const rawBase = `https://raw.githubusercontent.com/${repository}/${commit}/`;
const fetchText = createLeanSourceFetcher({ cacheDir, rawBase, repository, revision: commit, retryDelayMs: 250 });

const topLevelCandidates = ["main.tex", "paper.tex", "manuscript.tex", "article.tex"];
const statementKinds = ["theorem", "lemma", "proposition", "corollary"];
const maxInputs = 40;

function stripComments(text) {
  return text.replace(/(^|[^\\])%.*$/gm, "$1");
}

function plainText(value, limitLength = 260) {
  let text = stripComments(String(value ?? ""));
  text = text
    .replace(/\\(?:label|tag)\{[^}]*\}/g, " ")
    .replace(/\\(?:cite|citep|citet|eqref|ref|autoref|cref|Cref)\*?(?:\[[^\]]*\])?\{[^}]*\}/g, " ")
    .replace(/\\begin\{[^}]*\}|\\end\{[^}]*\}/g, " ")
    .replace(/\\(?:[a-zA-Z]+)\*?(?:\[[^\]]*\])?(?:\{([^{}]*)\})?/g, "$1")
    .replace(/[{}$]/g, " ")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > limitLength) text = `${text.slice(0, limitLength).replace(/\s+\S*$/, "")}…`;
  return text;
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "node";
}

function extractTitle(body) {
  const optional = body.match(/^\s*\[([^\]]{2,160})\]/);
  if (optional) return plainText(optional[1], 120);
  const bold = body.match(/\\textbf\{([^{}]{2,160})\}/);
  if (bold) return plainText(bold[1], 120);
  return null;
}

function parseFile(name, text) {
  const source = stripComments(text);
  const events = [];
  for (const match of source.matchAll(/\\(sub)*section\*?\{([^{}]*)\}/g)) {
    if (match[1]) continue;
    events.push({ at: match.index, type: "section", title: plainText(match[2], 160) });
  }
  const statementPattern = new RegExp(`\\\\begin\\{(${statementKinds.join("|")})\\}([\\s\\S]*?)\\\\end\\{\\1\\}`, "g");
  for (const match of source.matchAll(statementPattern)) {
    const body = match[2];
    events.push({
      at: match.index,
      type: "statement",
      kind: match[1],
      label: (body.match(/\\label\{([^}]+)\}/) || [])[1] ?? null,
      title: extractTitle(body),
      statement: plainText(body, 200),
      file: name,
    });
  }
  for (const match of source.matchAll(/\\begin\{proof\}([\s\S]*?)\\end\{proof\}/g)) {
    events.push({
      at: match.index,
      type: "proof",
      refs: [...match[1].matchAll(/\\(?:c|C|auto)?ref\{([^}]+)\}/g)].map((ref) => ref[1]),
      file: name,
    });
  }
  events.sort((left, right) => left.at - right.at);
  return { name, events };
}

function inputPaths(main) {
  const paths = [];
  for (const match of main.matchAll(/\\(?:input|include)\{([^}]+)\}/g)) {
    const path = match[1].trim();
    if (!path) continue;
    paths.push(path.endsWith(".tex") ? path : `${path}.tex`);
  }
  return paths.slice(0, maxInputs);
}

function uniqueId(base, used) {
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function assemble(files) {
  const parsed = files.map(([name, text]) => parseFile(name, text));
  const nodes = [];
  const ids = new Set();
  const labelToId = new Map();
  const ordered = [];
  // First pass: assign ids and section context in document order.
  let section = null;
  for (const file of parsed) {
    for (const event of file.events) {
      if (event.type === "section") {
        section = event.title;
        ordered.push({ ...event, section });
      } else if (event.type === "statement") {
        const id = uniqueId(event.label ? slug(event.label) : slug(`${event.kind}-${nodes.length + 1}`), ids);
        ids.add(id);
        if (event.label) labelToId.set(event.label, id);
        nodes.push({
          id,
          kind: event.kind,
          label: event.title || plainText(event.statement, 80) || id,
          statement: event.statement,
          section,
        });
        ordered.push({ ...event, nodeId: id });
      } else {
        ordered.push(event);
      }
    }
  }
  // Second pass: attach proof references to the statement each proof follows.
  const edges = [];
  const seen = new Set();
  let lastStatement = null;
  for (const event of ordered) {
    if (event.type === "statement") {
      lastStatement = event.nodeId;
    } else if (event.type === "proof" && lastStatement) {
      for (const ref of event.refs) {
        const from = labelToId.get(ref);
        const key = `${from}|${lastStatement}`;
        if (!from || from === lastStatement || seen.has(key)) continue;
        seen.add(key);
        edges.push({ from, to: lastStatement });
      }
    }
  }
  const sections = [...new Set(nodes.map((node) => node.section).filter(Boolean))];
  return { sections, nodes, edges };
}

async function extractManuscript(manuscript) {
  const base = `preprints/${manuscript.id}/build/`;
  let topLevel = null;
  for (const candidate of topLevelCandidates) {
    const response = await fetchText(`${base}${candidate}`);
    if (response.status === 200) {
      topLevel = { path: candidate, text: response.text };
      break;
    }
  }
  if (!topLevel) return null;
  const files = [[topLevel.path, topLevel.text]];
  const seen = new Set([topLevel.path]);
  for (const relative of inputPaths(topLevel.text)) {
    if (seen.has(relative)) continue;
    seen.add(relative);
    const response = await fetchText(`${base}${relative}`);
    if (response.status === 200) files.push([relative, response.text]);
  }
  const assembled = assemble(files);
  if (assembled.nodes.length === 0) return null;
  return {
    manuscriptId: manuscript.id,
    manuscriptTitle: manuscript.title,
    date: manuscript.date,
    pdfUrl: manuscript.pdfUrl,
    topLevel: topLevel.path,
    files: files.map(([name]) => name),
    ...assembled,
  };
}

async function mapWithConcurrency(items, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

const families = catalog.families.slice(0, limit > 0 ? limit : undefined);
const extracted = await mapWithConcurrency(families, async (family) => {
  const manuscripts = [];
  for (const manuscript of family.manuscripts.slice(0, 3)) {
    try {
      const result = await extractManuscript(manuscript);
      if (result) manuscripts.push(result);
    } catch {
      // A missing or unparsable source simply yields no paper structure.
    }
  }
  if (manuscripts.length === 0) return null;
  // Labels are only unique within one paper, so prefix every id with the
  // manuscript index before merging a family's papers.
  const allNodes = manuscripts.flatMap((manuscript, index) => {
    const prefix = `m${index + 1}-`;
    return manuscript.nodes.map((node) => ({
      ...node,
      id: prefix + node.id,
      manuscript: manuscript.manuscriptTitle,
    }));
  });
  const nodes = allNodes.slice(0, maxNodesPerFamily);
  const known = new Set(nodes.map((node) => node.id));
  const edges = manuscripts.flatMap((manuscript, index) => {
    const prefix = `m${index + 1}-`;
    return manuscript.edges.map((edge) => ({ from: prefix + edge.from, to: prefix + edge.to }));
  })
    .filter((edge) => known.has(edge.from) && known.has(edge.to))
    .slice(0, maxEdgesPerFamily);
  return {
    familyNumber: family.number,
    familyTitle: plainText(family.title, 200),
    manuscripts: manuscripts.map((manuscript) => ({
      id: manuscript.manuscriptId,
      title: manuscript.manuscriptTitle,
      date: manuscript.date,
      pdfUrl: manuscript.pdfUrl,
    })),
    sections: [...new Set(nodes.map((node) => node.section).filter(Boolean))],
    nodes,
    edges,
  };
});

const entries = extracted.filter(Boolean);
const report = {
  schemaVersion: "pw-paper-coverage-v1",
  status: "draft",
  reviewStatus: "unreviewed",
  generatedAt: new Date().toISOString().slice(0, 10),
  commit,
  sourceNote: "Theorem-like statements and explicit references inside proofs, extracted from the pinned upstream LaTeX sources. A reference is not a verified proof dependency.",
  summary: {
    families: catalog.families.length,
    familiesWithStructure: entries.length,
    papers: entries.reduce((total, entry) => total + entry.manuscripts.length, 0),
    sections: entries.reduce((total, entry) => total + entry.sections.length, 0),
    statements: entries.reduce((total, entry) => total + entry.nodes.length, 0),
    edges: entries.reduce((total, entry) => total + entry.edges.length, 0),
  },
  families: entries,
};

await mkdir(paperDir, { recursive: true });
for (const entry of entries) {
  await writeFile(`${paperDir}/${entry.familyNumber}.json`, `${JSON.stringify(entry, null, 2)}\n`);
}
const summary = {
  ...report,
  families: entries.map((entry) => ({
    familyNumber: entry.familyNumber,
    familyTitle: entry.familyTitle,
    manuscripts: entry.manuscripts.length,
    sections: entry.sections.length,
    statements: entry.nodes.length,
    edges: entry.edges.length,
  })),
};
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);
