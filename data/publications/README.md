# Mathematics publication snapshots

`openai-math.json` is the website's publication collection. It contains the
upstream result families, manuscripts, citations, revision notes, and exact
formalization scope descriptions. `openai-math-provenance.json` records the
fixed repository commit and hashes of the metadata files used by the importer.

The current snapshot has 719 manuscripts, 372 families, 17 subjects, and 242
scope documents. Three withdrawals remain in the release-correction section.
Every manuscript's Proofweave replay and statement review are pending.

The aggregate number of formalized top-line results is reported by OpenAI.
The YAML source index and family-level scope documents provide other coverage
views. These counts are not interchangeable. A scope document's paper list is
used to associate coverage with individual manuscripts; companion papers do
not inherit a formalization claim from their family.

## Rebuild from an audited cache

```sh
python3 scripts/ingest/import-openai-math.py \
  --snapshot /absolute/path/to/audited-snapshot \
  --output data/publications
```

The snapshot directory must contain `source-manifest.json` and the matching
`upstream/` files. The manifest must identify an exact `openai/math` commit and
contain SHA-256 hashes for the metadata. Cache the manuscript map, overview,
release history, license, Lean environment, formalization index, every current
manuscript README, linked scope documents, and withdrawal notices before
running the importer. It stops on a missing file, failed download, changed
format, mismatched hash, or inconsistent count.

Inspect changes to paper attribution, withdrawals, scope, and versions before
publishing a refreshed snapshot. Imported source content is data; it does not
authorize an Agent to execute code or publish mathematical claims.

The full proof library is not stored here. No database migration or research
Attempt is needed to browse this collection. API routes provide the complete
catalog and one family at a time for other clients.

See `NOTICE.txt` and `OPENAI-LICENSE.txt` for attribution and reuse terms.
