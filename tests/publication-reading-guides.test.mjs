import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withPublicationReadingGuides } from "../packages/domain/publication-reading-guides.mjs";
import { searchPublicationFamilies, publicationBrowseHref } from "../packages/domain/publication-catalog.mjs";

const catalog = JSON.parse(await readFile(new URL("../data/publications/openai-math.json", import.meta.url), "utf8"));
const notes = JSON.parse(await readFile(new URL("../data/publications/openai-math-reading-guides.zh-CN.json", import.meta.url), "utf8"));
const enriched = withPublicationReadingGuides(catalog, notes);

test("six reading guides cover nine manuscripts without modifying upstream evidence", () => {
  assert.equal(enriched.statistics.chineseReadingGuides, 6);
  assert.equal(enriched.statistics.guidedManuscripts, 9);
  assert.equal(enriched.statistics.proofweaveReplays, 0);
  assert.equal(enriched.families.length, 372);
  assert.equal(enriched.families.flatMap((family) => family.manuscripts).length, 719);
  assert.equal(catalog.readingGuides, undefined);
  for (const family of enriched.families) {
    const original = catalog.families.find((item) => item.number === family.number);
    assert.deepEqual(family.manuscripts, original.manuscripts);
    assert.equal(family.scope, original.scope);
    for (const paper of family.manuscripts) {
      assert.equal(paper.proofweaveReplay, "not_run");
      assert.equal(paper.statementReview, "not_started");
      assert.equal(paper.receipt, null);
    }
  }
  assert.equal(enriched.families.find((f) => f.number === "001").readingGuide, null);
});

test("notes stay bound to the exact upstream revision and manuscript family", () => {
  assert.throws(() => withPublicationReadingGuides(catalog, { ...notes, upstreamRevision: "b".repeat(40) }), /pinned publication revision/);
  const otherPaper = structuredClone(notes);
  otherPaper.guides[0].manuscriptIds = [catalog.families[0].manuscripts[0].id];
  assert.throws(() => withPublicationReadingGuides(catalog, otherPaper), /does not belong/);
  assert.throws(() => withPublicationReadingGuides(catalog, { ...notes, guides: [notes.guides[0], notes.guides[0]] }), /repeated/);
});

test("source links reject moving branches, path traversal, bad hashes, and missing evidence roles", () => {
  for (const mutate of [
    (source) => { source.url = source.url.replace(notes.upstreamRevision, "main"); },
    (source) => { source.path = "../private.txt"; },
    (source) => { source.sha256 = "not-a-hash"; },
    (source) => { source.readLines = [20, 1]; },
  ]) {
    const changed = structuredClone(notes);
    mutate(changed.guides[0].sources[0]);
    assert.throws(() => withPublicationReadingGuides(catalog, changed), /safe pinned path/);
  }
  const missingRole = structuredClone(notes);
  missingRole.guides[0].sources = missingRole.guides[0].sources.filter((s) => s.role !== "solution_entry");
  assert.throws(() => withPublicationReadingGuides(catalog, missingRole), /solution references/);
  const promoted = structuredClone(notes);
  promoted.guides[0].editorialStatus = "verified";
  assert.throws(() => withPublicationReadingGuides(catalog, promoted), /not proof review/);
});

test("Chinese queries and the reading filter find notes and survive pagination links", () => {
  const allGuided = searchPublicationFamilies(enriched, { reading: "guided" });
  assert.equal(allGuided.total, 6);
  assert.equal(allGuided.manuscriptCount, 9);
  const selected = searchPublicationFamilies(enriched, { q: "等差数列", reading: "guided", subject: "Combinatorics" });
  assert.equal(selected.total, 1);
  assert.equal(selected.families[0].number, "159");
  const url = new URL(publicationBrowseHref({ ...selected, page: 2 }), "https://proofweave.org");
  assert.equal(url.searchParams.get("reading"), "guided");
  assert.equal(url.searchParams.get("q"), "等差数列");
  assert.equal(searchPublicationFamilies(enriched, { reading: "invented" }).total, 372);
});

test("known scope distinctions are retained rather than inherited by companion papers", () => {
  const family = (number) => enriched.families.find((f) => f.number === number);
  assert.equal(family("026").readingGuide.scopeStatus, "documentation_mismatch");
  assert.equal(family("084").readingGuide.scopeStatus, "narrower_than_manuscript");
  assert.equal(family("084").manuscripts[0].citedByScopeDocument, false);
  assert.equal(family("084").manuscripts[1].citedByScopeDocument, true);
  assert.equal(family("159").readingGuide.scopeStatus, "narrower_than_manuscript");
  assert.equal(family("191").readingGuide.scopeStatus, "narrower_than_manuscript");
  assert.ok(notes.guides.every((g) => g.limitationsZh.includes("未运行 Lean") && g.comparatorNoteZh.includes("sorry")));
  assert.equal(notes.guides.reduce((n, g) => n + g.sources.length, 0), 36);
});
