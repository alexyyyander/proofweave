# On-chain anchor contract v1

Proofweave anchors the canonical hashes of its verifiable records—contribution
receipts, public research checkpoints, and evidence bundles—as batches in an
append-only, chain-anchored Merkle log. Anchoring proves three things and no
more: a record hash existed at time T, it has not changed since, and batches
were appended in an order the platform cannot rewrite retroactively. It does
not prove mathematical correctness, novelty, or authorship, and no raw
evidence bytes or personal data ever reach the chain—only SHA-256 hashes.

The design is chain-agnostic. A pluggable adapter layer (`evm` and `tron`,
with `solana` still a stub) carries the same four-field payload. EVM uses
calldata; TRON uses a transfer memo. The protocol implementation lives in
[`packages/protocol/anchor-leaf.mjs`](../packages/protocol/anchor-leaf.mjs),
[`packages/protocol/merkle-tree.mjs`](../packages/protocol/merkle-tree.mjs),
[`packages/protocol/anchor-manifest.mjs`](../packages/protocol/anchor-manifest.mjs),
and [`packages/protocol/anchor-witness.mjs`](../packages/protocol/anchor-witness.mjs).

## Records and leaves

Each anchorable record maps to exactly one leaf:

```json
{
  "protocolVersion": "pw-anchor-leaf-v1",
  "recordType": "contribution_receipt",
  "recordId": "receipt:alice-1",
  "recordHash": "sha256:<64 hex>"
}
```

`recordHash` is the record's own canonical protocol hash. The mapping is fixed
per record type:

| Anchor `recordType` | Canonical hash function | Protocol module |
| --- | --- | --- |
| `contribution_receipt` | `contributionReceiptHash(receipt)` | [`packages/protocol/contribution-receipt.mjs`](../packages/protocol/contribution-receipt.mjs) |
| `research_checkpoint` | `researchCheckpointHash(checkpoint)` | [`packages/protocol/research-checkpoint.mjs`](../packages/protocol/research-checkpoint.mjs) |
| `evidence_bundle` | `artifactBundleHash(bundle)` | [`packages/protocol/artifact-bundle.mjs`](../packages/protocol/artifact-bundle.mjs) |

`artifactBundleHash` already covers the workspace tree, so bundles are anchored
by bundle hash alone—no separate tree-hash leaf exists. Leaves are
whitelist-normalized (`protocolVersion`, `recordType`, `recordId`,
`recordHash`; unknown fields rejected; `recordHash` must be `sha256:<hex>`;
`recordId` at most 256 characters). The leaf hash is

```
leafHash = sha256(0x00 ‖ canonicalJson(anchorLeaf))
```

—the RFC6962 leaf step, applied exactly once inside `anchorLeafHash`. The
`recordType` field participates in the hash, giving domain separation across
record types. Intake (`enqueueAnchorRecord` in
[`services/anchoring/anchor-intake.mjs`](../services/anchoring/anchor-intake.mjs))
computes the leaf hash at enqueue time and inserts idempotently on the
`(recordType, recordId, recordHash)` unique constraint. Until a batch claims a
record, `batch_id` stays `NULL` (pending). Contribution Receipt issuance
enqueues its leaf best-effort immediately after the receipt's own transaction
commits
([`services/receipts/d1-contribution-receipt-coordinator.mjs`](../services/receipts/d1-contribution-receipt-coordinator.mjs));
an intake failure is recorded through the structured audit and never fails
issuance, and the unique constraint keeps any later retry idempotent.

## Merkle tree and inclusion proofs

`buildMerkleTree(leafHashes)` consumes already-leaf-hashed values and never
re-applies the `0x00` prefix:

- internal nodes: `sha256(0x01 ‖ left ‖ right)`;
- tree shape: split at `k`, the largest power of two smaller than `n`
  (RFC6962 MTH, no last-leaf duplication), fixed so every implementation
  produces the same root;
- empty tree: `sha256("")`—an algorithmic definition only; no batch is ever
  created with zero leaves.

Leaf order is deterministic: ascending `(recordType, recordId, recordHash)`.
The same leaf set therefore always yields the same root.

