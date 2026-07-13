# Proofweave Codex plugin

`plugins/proofweave-research/` is the distributable source package for the
Proofweave Codex workflow. Its only capability today is the
`proofweave-research` Skill: it guides a local Codex session through pinned
Lean work, reproducible evidence capture, and truthful status language.

The repository keeps the canonical Skill at
`skills/proofweave-research/`. The plugin copies the Skill and its MCP-tool
reference so it can be installed as a Codex plugin. `npm run plugin:check`
requires both copies to match exactly and validates the plugin manifest before
the usual project checks succeed.

## Current boundary

The plugin deliberately contains no `.mcp.json`, endpoint URL, local bridge,
or static Proofweave token. The public-facing gateway is not deployed, so any
such configuration would either expose a credential or send users to a
placeholder. A session using this plugin therefore continues local Lean work
when Proofweave MCP tools are absent and makes no claim that it created a
remote Attempt, Bundle, Run, verification, or Contribution Receipt.

The former local stdio bridge remains retired for participant-facing use. Do
not add it to the plugin or ask a participant to copy an API token.

## Release sequence

1. Keep the bundled Skill aligned with the canonical source and run
   `npm run plugin:check`.
2. Publish the plugin source through the intended Codex marketplace or local
   plugin distribution channel. The repository does not modify a developer's
   personal marketplace configuration.
3. Deploy the separate Proofweave identity and MCP control plane with its
   shared D1/R2 bindings, approved OAuth client metadata, and deployment
   preflight from `docs/mcp-control-plane-deployment.md`.
4. Only after that deployment is independently reachable, introduce a reviewed
   plugin release containing the exact remote OAuth MCP connection. It must use
   browser consent and revocable OAuth credentials, never a copied token.

The deployed endpoint, scopes, and authorization boundaries are specified in
[`docs/remote-mcp-gateway.md`](remote-mcp-gateway.md). This source package does
not imply that those external services are live.
