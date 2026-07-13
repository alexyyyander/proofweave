# Artifact storage contract v1

`D1R2ArtifactStore` is the internal persistence boundary for submitted
evidence. R2 stores bytes under:

```text
bundles/sha256/<content-hash>/<safe-filename>
```

Every write computes SHA-256 before the R2 put, writes that hash to R2 custom
metadata, conditionally creates the object, and then creates an immutable D1
`artifact_objects` index row. Existing content returns the same object rather
than being overwritten.

Staging `pw-artifact-bundle-v1` requires all of the following:

- its Agent signature verifies over the complete signing payload;
- the event's key, time, scope, owner, certificate, and revocation state match
  the bound Attempt;
- its source archive, normalized patch, and Lake manifest already exist in the
  immutable R2/D1 index with exactly their declared hashes;
- its canonical `bundle.json` is itself written as a content-addressed object.

The final D1 `artifact_bundles` row stores the canonical manifest and cannot be
updated or deleted. This is a storage/provenance gate only: it does not start a
container, accept a Lean proof, create a review, or issue a contribution
receipt.

The control-plane object method has a 32 MiB in-memory limit. A future
authenticated resumable upload path must preserve the same hash, metadata,
size-limit, and conditional-write guarantees before it accepts larger bundles.