An inclusion proof is `{ path: [{ hash, position }] }`. **`path` is ordered
leaf-first: the deepest sibling (adjacent to the leaf) is `path[0]`, and the
root-most sibling is last.** Each `position` says whether that sibling hashes
on the `left` or `right` of the running node. This is the wire-visible format
returned by `GET /api/anchors/proof` (a deviation from the original
root-first sketch, recorded in the implementation plan under Task 2).
`verifyInclusionProof(leafHash, proof, root)` consumes the path in array
order: for each step it computes
`sha256(0x01 ‖ sibling ‖ current)` when `position` is `"left"`, otherwise
`sha256(0x01 ‖ current ‖ sibling)`, and compares the result to `root`.

## Manifests

Each batch has a canonical manifest under `pw-anchor-manifest-v1`:

```json
{
  "protocolVersion": "pw-anchor-manifest-v1",
  "batchId": "anchor-batch:<uuid>",
  "root": "sha256:<64 hex>",
  "leafCount": 3,
  "prevBatchId": null,
  "prevRoot": null,
  "createdAt": "2026-10-14T00:00:00.000Z",
  "leaves": [
    { "recordType": "contribution_receipt", "recordId": "receipt:a", "recordHash": "sha256:…" }
  ]
}
```

`leaves` carries every `{recordType, recordId, recordHash}` triple, sorted by
`(recordType, recordId, recordHash)`; canonicalization sorts out-of-order
input, so the manifest hash is order-independent. `manifestHash` is the
SHA-256 of the canonical JSON. `verifyAnchorManifest` rebuilds the tree from
the leaves and requires an exact root and leaf-count match (structural errors
return `false`, never throw).

Manifests are stored content-addressed under key `anchors/<manifestHash>`
(canonical UTF-8 bytes) in the optional R2 binding `ANCHOR_MANIFEST_BUCKET`
([`services/anchoring/anchor-manifest-storage.mjs`](../services/anchoring/anchor-manifest-storage.mjs)).
Even if the platform API is down, anyone with the manifest copy and a chain
read can verify independently.

## Batch chain and the append-only head log

A batch row (`anchor_batches`) records `status`, `root`, `leaf_count`,
`manifest_hash`, `manifest_key`, `prev_batch_id`, `prev_root`, `chain`,
`network`, and `witness_count`. The genesis batch has `prev_batch_id` and
`prev_root` `NULL`. Each batch's `chain:network` is its single canonical
network; anchoring to another network means another batch with its own chain.

Append-only serialization does not use a mutable single-row head. Instead,
`anchor_log_head.version` is itself the PRIMARY KEY: `createBatch` ends its
transaction with an `INSERT` claiming `version = expected + 1`. When a
concurrent build has already committed that version, the primary-key conflict
fails the statement and D1/libSQL rolls the whole batch transaction back
atomically—that conflict **is** the compare-and-swap. The in-transaction
guard also re-inserts the observed head version whenever a leaf failed to
bind or the observed `(version, prevBatchId, prevRoot)` triple no longer
matches, closing the silent-fork case
([`services/anchoring/d1-anchor-store.mjs`](../services/anchoring/d1-anchor-store.mjs)).
Every head change appends a new row, so the head history is retained and
auditable; `getLogHead()` reads the highest version (0 is the seeded genesis
row with no batch).

Batch selection snapshots pending records inside the same transaction: only
`batch_id IS NULL` rows are claimed, so a record is never covered by two
batches. A builder takes at most 96 pending records per batch, keeping the
96 leaf updates plus four metadata statements within libSQL's 100-statement
transaction limit. The trigger threshold (default 100 pending records) is
separate from this capacity: overflow stays pending until a later count/time
trigger. The builder refuses
empty batches, and the coordinator refuses to submit if rebuilding the
manifest from the immutable projection does not round-trip to the recorded
`manifest_hash`.

Batch status flows `built → submitted → confirmed`, or a batch ends `failed`
only by operator abandonment. Confirmation status and witness status are
orthogonal: `witness_count` (distinct confirmed witness submitters) never
overrides or blocks the batch status.

### Abandoning a failed batch

