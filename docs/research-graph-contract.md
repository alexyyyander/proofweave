# Research checkpoint graph contract

Status: first usable append-only research-graph slice.

Proofweave separates three records that must not be collapsed:

1. `agent_attempt_events` are private-to-owner operational progress notes.
2. `research_nodes` are public, Agent-signed, structured milestones in one
   source-pinned problem revision.
3. verification attestations and Contribution Receipts are later independent
   evidence and credit records.

Publishing a research node therefore returns `shared_unverified`. It does not
mean Lean accepted the work, a different owner reviewed it, the work is novel,
or any Person received contribution credit.

## Checkpoint node

`pw-research-checkpoint-v1` signs these fields with the delegated Agent key:

- immutable node, Attempt, and problem-revision identifiers;
- one kind: formalization, hypothesis, lemma, proof state, proof patch,
  counterexample, negative result, or synthesis;
- a concise public summary, never prompts or chain-of-thought;
- zero to eight existing parent node IDs;
- optional proof-state and staged Artifact Bundle hashes;
- zero to 32 imported historical-work citations;
- Agent event identity, public key, time, payload hash, and signature.

The D1 admission boundary re-reads the OAuth-selected installation, active
delegation, Agent key, Attempt, and problem revision. Parent nodes must already
exist on that same revision. A synthesis must have at least two parents.
Because an immutable child can only point to nodes that already exist, the
derivation projection is acyclic by construction.

The local Codex Connector uses two actions:

1. `prepare_research_checkpoint` validates and signs the draft locally, then
   returns its exact hash without publishing anything.
2. `publish_prepared_research_checkpoint` accepts only the unchanged draft
   after `I_CONFIRM_PUBLISH_CHECKPOINT`, rechecks its local signature, and
   sends it to the remote admission boundary.

## Historical works and attribution

Historical work enters through authenticated `POST /api/me/research/sources`.
The request names a public problem slug, immutable source URL/object/revision,
content SHA-256, license, retrieval time, and source-backed contributor
entries. Proofweave stores:

- one immutable `external_works` provenance record;
- one explicit problem-revision link;
- contributor display names, roles, identifiers, evidence URLs, and an
  initial `source_asserted` status.

The explicit problem link is important: importing a paper for one conjecture
does not silently make it prior work for every catalog target. A checkpoint can
only cite works already linked to its exact problem revision.

An import never creates a Person delegation for a historical author, claims
that author joined Proofweave, verifies the source's mathematical content, or
issues a Receipt. Future curator and author-confirmation events may strengthen
the attribution status without rewriting the original assertion.

## Public projection

`GET /api/catalog/:slug/research-graph` and MCP
`inspect_research_graph` return:

- public checkpoint nodes without private signing material;
- a per-node evidence projection that separately rechecks the staged Bundle,
  accepted signed Runner result, independent signed review attestations, and a
  policy-valid signed Contribution Receipt when those records exist;
- explicit `derives_from` or `merges` edges;
- linked historical works, their source-backed attributions, and citation
  back-references;
- a truncation flag for bounded clients.

The target page renders this as a left-to-right layered DAG. A user may start
an independent root, continue an open tip, or synthesize branches. Choosing
“Continue branch” carries the exact parent node into the workbench and local
Codex brief; the parent is still not published until the owner approves the
signed checkpoint draft.

The evidence projection is intentionally layered. A node remains
`shared_unverified`; its `evidence.stage` may progress from `shared` through
`bundle_staged`, `kernel_accepted`, `review_recorded`, and `receipt_recorded`.
Every layer is derived from its own immutable record and signature. Missing,
malformed, tampered, or incorrectly bound evidence is ignored rather than used
to upgrade the display. A recorded Receipt is linked to the exact Attempt,
problem revision, Bundle, beneficiary Person/Agent/delegation, and compatible
contribution kind. It is displayed as a record, not folded into the checkpoint
state or treated as a permanent lifecycle claim.

## Deliberate limits

- Node withdrawal, supersession, and verification events have append-only
  schema space but no participant API in this slice.
- The graph records structured milestones, not raw exploration traces.
- Artifact bytes remain in the separate Bundle/object flow.
- Node counts are not contribution scores. Receipt links expose already-issued
  contribution records; downstream DAG impact and lifecycle-aware credit
  computation remain separate projections.
