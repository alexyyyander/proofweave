import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { searchPublicationFamilies, publicationBrowseHref } from "../packages/domain/publication-catalog.mjs";
import { renderPublicationText } from "../packages/domain/publication-math.mjs";

const catalog = JSON.parse(await readFile(new URL("../data/publications/openai-math.json", import.meta.url), "utf8"));
const provenance = JSON.parse(await readFile(new URL("../data/publications/openai-math-provenance.json", import.meta.url), "utf8"));
const papers = catalog.families.flatMap((family) => family.manuscripts);

test("all manuscripts carry citations and immutable sources without platform attestations", () => {
  assert.equal(catalog.families.length, 372);
  assert.equal(papers.length, 719);
  assert.equal(new Set(papers.map((paper) => paper.id)).size, 719);
  assert.equal(catalog.subjects.length, 17);
  assert.equal(catalog.statistics.proofweaveReplays, 0);
  assert.equal(provenance.metadataErrors.length, 0);
  for (const paper of papers) {
    assert.match(paper.citation, /author\s*=\s*\{\{OpenAI\}\}/);
    assert.ok(paper.abstract.length > 0);
    assert.ok(paper.pdfUrl.includes(`/blob/${catalog.source.revision}/`));
    assert.ok(paper.readmeUrl.includes(`/blob/${catalog.source.revision}/`));
    assert.match(paper.readmeSha256, /^[a-f0-9]{64}$/);
    assert.equal(paper.proofweaveReplay, "not_run");
    assert.equal(paper.statementReview, "not_started");
    assert.equal(paper.receipt, null);
  }
  assert.equal(catalog.withdrawals.length, 3);
  assert.ok(catalog.withdrawals.every((withdrawal) => !papers.some((paper) => paper.title === withdrawal.title)));
});

test("family-level scope does not mark every companion paper as formalized", () => {
  const family = catalog.families.find((entry) => entry.number === "084");
  assert.equal(family.manuscripts.length, 2);
  assert.equal(family.manuscripts[0].citedByScopeDocument, false);
  assert.equal(family.manuscripts[1].citedByScopeDocument, true);
  assert.match(family.scope.text, /dyadic case/);
  assert.match(catalog.families.find((entry) => entry.number === "159").scope.text, /outside this statement/);
});

test("search finds accented names, abstracts, and combined subject/evidence filters", () => {
  const accented = searchPublicationFamilies(catalog, { q: "erdos" });
  assert.ok(accented.total > 0);
  assert.ok(accented.families.some((family) => family.title.includes("Erdős")));
  const fixtures = { subjects: [{ name: "Combinatorics" }, { name: "Number theory" }], families: [
    { number: "001", title: "First", subject: "Combinatorics", claim: "", scope: {}, manuscripts: [{ title: "A paper", abstract: "uniqueword", authors: ["OpenAI"] }] },
    { number: "002", title: "Second", subject: "Number theory", claim: "", scope: null, manuscripts: [{ title: "Other", abstract: "uniqueword", authors: ["OpenAI"] }] },
  ] };
  const filtered = searchPublicationFamilies(fixtures, { q: "uniqueword", subject: "Combinatorics", evidence: "scope" });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.families[0].number, "001");
  assert.equal(searchPublicationFamilies(fixtures, { evidence: "no-scope" }).families[0].number, "002");
});

test("pagination remains bounded and retains filters", () => {
  assert.equal(searchPublicationFamilies(catalog, { page: "999999999999999999999" }).page, 1);
  assert.equal(searchPublicationFamilies(catalog, { page: "-3" }).page, 1);
  assert.equal(searchPublicationFamilies(catalog, { page: "999" }).page, 31);
  const href = publicationBrowseHref({ query: "Erdős & graphs", subject: "Combinatorics", evidence: "scope", page: 2 });
  const params = new URL(href, "https://proofweave.org").searchParams;
  assert.equal(params.get("q"), "Erdős & graphs");
  assert.equal(params.get("subject"), "Combinatorics");
  assert.equal(params.get("evidence"), "scope");
  assert.equal(params.get("page"), "2");
});

test("math rendering preserves semantics and treats imported HTML as text", () => {
  const rendered = renderPublicationText('ℝ<sup><i>d</i></sup> and $`n^{2/d}`$ <img src=x onerror=alert(1)>');
  assert.ok(rendered.includes("<sup><em>d</em></sup>"));
  assert.ok(rendered.includes('class="katex"'));
  assert.ok(rendered.includes("&lt;img"));
  assert.equal(/<img\b/.test(rendered), false);
  assert.equal(/href=["']javascript:/.test(renderPublicationText("$\\href{javascript:alert(1)}{x}$")), false);
});
