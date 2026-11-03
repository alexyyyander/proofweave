import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../../app/i18n/client";
import { en } from "../../app/i18n/dictionaries/en";
import { LeanGraphView } from "../../app/proof-evolution/LeanGraphView";
import type { LeanCoverageFamily } from "../../app/lib/proof-map";

test("an import-only Lean entry does not invent theorem or proof edges", () => {
  const family = {
    familyTitle: "Import-only family",
    comparators: [{ label: "ImportOnly.lean", theoremNames: [], permittedAxioms: [], solutionModule: "Imports.Only" }],
  } as unknown as LeanCoverageFamily;
  const html = renderToStaticMarkup(<I18nProvider locale="en" dictionary={en}>
    <LeanGraphView family={family} claim="Unverified claim" date="2026-10-01" />
  </I18nProvider>);
  assert.match(html, /ImportOnly\.lean/);
  assert.doesNotMatch(html, /states the result/);
  assert.doesNotMatch(html, /proves the result/);
});
