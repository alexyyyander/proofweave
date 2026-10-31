import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const workerRoot = new URL("../dist/server/", import.meta.url);
let runtime;
before(async () => {
  async function modules(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const results = await Promise.all(entries.map((entry) => {
      const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      return entry.isDirectory() ? modules(child) : entry.name.endsWith(".js") ? [fileURLToPath(child)] : [];
    }));
    return results.flat();
  }
  const entrypoint = fileURLToPath(new URL("index.js", workerRoot));
  runtime = new Miniflare({ modules: [{ type: "ESModule", path: entrypoint }, ...(await modules(workerRoot)).filter((path) => path !== entrypoint).map((path) => ({ type: "ESModule", path }))],
    modulesRoot: fileURLToPath(workerRoot), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"], serviceBindings: { ASSETS: async () => new Response("Not found", { status: 404 }) },
  });
});
after(async () => { await runtime?.dispose(); });

const fetchPage = (path) => runtime.dispatchFetch(`http://localhost${path}`, { headers: { accept: "text/html" } });

test("anonymous readers can browse the collection and use filters", async () => {
  const response = await fetchPage("/publications");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes("Mathematics publications"));
  assert.ok(html.includes("719"));
  assert.ok(html.includes('href="/publications/openai-math/001"'));
  assert.ok(html.includes("Withdrawn manuscripts"));
  const filtered = await fetchPage("/publications?q=cycle-decomposition&subject=Combinatorics&evidence=scope");
  assert.equal(filtered.status, 200);
  assert.ok((await filtered.text()).includes('href="/publications/openai-math/181"'));
  const empty = await fetchPage("/publications?q=zzzz-no-such-result");
  assert.ok((await empty.text()).includes("No results match these filters"));
});

test("family records expose citations and narrower Lean coverage without claiming a platform replay", async () => {
  const response = await fetchPage("/publications/openai-math/084");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes("dyadic case"));
  assert.ok(html.includes("BibTeX citation from OpenAI"));
  assert.ok(html.includes("Proofweave replay pending"));
  assert.ok(html.includes("This manuscript is named in the family"));
  assert.ok(html.includes("do not identify this manuscript"));
  assert.equal((await fetchPage("/publications/openai-math/999")).status, 404);
});

test("Agents can download the complete catalog or one source-pinned family", async () => {
  const response = await runtime.dispatchFetch("http://localhost/api/publications/openai-math?download=1");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /attachment/);
  const catalog = await response.json();
  assert.equal(catalog.statistics.manuscripts, 719);
  assert.equal(catalog.families.length, 372);
  const family = await runtime.dispatchFetch("http://localhost/api/publications/openai-math/181?download=1");
  assert.match(family.headers.get("content-disposition"), /181\.json/);
  const record = await family.json();
  assert.equal(record.source.revision, catalog.source.revision);
  assert.equal(record.family.manuscripts[0].proofweaveReplay, "not_run");
  assert.equal((await runtime.dispatchFetch("http://localhost/api/publications/openai-math/999")).status, 404);
});

test("the Landau–Siegel proof-evolution prototype renders with its caveats and Lean gap", async () => {
  const response = await fetchPage("/proof-evolution/landau-siegel");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes("How a nine-page proof became a three-page proof"));
  assert.ok(html.includes("Draft · unreviewed"));
  assert.ok(html.includes("Barreto"));
  assert.ok(html.includes("The shortest human proof is not the formalized proof"));
  assert.ok(html.includes("OAI.NumberTheory.SiegelZeros.Main"));
  assert.ok(html.includes("What the formalization actually contains"));
  assert.ok(html.includes("306"));
  assert.ok(html.includes("Module explorer"));
  assert.ok(html.includes("How each proof actually reaches the result"));
  assert.ok(html.includes("Argument map"));
  assert.ok(html.includes("Wronskian"));
});

test("the Landau–Siegel family links to the proof-evolution prototype", async () => {
  const response = await fetchPage("/publications/openai-math/003");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes("Proof map"));
  assert.ok(html.includes('href="/proof-evolution/landau-siegel"'));
});


