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
