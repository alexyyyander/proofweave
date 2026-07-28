# Portable Proofweave Codex marketplace

This document specifies the build and validation contract for the
GitHub-independent Proofweave Codex plugin package. Product-facing installation
copy lives separately from this release-engineering reference.

## Release artifacts

`npm run plugin:package` deterministically writes:

- `public/downloads/proofweave-research-marketplace.tar`
- `public/downloads/proofweave-research-marketplace.tar.sha256`
- `public/downloads/proofweave-research-marketplace.json`

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

The JSON file is a deterministic, machine-readable release manifest:

```json
{
  "schemaVersion": "pw-codex-plugin-distribution-v1",
  "marketplaceName": "proofweave-private-beta",
  "pluginName": "proofweave-research",
  "pluginVersion": "<from .codex-plugin/plugin.json>",
  "archive": {
    "path": "/downloads/proofweave-research-marketplace.tar",
    "filename": "proofweave-research-marketplace.tar",
    "sha256": "<64 lowercase hexadecimal characters>",
    "bytes": 0
  },
  "compatibility": {
    "protocolVersion": "<from the canonical compatibility contract>",
    "connectorApiVersion": 1,
    "toolSchemaVersion": 1
  }
}
```

The archive hash and byte count are computed from the final tar bytes. Plugin
and compatibility versions are parsed from the exact plugin files being
packaged and checked against the canonical compatibility contract. The
manifest intentionally contains no timestamp, Git commit, host path,
credential, or environment-specific value.

## Deterministic build contract

The builder rejects:

- symbolic links and non-regular filesystem entries;
- absolute paths, parent traversal, and backslash paths;
- invalid marketplace metadata;
- an invalid plugin manifest;
- manifest component paths that escape the plugin root.

It emits sorted POSIX ustar entries with fixed ownership, modes, and timestamps
so the same source bytes produce the same archive bytes.
All three artifacts are first written into a temporary sibling directory. The
builder then replaces the public files with rename operations and publishes the
distribution manifest last. A failed replacement rolls back every file already
replaced, and temporary staging files are removed.

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
- distribution schema, plugin version, archive size, and compatibility values;
- the complete local plugin layout;
- absence of common private-key and GitHub-token material;
- local Codex marketplace discovery and plugin installation.

The Codex CLI smoke test extracts the archive into temporary directories and
uses an isolated `CODEX_HOME` and `HOME`. It sets unreachable proxy endpoints
so successful installation cannot depend on network access. A missing CLI, or
a CLI build without plugin commands, is reported as a test skip. Once the
commands are available, a marketplace or plugin installation error is a test
failure.