test("the proof-map index, scaffold, deep maps, and API render with explicit status", async () => {
  const index = await fetchPage("/proof-evolution");
  assert.equal(index.status, 200);
  const indexHtml = await index.text();
  assert.ok(indexHtml.includes("Every result gets a structure"));
  assert.ok(indexHtml.includes("372"));
  assert.ok(indexHtml.includes("Deep argument map"));
  assert.ok(indexHtml.includes("Metadata scaffold"));

  const scaffold = await fetchPage("/proof-evolution/openai-math/001");
  assert.equal(scaffold.status, 200);
  const scaffoldHtml = await scaffold.text();
  assert.ok(scaffoldHtml.includes("Metadata scaffold"));
  assert.ok(scaffoldHtml.includes("Structure skeleton"));
  assert.ok(scaffoldHtml.includes("No theorem-level proof chain has been curated yet"));

  const deep = await fetchPage("/proof-evolution/openai-math/032");
  assert.equal(deep.status, 200);
  const deepHtml = await deep.text();
  assert.ok(deepHtml.includes("Deep argument map"));
  assert.ok(deepHtml.includes("Theorem dependencies"));
  assert.ok(deepHtml.includes("How the argument reaches the result"));
  assert.ok(deepHtml.includes("Four-factor switch"));
  assert.ok(deepHtml.includes("Deep · unreviewed"));
  assert.ok(deepHtml.includes("No Lean comparator is linked"));
  assert.ok(deepHtml.includes("cited context"));
  assert.ok(deepHtml.includes("Network"));
  assert.ok(deepHtml.includes("Matrix"));

  const api = await runtime.dispatchFetch("http://localhost/api/proof-maps");
  assert.equal(api.status, 200);
  const payload = await api.json();
  assert.equal(payload.entries.length, 372);
  assert.equal(payload.summary.deep, 4);
  assert.equal(payload.summary.draft, 0);
  assert.equal(payload.summary.scaffold, 368);
});


test("the Lean coverage index, family section, and API expose real modules", async () => {
  const index = await fetchPage("/proof-evolution");
  assert.equal(index.status, 200);
  const indexHtml = await index.text();
  assert.ok(indexHtml.includes("Lean structures"));
  assert.ok(indexHtml.includes("536"));

  const family = await fetchPage("/proof-evolution/openai-math/238");
  assert.equal(family.status, 200);
  const familyHtml = await family.text();
  assert.ok(familyHtml.includes("Comparator-linked modules and declarations"));
  assert.ok(familyHtml.includes("OAI.Thorp.Current.first_reciprocal_main"));
  assert.ok(familyHtml.includes("OAI.Probability.ThorpShuffle.FirstMain"));

  const dyadic = await fetchPage("/proof-evolution/openai-math/084");
  assert.equal(dyadic.status, 200);
  const dyadicHtml = await dyadic.text();
  assert.ok(dyadicHtml.includes("General q"));
  assert.ok(dyadicHtml.includes("Dyadic q = 1/2"));
  assert.ok(dyadicHtml.includes("OAI.Problem310.dyadic_affine_avoidance"));
  assert.ok(dyadicHtml.includes("Lean comparator formalizes the dyadic case only"));
  assert.ok(dyadicHtml.includes("Network"));

  const reciprocal = await fetchPage("/proof-evolution/openai-math/159");
  assert.equal(reciprocal.status, 200);
  const reciprocalHtml = await reciprocal.text();
  assert.ok(reciprocalHtml.includes("Triangular increment"));
  assert.ok(reciprocalHtml.includes("OAI.Erdos3.manuscriptReciprocalProgressionTheorem"));
  assert.ok(reciprocalHtml.includes("quantitative density bound is outside this alignment"));

  const api = await runtime.dispatchFetch("http://localhost/api/proof-maps");
  assert.equal(api.status, 200);
  const payload = await api.json();
  assert.equal(payload.summary.leanFamilies, 242);
  assert.equal(payload.summary.leanSolutionModules, 426);
  assert.equal(payload.summary.leanTheoremNames, 536);

  const leanApi = await runtime.dispatchFetch("http://localhost/api/proof-maps/lean");
  assert.equal(leanApi.status, 200);
  const leanPayload = await leanApi.json();
  assert.equal(leanPayload.summary.familiesWithComparators, 242);
  assert.equal(leanPayload.summary.comparatorLinks, 426);
  assert.equal(leanPayload.summary.solutionFetched, 426);
});