A new batch requires a confirmed predecessor. The coordinator returns
`awaiting_predecessor` (including `predecessorBatchId`) while the log tip is
unfinished; `force` cannot bypass this rule. The store enforces the same rule
inside the build transaction, so direct or concurrent builders cannot bypass
it. Confirmation polling continues while creation is deferred. After a failed
tip has been inspected, the operator can use `abandonBatch` below and rerun
the tick. This does not automatically rewrite pre-upgrade logs that already
have successors of a failed batch; those require separate recovery review.

`abandonBatch` is allowed only when the batch has **no pending and no
confirmed submission**, and only when it is still the log tip. In one
transaction it releases the batch's records back to pending, appends a new
head row (version + 1) pointing at the abandoned batch's `prev` pointers, and
marks the batch `failed`. The abandoned root therefore drops out of the
append chain: `prevRoot` pointers only ever reference truly anchored batches.
If any submission confirmed, abandonment is refused—retry targets the same
`batchId`/`root` idempotently instead.

## On-chain payload (EVM and TRON)

The anchored payload is exactly four fields:

```
bytes32 root | bytes32 manifestHash | uint256 leafCount | bytes32 prevRoot
```

- Exactly 256 hex characters of calldata; `encodeAnchorCalldata` /
  `decodeAnchorCalldata` in
  [`services/anchoring/evm-anchor-adapter.mjs`](../services/anchoring/evm-anchor-adapter.mjs)
  are the reference codec.
- Genesis `prevRoot` (`NULL` off-chain) is encoded as 32 zero bytes; a
  decoded all-zero word maps back to `null`, so the judgment is unambiguous.
- The transaction is a calldata memo sent to a fixed sink address. The
  `batchId` never goes on-chain—it exists for local correlation only. A
  minimal event-registry contract is the planned future evolution; the codec
  fields stay the same.
- `txRef` is the chain-agnostic reference `<chain>:<network>:<txId>` (EVM:
  the transaction hash). Adapters are resolved from `ANCHOR_ADAPTERS_JSON`
  (a JSON array of `{id, network, rpcUrl, sinkAddress,
  operatorPrivateKeyJwk, confirmationThreshold}`); the `evm` factory
  lazy-imports `ethers` v6 only when an `evm` config is present. The
  `tron` factory lazy-imports TronWeb 6.5.1. Only `solana` remains a stub.
- TRON uses a 1 SUN transfer to the configured sink; `raw_data.data` contains
  the same 128 bytes as EVM calldata. The SDK constructs and signs the
  transaction locally. A successful broadcast response or an exact-byte transaction lookup is required before
  returning `tron:<network>:<64 lowercase hex characters>`. If broadcast
  status is uncertain, inspect the transaction before retrying.
