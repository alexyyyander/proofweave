import { readFile } from "node:fs/promises";
import { buildProofMapIndex } from "../packages/domain/proof-map-index.mjs";

const base = new URL("../", import.meta.url);
const collection = JSON.parse(await readFile(new URL("data/publications/openai-math.json", base), "utf8"));
const manifest = JSON.parse(await readFile(new URL("data/proof-maps/manifest.json", base), "utf8"));
const leanResponse = await readFile(new URL("data/proof-maps/lean-coverage.json", base), "utf8").catch(() => null);
const lean = leanResponse ? JSON.parse(leanResponse) : null;
const index = buildProofMapIndex(collection, manifest, lean);
const json = process.argv.includes("--json");

if (json) {
  console.log(JSON.stringify(index, null, 2));
} else {
  console.log("Proof map coverage");
  console.log(`  families: ${index.summary.families}`);
  console.log(`  deep: ${index.summary.deep}`);
  console.log(`  draft: ${index.summary.draft}`);
  console.log(`  scaffold: ${index.summary.scaffold}`);
  console.log(`  manuscripts: ${index.summary.manuscripts}`);
  console.log(`  families with Lean scope: ${index.summary.scopeFamilies}/${index.summary.families}`);
  console.log(`  comparator links: ${index.summary.comparatorLinks}`);
  console.log(`  upstream linked manuscripts: ${index.summary.formalizedManuscripts}`);
  console.log(`  families with extracted Lean structure: ${index.summary.leanFamilies}`);
  console.log(`  Lean solution modules: ${index.summary.leanSolutionModules}`);
  console.log(`  Lean theorem names: ${index.summary.leanTheoremNames}`);
  console.log("");
  console.log("Curated families:");
  for (const entry of index.entries.filter((candidate) => candidate.status !== "scaffold")) {
    console.log(`  ${entry.familyNumber}  ${entry.status.padEnd(7)}  ${entry.title}`);
  }
  console.log("");
  console.log("Next work queue: use status=scaffold in /proof-evolution; each entry names the next curation step.");
}
