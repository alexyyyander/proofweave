# Artifact storage contract v2

`D1InlineArtifactStore` is the selected closed-alpha persistence boundary for
submitted evidence without object storage. D1 stores bounded bytes under the
canonical key:

```text
bundles/sha256/<content-hash>/<safe-filename>
```

Every write computes SHA-256 before the D1 conditional insert and then creates
an immutable D1 `artifact_objects` index row. Existing content returns the same
object rather than being overwritten. Each object is limited to 1,000,000
bytes, so alpha is deliberately not a large-file transport.

When an `ARTIFACT_BUCKET` R2 binding is configured, the deployment uses
`D1HybridArtifactBucket`: objects up to 1,000,000 bytes stay inline in D1, and
larger objects are written to R2. Reads check the inline table first and then
R2, so evidence written before the binding remains readable. The R2-backed
control-plane object limit is 32,000,000 bytes. The MCP ingress and Runner
default `outputBytes` follow the same bound: 1,000,000 inline, 32,000,000 with
R2. The binding is not part of the current production configuration.

Staging `pw-artifact-bundle-v1`, `pw-artifact-bundle-v2`, or
`pw-artifact-bundle-v3` requires all of the
following:

- its Agent signature verifies over the complete signing payload;
- the event's key, time, scope, owner, certificate, and revocation state match
  the bound Attempt;
- its source archive, normalized patch, and Lake manifest already exist in the
  immutable D1 byte/index records with exactly their declared hashes;
- its canonical `bundle.json` is itself written as a content-addressed object.

The final D1 `artifact_bundles` row stores the canonical manifest and cannot be
updated or deleted. A successful first stage also derives one immutable,
owner-visible `provisional_contributions` evidence record from the bound
Attempt and delegation, then appends one idempotent `bundle_staged` Attempt
event and refreshes the Attempt's activity timestamp. The immediate record is
strictly `evidence_bundle` / `bundle_staged`: it does not label the Bundle a
lemma, proof patch, counterexample, or final author contribution. See the
[provisional contribution ledger contract](provisional-contribution-contract.md).

This remains a storage/provenance gate only: it does not start a container,
accept a Lean proof, create a review, establish novelty, or issue a
Contribution Receipt.

The remote MCP control-plane ingress accepts one unpadded-base64url object at a
time under `artifact:write`, and accepts no more than the configured decoded
byte limit: 1,000,000 without object storage, 32,000,000 with the hybrid R2
binding. It first binds the OAuth-selected Agent/certificate to the active
Attempt and requires that Attempt's current `formalize` or `prove` authority.
The R2 path preserves the same hash, metadata, conditional-write, and
provenance guarantees; it is not a resumable upload API.
