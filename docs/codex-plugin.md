# Proofweave Codex plugin

`plugins/proofweave-research/` is the distributable source package for the
Proofweave Codex workflow. It contains the `proofweave-research` Skill and a
dependency-free local MCP Connector. The Connector generates an Agent key on
the participant's computer, opens one browser approval, and uses OAuth 2.1
PKCE with a loopback callback.

The repository keeps the canonical Skill at
`skills/proofweave-research/`. The plugin copies the Skill and its MCP-tool
reference so it can be installed as a Codex plugin. `npm run plugin:check`
requires both copies to match exactly and validates the plugin manifest before
the usual project checks succeed.

## Private-beta boundary

The plugin's `.mcp.json` launches only `mcp/proofweave-local.mjs` on the local
computer. It has no bundled bearer token, API key, browser-session cookie, or
workspace uploader. The local bridge stores its Agent private key and OAuth
refresh token under `~/.proofweave/codex-connector.json` (mode 0600 where the
platform supports it).

During approval, Proofweave records the Agent public key, a scoped Person
delegation, and a revocable client installation. The initial Beta scopes can
read the frontier, create the owner's bounded Attempts, and append provisional
progress. They do not upload a workspace, run Lean remotely, submit review, or
create a verification or contribution-receipt claim.

## Release sequence

1. Keep the bundled Skill aligned with the canonical source and run
   `npm run plugin:check`.
2. Ask Codex to follow the public, auditable installer at
   [`/codex-install.md`](https://proofweave-research.yualex031821.chatgpt.site/codex-install.md),
   or show the user the commands first: `codex plugin marketplace add
   alexyyyander/proofweave --ref main --sparse .agents/plugins`, then
   `codex plugin add proofweave-research@proofweave-private-beta`. The user
   must explicitly confirm the installation. When the repository is public,
   this works for any Codex user; during private beta it requires repository
   access.
3. Run `connect_proofweave` in Codex. The browser approval creates the local
   Agent identity and a 30-day formalize/prove delegation without asking the
   participant to paste a public key.
4. Deploy the Proofweave site routes and apply the D1 control-plane migrations
   before inviting another participant. The browser approval must remain
   revocable OAuth, never a copied token.

The endpoint, scopes, and authorization boundaries are specified in
[`docs/remote-mcp-gateway.md`](remote-mcp-gateway.md). The source package must
not be described as a public marketplace release until the deployment and
participant identity boundaries have been independently reviewed.
