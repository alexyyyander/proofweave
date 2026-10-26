# Pinned catalog ingestion

The first closed-alpha catalog comes from the immutable Formal Conjectures
benchmark snapshot recorded in `data/formal-conjectures/`.

The migration that seeds this snapshot uses stable IDs and `INSERT OR IGNORE`,
so repeating it does not duplicate records. A changed upstream commit must be
introduced as a new `source_snapshots` row and new `problem_revisions`; never
edit an imported revision in place.

Run `npm run catalog:verify-source` before adding a new snapshot. It checks the
pin, hashes, declaration identifiers, and frontier/practice classification. The
database migration is the actual import transaction for the closed-alpha seed.

## Public research discovery pilot

`collect-public-research.py` collects bibliographic metadata from arXiv and
Crossref and metadata for the public GitHub repositories listed in
`config/public-research-sources.json`. It requires Python 3.9 or later and no
packages, account credentials, model service, or database access.

```sh
python3 scripts/ingest/collect-public-research.py
node scripts/ingest/render-public-research.mjs
python3 tests/public-research-ingestion.test.py
```

The default output is `outputs/public-research/index.json`; the renderer writes
an offline, searchable `index.html` alongside it. Use `--output` to retain a
different collection. Always reuse the same JSON between runs: it contains the
source cooldowns, last successful retrieval, previous records, and stable IDs.
Do not run multiple collectors against the same output simultaneously.

Each source is attempted at most once per day. HTTP failures, including 429,
preserve existing records and defer the source for at least 24 hours (or longer
when `Retry-After` requires it). The command writes usable partial results but
exits with code 2 when any source is unavailable. A successful empty query is
distinct from a failed query. Date, version, response hash, normalized content
hash, source ID, and licensing metadata remain inspectable.

arXiv versions share a stable record ID. Crossref publications and arXiv
preprints with matching DOIs are linked instead of conflated. Crossref abstracts
and all full papers/repository contents are excluded. Topics and relevance are
rule-based discovery hints, not mathematical assessments. Every record remains
`source_reported` with `proofweaveAttested: false`.

This pilot does not modify the catalog, create research Attempts or
contributions, publish to the website, or enable a schedule. Production rollout
still needs a persistent hosted index, a narrowly authorized updater, a source
status view, and a verified recurring update path. Retrieval failures must not
be presented as fresh successful content updates.
