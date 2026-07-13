# Proofweave receipt issuer

`d1-contribution-receipt-store.mjs` is the internal-only persistence and
issuance boundary for `pw-contribution-receipt-v1`. It rebuilds evidence from
immutable staged Bundle, Run/result, and Attestation records before asking the
protocol package to apply its conservative policy and sign the receipt.

The store has no route, browser action, or participant-supplied receipt JSON
input. The issuer private key is passed only by a future control-plane secret
provider; it is never written to D1. `contribution_receipts` rows are append
only and have immutable evidence identity. Dependency edges, correction,
retraction, key rotation, JSON downloads, and public receipt pages are separate
future work.
