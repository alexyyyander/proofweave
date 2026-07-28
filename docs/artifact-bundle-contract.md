# Artifact Bundle contract v1, v2, and v3

Every Lean submission is an immutable, content-addressed manifest—not a
free-form upload. Every version binds one Attempt, pinned problem revision,
target declaration and statement hash, Lean environment, shell-free `lake env
lean` command, dependency receipts, Agent signature, `sorry` policy, and axiom
allowlist.

The Agent signature covers every evidence field plus the Agent event ID, time,
and public key. It excludes the signature and `payloadHash` fields themselves
to avoid a circular hash. The canonical manifest hash moves through D1, Runner
evidence, independent replay, and receipts; it does not itself prove kernel
acceptance or authorship.

## v1: historical evidence

`pw-artifact-bundle-v1` records a source archive, normalized patch, a Lake
manifest, and a claimed tree hash. It remains valid for stored provenance,
inspection, and receipts. Its archive format, safe extraction rules, patch
semantics, and tree-hash construction were not fixed tightly enough for a
hostile-code execution boundary.

The Runner resolver can therefore inspect v1 evidence but the Runner preflight
will never claim a v1 Bundle for isolated execution.

## v2: provider-neutral executable workspace evidence

`pw-artifact-bundle-v2` moves object locations into `workspace` and fixes the
reconstruction contract. It is the default executable format and does not name,
fetch, or authenticate against a Git hosting provider. An executable Bundle
must include:

- `workspace.archive`: exactly `source.tar.zst`, `format: "tar.zst"`, maximum
  expanded byte/file counts, and `symlinkPolicy: "forbidden"`;
- `workspace.patch`: exactly `normalized.patch`, a unified diff applied with
  strip level 1 and `allowFuzz: false`;
- `workspace.lakeManifest`: exactly `lake-manifest.json`, written to the
  workspace root after the patch;
- `workspace.tree`: a final `pw-tree-v1` hash with state
  `after_patch_and_lake_manifest`;
- a Lean toolchain and Mathlib revision that must match the Runner's
  operator-approved, digest-pinned image.

An implementation must reconstruct a v2 workspace in this exact order:

1. Extract the zstd tar archive into an empty workspace, rejecting absolute or
   traversal paths, duplicate paths, symlinks, hard links, devices, FIFOs, and
   all non-regular files. Enforce the manifest's expanded-byte and file-count
   limits while extracting.
2. Apply the Git-style `normalized.patch` once with
   `patch --batch --forward --fuzz=0 -p1`. Reject a patch that escapes the
   workspace, uses a non-content operation, is reversed, or needs fuzz.
3. Replace the root `lake-manifest.json` with the referenced immutable object.
4. Recompute the final `pw-tree-v1` hash and require an exact match before the
   supplied argument-array entry command may run.

The Run's disk allowance must be at least the Bundle's declared maximum
expanded workspace size. The current resolver enforces this before a Run moves
from `queued` to retryable `preparing`; only a verified private workspace
handoff may subsequently move it to `running`. The transfer/executor must
enforce the same limit during extraction.

## v3: optional GitHub provenance

`pw-artifact-bundle-v3` keeps the complete executable v2 workspace and adds a
signed `repositorySnapshot` with a GitHub `owner/name`, a full lowercase
40-character commit SHA, and `public` or `private` visibility. This makes the
participant's intended source revision explicit without granting the Runner
any GitHub token or network access. It is a signed provenance reference only:
the current alpha does not fetch or authenticate against private repositories.
It is never required merely to execute a Run, and it does not make the evidence
more kernel-valid than the identical provider-neutral v2 workspace.

## `pw-tree-v1`

`pw-tree-v1` is the canonical JSON payload:

```json
{
  "protocolVersion": "pw-tree-v1",
  "entries": [
    {
      "path": "Proofweave/Main.lean",
      "mode": 420,
      "contentHash": "sha256:<file-bytes-hash>"
    }
  ]
}
```

Entries contain every final regular file, sorted by bytewise POSIX path.
Directories are implicit; paths must be relative, non-empty, use safe segments,
and contain no backslashes or traversal. Modes are normalized to `0644` or
`0755`; each content hash is the SHA-256 of that file's bytes. The overall tree
hash is the SHA-256 of this canonical JSON. The protocol implementation lives
in [`packages/protocol/workspace-tree.mjs`](../packages/protocol/workspace-tree.mjs).

## Storage and compatibility

The immutable D1-inline staging boundary uses a version-neutral list of the three
referenced objects (archive, patch, Lake manifest), so it accepts valid signed
v1, v2, and v3 evidence. New executable Runs require v2 or v3; v2 is the
provider-neutral default and v3 is only the same executable workspace with an
optional GitHub provenance reference. Historical v1 rows remain unchanged and
inspectable. The storage rules are in
[`artifact-storage-contract.md`](artifact-storage-contract.md).
