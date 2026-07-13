# Proofweave receipt issuer

`d1-contribution-receipt-store.mjs` is the internal-only persistence and
issuance boundary for `pw-contribution-receipt-v1`. It rebuilds evidence from
immutable staged Bundle, Run/result, and Attestation records before asking the
protocol package to apply its conservative policy and sign the receipt.

The store has no route, browser action, or participant-supplied receipt JSON
input. The issuer private key is passed only by a future control-plane secret
provider; it is never written to D1. `contribution_receipts` rows are append
only and have immutable evidence identity. Before issuing a receipt, the store
requires every declared upstream receipt to exist with the exact hash, a valid
issuer signature, and passing policy evidence; it atomically projects those
declarations into immutable `contribution_receipt_dependency_edges` rows.

The separate web reader exposes verified receipt and dependency JSON plus a
human-readable receipt page. It also exposes a separately signed, append-only
correction, supersession, or retraction history: an original receipt is never
modified or deleted. The reader cannot issue or alter receipts. Issuer-key
rotation is handled by the operator-only
`d1-contribution-receipt-issuer-key-store.mjs`: it keeps exactly one active
signing key, retires a predecessor before activating its successor, and records
immutable activation/retirement/revocation audit events. Historical receipts
retain their embedded key and are trusted only within the registered key's
validity window. The public reader exposes the non-secret registry through
`GET /api/receipts/issuer-keys`; it cannot mutate key state.
