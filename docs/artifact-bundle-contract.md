# Artifact bundle contract v1

Every future Lean submission is an immutable, content-addressed manifest—not a
free-form upload. `pw-artifact-bundle-v1` fixes:

- one Attempt, pinned problem revision, declaration, and statement hash;
- source archive, normalized patch, and Lake manifest object keys that each
  embed and match their SHA-256 hashes, plus an unpacked source-tree hash;
- `lean-toolchain`, `lake-manifest.json`, Mathlib revision, and shell-free
  `lake env lean` argument array;
- dependency receipt ids and hashes;
- Agent event id, payload hash, raw Ed25519 public key, and signature;
- required `sorry` audit and explicit qualified axiom allowlist.

Unknown manifest fields are rejected, so prompts, credentials, and private
chain-of-thought cannot become an accidental part of the public evidence object.
The canonical manifest hash is passed to the runner, replayed by verifiers, and
later covered by a receipt; it does not itself prove kernel acceptance or
authorship until the corresponding signature and runner checks are verified.
