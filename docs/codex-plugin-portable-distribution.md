# Portable Proofweave Codex marketplace

This document specifies the build and validation contract for the
GitHub-independent Proofweave Codex plugin package. Product-facing installation
copy lives separately from this release-engineering reference.

## Release artifacts

`npm run plugin:package` deterministically writes:

- `public/downloads/proofweave-research-marketplace.tar`
- `public/downloads/proofweave-research-marketplace.tar.sha256`

The tar archive has no wrapper directory. After extracting it into an empty
directory, that directory is the marketplace root and contains:

```text
.agents/plugins/marketplace.json
plugins/proofweave-research/
```

The marketplace entry uses the local source
`./plugins/proofweave-research`. The extracted directory can therefore be
passed directly to `codex plugin marketplace add` without repository access or
a network installer. The package contains no copied authentication token,
private key, or user workspace.

The checksum file uses the standard
`<sha256><two spaces><filename>` format accepted by
`shasum -a 256 -c` when run beside the archive.

## Deterministic build contract

The builder rejects:

- symbolic links and non-regular filesystem entries;
- absolute paths, parent traversal, and backslash paths;
- invalid marketplace metadata;
- an invalid plugin manifest;
- manifest component paths that escape the plugin root.

It emits sorted POSIX ustar entries with fixed ownership, modes, and timestamps
so the same source bytes produce the same archive bytes.

The release sequence is:

1. Keep the bundled Skill aligned with the canonical source.
2. Run `npm run plugin:package`.
3. Run `npm run plugin:check`.
4. Commit the tar and checksum together so public bytes cannot drift from their
   source.

## Validation

`npm run plugin:package:check` verifies:

- archive path safety;
- marketplace and plugin manifest contracts;
- SHA-256 digest and checked-in bytes;
- byte-for-byte determinism across repeated builds;
- the complete local plugin layout;
- absence of common private-key and GitHub-token material;
- local Codex marketplace discovery and plugin installation.

The Codex CLI smoke test extracts the archive into temporary directories and
uses an isolated `CODEX_HOME` and `HOME`. It sets unreachable proxy endpoints
so successful installation cannot depend on network access. A missing CLI, or
a CLI build without plugin commands, is reported as a test skip. Once the
commands are available, a marketplace or plugin installation error is a test
failure.
