import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../../app/i18n/client";
import { en } from "../../app/i18n/dictionaries/en";
import { ArgumentMapView } from "../../app/proof-evolution/landau-siegel/ArgumentMapView";
import { adaptDeepProofMap } from "../../app/lib/deep-proof-map";
import { edgeDirectionGlyph } from "../../app/lib/argument-map-direction";

test("machine-derived cross-strategy links render without directional arrows", async () => {
  const deep = JSON.parse(await readFile(new URL("../../data/proof-maps/deep/011.json", import.meta.url), "utf8"));
  const adapted = adaptDeepProofMap(deep, "revision:direction-test", "Direction test");
  const html = renderToStaticMarkup(<I18nProvider locale="en" dictionary={en}>
    <ArgumentMapView data={adapted.proof} argumentMap={adapted.argumentMap} lean={adapted.lean} />
  </I18nProvider>);
  const crossPaths = [...html.matchAll(/<path[^>]*class="[^"]*is-cross[^"]*"[^>]*>/g)].map((match) => match[0]);
  assert.ok(crossPaths.length > 0);
  for (const path of crossPaths) {
    assert.doesNotMatch(path, /marker-end/);
    assert.match(path, /data-directed="false"/);
  }
  assert.equal(edgeDirectionGlyph({ directed: false }), "↔");
  assert.equal(edgeDirectionGlyph({ directed: true }), "→");
  assert.equal(edgeDirectionGlyph({ directed: true }, true), "←");
});