- TRON confirmation requires a receipt and successful transaction from
  `/walletsolidity`, in addition to the configured depth measured from the
  current full-node block. Full-node visibility alone is insufficient.
  Supported network labels are `nile`, `shasta`, and `mainnet`; configure the
  matching RPC endpoint. Public-testnet acceptance does not validate mainnet.
  See [TRON confirmation semantics](https://developers.tron.network/docs/confirmation-semantics).
- Read-only EVM and TRON adapters require only `network` and `rpcUrl` (plus an optional
  confirmation threshold). They read payloads and confirmations without a
  wallet or private key. `prepareRoot` (and the one-shot `submitRoot` helper)
  requires a signing key and sink. Replaying a persisted transaction requires
  the public operator and sink configuration, but no private key.
  An optional public `operatorAddress` supplies the platform identity for
  witness checks; witness admission fails closed if that identity is unknown.
  If both the public address and a signing key are configured, they must match.
  Transaction references must name the adapter's configured network.
- Confirmation has two layers: the adapter reports `confirmed` once
  confirmations reach its per-adapter `confirmationThreshold` (default 12),
  and the coordinator additionally requires the batch to meet
  `ANCHOR_CONFIRMATION_THRESHOLD` before flipping status.
- Key custody: the operator key is a secp256k1 JWK whose `d` member is a
  hosted secret (same pattern as `RUNNER_CONTROL_PLANE_PRIVATE_KEY_JWK`). It
  never enters contributor environments or Lean sandboxes. Transactions carry
  only the four anchor fields, so key rotation does not change any batch
  content.

## Witness submissions

`POST /api/anchors/:batchId/witness` lets an independent party anchor the same
root with their own on-chain transaction. The request is an authenticated JSON
body `{payload, signature, txRef}` up to 16 KiB. The Ed25519 signature covers
the canonical JSON of

```json
{
  "protocolVersion": "pw-anchor-witness-v1",
  "batchId": "anchor-batch:…",
  "root": "sha256:…",
  "manifestHash": "sha256:…",
  "txRef": "evm:base-sepolia:0x…"
}
```

encoded over canonical UTF-8, base64url, verified against the submitter's
registered Person signing keys or active Agent keys bound by a currently
valid delegation (`pw-anchor-witness-v1` in
[`packages/protocol/anchor-witness.mjs`](../packages/protocol/anchor-witness.mjs),
authority assembly in `app/lib/anchor-routes.ts`).

The coordinator applies five gates, in order, before anything is persisted
([`services/anchoring/anchor-coordinator.mjs`](../services/anchoring/anchor-coordinator.mjs)):

| # | Gate | Rejection reason |
| --- | --- | --- |
| 0 | Batch exists, is not failed, and the signed payload attests exactly what would be recorded (`protocolVersion`, `batchId`, `txRef`, `root`, `manifestHash` all match) | `unknown_batch` / `batch_failed` / `payload_mismatch` |
| 1 | Signature verifies against a Person/Agent key with a valid delegation | `invalid_signature` |
| 2 | `txRef` parses as `<chain>:<network>:<txId>` and matches the batch's canonical chain and network | `invalid_txref` / `network_mismatch` |
| 3 | `readAnchoredRoot(txRef)` exists on-chain and carries the batch's exact `root`, `manifestHash`, `leafCount`, `prevRoot` | `chain_truth_mismatch` |
| 4 | On-chain sender differs from the platform operator address, and the txRef is not a recorded platform submission | `not_independent` |
| 5 | Persistence: `recordSubmission` → `getConfirmation` → `updateSubmissionStatus` → `syncWitnessCount` | — |

A witness must therefore complete a real on-chain anchoring of their own.
Gate 3 is what stops forged txRefs from inflating counts; gate 4 stops
reusing the platform's transaction. Repeats are safe: the same witness
resubmitting the same txRef is accepted idempotently without double
counting, while anyone else claiming an already-recorded txRef is rejected
as `not_independent`. `witness_count` only counts confirmed witness
submissions with distinct submitter IDs; a submission confirmed later (e.g.
below threshold at POST time) is picked up by `pollConfirmations`.

HTTP mapping for rejections: `unknown_batch` and `batch_failed` → 404;
`not_independent` → 403; `payload_mismatch`, `invalid_signature`,
`invalid_txref`, `network_mismatch` (error code `chain_mismatch`),
`chain_truth_mismatch` → 400. Unauthenticated requests get 401; requests
without an adapter for the batch's network get 409 `anchoring_disabled`.

Witness POSTs are rate limited to 6 requests per 60 seconds per submitter
(`submit_anchor_witness` policy); over-limit requests get 429 with a
`retry-after` header.

## Verification

Full verification is `verifyAnchorRecord` in
[`services/anchoring/anchor-verifier.mjs`](../services/anchoring/anchor-verifier.mjs),
shared by the API and the CLI:

1. Recompute the record's canonical hash from the record JSON with the
   type's own protocol hash function.
2. Locate the anchor record by `(recordType, recordId, recordHash)`.
3. Recompute `leafHash` and compare it to the stored leaf hash.
4. Require the batch to be `confirmed` with a confirmed platform submission;
   read the transaction from `txRef` and compare all four fields: `root`,
   `manifestHash`, `leafCount`, and `prevRoot`. Query the current confirmation
   state separately. A failed transaction returns `mismatch`; insufficient
   confirmations return `pending`; RPC errors fail the CLI with exit code 1.
   The CLI requires `ANCHOR_CONFIRMATION_THRESHOLD` (default 12) in addition
   to the adapter's own confirmation threshold.
5. Check `prevRoot` continuity against the previous batch (genesis: both
   prev pointers `NULL`).
6. Rebuild the tree from the batch manifest leaves, derive the record's leaf
   index, generate the inclusion proof, and verify it against the batch root.
   Reconstruct the complete canonical manifest and compare its hash with
   `manifestHash`, binding the predecessor, batch ID, timestamp, and leaf count
   as well as the leaves. This check also applies to the public proof endpoint.
7. Output `verified`, `mismatch` (with a reason), or `pending`.

### CLI

```
node scripts/verify-anchor-proof.mjs --type <type> --record <path|-> [--batch <id>] [--local <dbPath>]
```

- `--type` is `contribution_receipt`, `research_checkpoint`, or
  `artifact_bundle` (`evidence_bundle` is accepted as an alias; bundle types
  map to leaf recordType `evidence_bundle`); `--record` is a canonical record
  JSON file or `-` for stdin (the object must carry a non-empty string `id`).
- The store is a local SQLite/libSQL file via `--local`, or remote via
  `TURSO_DATABASE_URL` with `TURSO_AUTH_TOKEN` (required for remote mode);
  `.env.local` is loaded when present.
- On-chain adapters come from `ANCHOR_ADAPTERS_JSON` (`ethers` is
  lazy-loaded only for `evm` configs). Without an adapter for the batch's
  chain:network, a structurally valid anchor is reported `pending`, never
  `verified`. `--batch` overrides the batch whose network resolves the
  adapter.

| Exit code | Meaning |
| --- | --- |
| 0 | verified |
| 1 | argument/IO or configuration error |
| 2 | mismatch |
| 3 | pending or unanchored |

Note: the CLI accepts the bundle type as `artifact_bundle` (the record
protocol's own name) and translates it to the anchor-leaf spelling
`recordType: "evidence_bundle"` (`packages/protocol/anchor-leaf.mjs`) for
anchor-store lookups. `--type evidence_bundle` is accepted as an alias; both
spellings hash the record with `artifactBundleHash` and match bundle rows
stored under the canonical leaf type.

## Public API

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/anchors` | Batch summaries (id, status, root, leafCount, manifestHash, prev pointers, chain/network, witnessCount, timestamps) |
| GET | `/api/anchors/:batchId` | The batch's canonical manifest |
| GET | `/api/anchors/proof?type=&recordId=&recordHash=` | Leaf view, `leafHash`, inclusion `path` (leaf-first), `root`, batch summary with txRefs, and submissions |
| POST | `/api/anchors/:batchId/witness` | Witness submission (see above) |

The three GETs are anonymous and read-only. Cached responses: batch list
`max-age=30, s-maxage=120`; manifests `max-age=300, s-maxage=86400,
immutable` (manifests are immutable); proofs `max-age=15, s-maxage=60`; a
proof mismatch returns 409 with `no-store`. 404/500 responses carry no
explicit `no-store`—a known minor gap. A proof response never claims
`verified`; on-chain comparison is the CLI/verifier's job with an adapter.

## Operations

### Trigger thresholds

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `ANCHOR_BATCH_MIN_LEAVES` | 100 | Build when pending records ≥ this |
| `ANCHOR_BATCH_MAX_INTERVAL_SECONDS` | 86400 | Build when the latest batch is at least this old |
| `ANCHOR_CONFIRMATION_THRESHOLD` | 12 | Confirmations required before a batch is `confirmed` |
| `ANCHOR_WITNESS_THRESHOLD` | 1 | Documented witness threshold in `.env.example`; not yet consumed by code (only `witness_count` is tracked) |

A coordinator tick builds when pending records are non-empty and any of:
forced, the leaf threshold is met, no batch exists yet (first-run baseline,
so initial records are not starved by the interval timer), or the interval
has elapsed. Zero pending records → no batch (never an empty append). The
deployment-level trigger is `npm run anchor:tick` once per interval, which
drives the coordinator's build, confirmation polling, and crash recovery;
the cron schedule itself is deployment configuration. Crash recovery
recovers `built` batches using the same persisted signed transaction and txRef.
It never creates a replacement signature for an existing outbox entry.

### The anchor tick script

`scripts/anchor-tick.mjs` runs one **single-shot** tick, in order:
`resumeUnfinishedBatches()` → `maybeBuildAndSubmit({ lastBatch })` (with the
store's latest batch) → `pollConfirmations()`, then prints a JSON summary
(`{ status: "ok", recoveredBatches, batchCreated, …, confirmedBatches,
failedBatches }`) to stdout.

- Anchoring is off exactly when `ANCHOR_ADAPTERS_JSON` is absent or blank:
  the tick prints `{ status: "anchoring_disabled" }` and exits 0 without
  reading the store.
- A batch build that loses the log-head CAS race (`AnchorStoreConflictError`)
  is never retried in-process: the tick prints a conflict summary
  (`{ status: "conflict", … }`) and exits 0 — the next cron run is the retry.
- The database is remote (`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`) or local
  via `--local <dbPath>` for smoke testing; `.env.local` is loaded when
  present, and the same threshold variables and defaults as the table above
  apply.
- Manifest persistence from the Node-side tick: with all four `R2_S3_ENDPOINT`,
  `R2_MANIFEST_S3_BUCKET`, `R2_S3_ACCESS_KEY_ID`, and `R2_S3_SECRET_ACCESS_KEY`
  values set (R2's S3-compatible API, SigV4), the tick PUTs content-addressed
  manifests to the same bucket exposed to Workers as the `ANCHOR_MANIFEST_BUCKET`
  binding. Without them the tick keeps manifests reconstructible from the
  immutable batch projection (the same fallback the public manifest route uses).
  With multiple configured adapters, the first `ANCHOR_ADAPTERS_JSON` entry is
  the platform adapter that builds and confirms batches.
- Exit codes: 0 when the tick ran (including conflict and disabled outcomes);
  1 for argument, configuration, IO, expired-transaction or legacy-recovery errors;
  2 for confirmation polling errors or failed batches.

### Enable/disable

Anchoring is off exactly when `ANCHOR_ADAPTERS_JSON` is absent or blank;
reads then report `anchoring_disabled` and witness POSTs are refused with 409
(unless historical batches exist, in which case reads stay enabled). This is
distinct from the threshold variables: missing thresholds fall back to the
documented defaults above, never disable anchoring.

**Ops note:** `ANCHOR_ADAPTERS_JSON` is only checked for non-emptiness on
read paths, so a malformed non-empty value is treated as *enabled* on reads
and surfaces as a 500 on witness POST (adapter registry construction throws).
Validate the JSON before rollout.

### Failed batches

A submission that reverts or is dropped leaves the batch `submitted` for
operator action: either retry (same `batchId`/`root`, idempotent) or
abandon per the rules above (tip-only, no pending/confirmed submissions).
Submission status transitions `pending → confirmed|failed` are terminal and
immutable; submissions on a failed batch can no longer transition.

Every state change appends an immutable event row to `anchor_batch_events`
(`batch_built`, `platform_submitted`, `submission_confirmed`,
`submission_failed`, `witness_count_synced`, `batch_confirmed`,
`batch_abandoned`), alongside the projection, in the same transaction.


### Durable platform submission (migration 0048)

The coordinator writes the canonical signed transaction and its txRef to
`anchor_submission_outbox` before broadcasting. A batch has one immutable
outbox entry. Concurrent preparers use the first persisted entry. A failed
outbox write prevents broadcast, including when the write acknowledgement is
lost. Recovery reads that entry, checks the transaction identity, operator,
destination and complete anchor payload, then queries the chain or broadcasts
the same signed transaction. EVM also validates the RPC chain ID.

TRON transactions that have expired and cannot be found on-chain stop with an
error. EVM nonce conflicts also stop without selecting a new nonce. A duplicate
RPC error alone is not acceptance evidence; the adapter must find the expected
transaction. The `submitRoot` helper remains a one-shot convenience and does not
provide persistence guarantees; platform ticks must use the coordinator.

Migration 0048 marks pre-existing `built` batches `legacy_unknown`, because an
old worker may have broadcast without recording the transaction ID. These rows
require manual chain reconciliation; automatic recovery fails rather than
signing again. Pause all tick writers and let in-flight requests finish before
applying 0048, then deploy the new worker before any tick resumes. Do not run an
old worker against the new outbox protocol or remove an outbox row to retry.

This prevents a database or response failure from producing a new transaction
identity. It does not make the blockchain and database one atomic transaction,
and it cannot guarantee progress through expired transactions or unavailable RPCs.
