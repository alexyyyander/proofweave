import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLeanSourceFetcher } from "./lib/proof-map-lean-cache.mjs";

const root = new URL("../", import.meta.url);
const catalog = JSON.parse(await readFile(new URL("data/publications/openai-math.json", root), "utf8"));
const commit = process.env.PROOF_MAP_LEAN_COMMIT || catalog.source.revision;
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const outPath = option("--out", fileURLToPath(new URL("data/proof-maps/lean-coverage.json", root)));
const cacheDir = option("--cache", "/tmp/proof-map-lean-cache");
const concurrency = Math.max(1, Math.min(12, Number(option("--concurrency", "6")) || 6));
const limit = Number(option("--limit", "0")) || 0;
const repository = "openai/math";
const rawBase = `https://raw.githubusercontent.com/${repository}/${commit}/lean/`;

const jobs = [];
for (const family of catalog.families) {
  for (const comparator of family.scope?.comparatorLinks ?? []) {
    jobs.push({ family, comparator });
  }
}
const selected = limit > 0 ? jobs.slice(0, limit) : jobs;

const fetchText = createLeanSourceFetcher({ cacheDir, rawBase, repository, revision: commit });

function modulePath(moduleName) {
  return `${moduleName.replaceAll(".", "/")}.lean`;
}
function parseLean(text) {
  const imports = [...text.matchAll(/^import\s+([^\s]+)/gm)].map((match) => match[1]);
  const declarations = [...text.matchAll(/^(?:private\s+|protected\s+|noncomputable\s+|partial\s+|unsafe\s+)?(theorem|lemma|def|abbrev|structure|class|instance)\s+([^\s({:]+)/gm)].map((match) => ({ kind: match[1], name: match[2] }));
  return {
    lines: text ? text.split("\n").length - 1 : 0,
    bytes: text.length,
    imports,
    declarations,
    sorry: (text.match(/\bsorry\b/g) || []).length,
    axioms: (text.match(/^axiom\s+/gm) || []).length,
  };
}

async function inspect(job) {
  const { family, comparator } = job;
  const match = comparator.url.match(/\/lean\/(.+\.lean)$/);
  if (!match) return { family, error: "comparator URL is not a lean/...lean path" };
  const challengePath = match[1];
  const jsonPath = challengePath.replace(/\.lean$/, ".json");
  const jsonResponse = await fetchText(jsonPath);
  let config = null;
  if (jsonResponse.status === 200) {
    try { config = JSON.parse(jsonResponse.text); } catch { config = null; }
  }
  const challenge = await fetchText(challengePath);
  const solutionPath = config?.solution_module ? modulePath(config.solution_module) : null;
  const solution = solutionPath ? await fetchText(solutionPath) : { status: 0, text: "" };
  const challengeInfo = parseLean(challenge.text);
  const solutionInfo = parseLean(solution.text);
  return {
    familyNumber: family.number,
    familyTitle: family.title,
    familySubject: family.subject,
    label: comparator.label,
    challengePath,
    challengeUrl: `https://github.com/openai/math/blob/${commit}/lean/${challengePath}`,
    jsonPath,
    jsonUrl: `https://github.com/openai/math/blob/${commit}/lean/${jsonPath}`,
    solutionModule: config?.solution_module ?? null,
    solutionPath,
    solutionUrl: solutionPath ? `https://github.com/openai/math/blob/${commit}/lean/${solutionPath}` : null,
    theoremNames: config?.theorem_names ?? [],
    definitionNames: config?.definition_names ?? [],
    permittedAxioms: config?.permitted_axioms ?? [],
    enableNanoda: Boolean(config?.enable_nanoda),
    jsonStatus: jsonResponse.status,
    challengeStatus: challenge.status,
    solutionStatus: solution.status,
    solutionLines: solutionInfo.lines,
    solutionBytes: solutionInfo.bytes,
    solutionImports: solutionInfo.imports,
    solutionDeclarationCount: solutionInfo.declarations.length,
    solutionDeclarations: solutionInfo.declarations.slice(0, 30),
    solutionSorry: solutionInfo.sorry,
    solutionAxioms: solutionInfo.axioms,
    challengeLines: challengeInfo.lines,
    challengeSorry: challengeInfo.sorry,
    error: jsonResponse.error ?? challenge.error ?? solution.error ?? null,
  };
}

const results = [];
let cursor = 0;
let completed = 0;
async function worker() {
  while (true) {
    const index = cursor;
    cursor += 1;
    if (index >= selected.length) return;
    const result = await inspect(selected[index]);
    results.push(result);
    completed += 1;
    if (completed % 20 === 0 || completed === selected.length) {
      process.stderr.write(`lean coverage ${completed}/${selected.length}\n`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, worker));

const byFamily = new Map();
for (const result of results) {
  if (!byFamily.has(result.familyNumber)) {
    byFamily.set(result.familyNumber, {
      familyNumber: result.familyNumber,
      familyTitle: result.familyTitle,
      familySubject: result.familySubject,
      comparatorCount: 0,
      comparators: [],
    });
  }
  const family = byFamily.get(result.familyNumber);
  family.comparatorCount += 1;
  family.comparators.push(result);
}
const families = [...byFamily.values()].map((family) => {
  const solutionFetched = family.comparators.filter((entry) => entry.solutionStatus === 200).length;
  const jsonFetched = family.comparators.filter((entry) => entry.jsonStatus === 200).length;
  const challengeFetched = family.comparators.filter((entry) => entry.challengeStatus === 200).length;
  const theoremNames = [...new Set(family.comparators.flatMap((entry) => entry.theoremNames))];
  const permittedAxioms = [...new Set(family.comparators.flatMap((entry) => entry.permittedAxioms))].sort();
  return {
    ...family,
    solutionFetched,
    jsonFetched,
    challengeFetched,
    solutionMissing: family.comparatorCount - solutionFetched,
    theoremNames,
    permittedAxioms,
    textualSorry: family.comparators.reduce((total, entry) => total + entry.solutionSorry, 0),
    textualAxioms: family.comparators.reduce((total, entry) => total + entry.solutionAxioms, 0),
    leanStructureStatus: solutionFetched === family.comparatorCount ? "extracted" : solutionFetched > 0 ? "partial" : "missing",
  };
});

const summary = {
  familiesWithComparators: families.length,
  comparatorLinks: results.length,
  jsonFetched: results.filter((entry) => entry.jsonStatus === 200).length,
  challengeFetched: results.filter((entry) => entry.challengeStatus === 200).length,
  solutionFetched: results.filter((entry) => entry.solutionStatus === 200).length,
  solutionMissing: results.filter((entry) => entry.solutionStatus !== 200).length,
  theoremNames: new Set(results.flatMap((entry) => entry.theoremNames)).size,
  textualSorry: results.reduce((total, entry) => total + entry.solutionSorry, 0),
  textualAxioms: results.reduce((total, entry) => total + entry.solutionAxioms, 0),
};
const output = {
  schemaVersion: "pw-lean-coverage-v1",
  status: "draft",
  reviewStatus: "unreviewed",
  generatedAt: "2026-10-31",
  commit,
  sourceNote: "Generated by fetching comparator JSON, challenge modules, and solution modules from the pinned OpenAI math repository. Imports are direct imports only; no kernel build or #print axioms run.",
  summary,
  families,
};
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ outPath, summary }, null, 2));
