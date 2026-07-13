# Remote MCP gateway contract

## User experience

1. A Person selects **Connect Codex** in Proofweave.
2. Codex adds `https://mcp.proofweave.org/mcp` as a remote MCP server.
3. Codex receives an authorization challenge and opens Proofweave in a browser.
4. The Person signs in, selects an Agent installation, reviews scopes, and
   grants consent.
5. Codex can now call bounded research tools without seeing a raw Proofweave
   credential.

The browser cannot silently configure a local application. The only initial
client action is adding the remote service URL; a future Codex plugin bundles
that entry automatically.

## Required HTTP surface

```text
Remote MCP gateway: mcp.proofweave.org
POST /mcp                                  Streamable HTTP MCP endpoint
GET  /.well-known/oauth-protected-resource Resource metadata

Proofweave Identity: auth.proofweave.org
GET  /.well-known/oauth-authorization-server Authorization-server metadata
GET  /authorize                             Person sign-in and consent
POST /token                                 OAuth code and refresh exchange
POST /register                              Optional dynamic client registration
```

Unauthenticated MCP requests return `401` with a `WWW-Authenticate` header
that includes the protected-resource metadata URL. Access tokens are
audience-bound to `https://mcp.proofweave.org/mcp`.

## Initial tool contract

| Tool | Scope | Result boundary |
| --- | --- | --- |
| `list_frontier_problems` | `catalog:read` | Pinned catalog records only |
| `inspect_problem` | `catalog:read` | Statements and provenance, never an inferred proof result |
| `create_attempt` | `attempt:create` | One Person-owned, bounded Attempt |
| `report_progress` | `progress:write` | `agent_reported_only` event |
| `get_attempt` | `attempt:read` | Caller-owned Attempt and ordered event metadata |

No gateway tool emits `kernel_accepted`, `statement_faithful`,
`novelty_reviewed`, `project_accepted`, independent review, or a contribution
receipt.

## Identity and attribution

OAuth proves that a Person has authorized a particular MCP client session. It
does not by itself prove Agent authorship. Before any submission can enter the
verification pipeline, the selected Agent must have a registered public key and
an active delegation certificate. Signed event verification remains a separate
protocol gate.

## Deployment boundary

```text
Proofweave web + dashboard     proofweave.org
Remote MCP gateway             mcp.proofweave.org/mcp
Proofweave identity + consent  auth.proofweave.org
Isolated Lean runner           runner.proofweave.org
```

The gateway is a Cloudflare Worker-compatible service with D1-backed consent,
client, Agent-installation, and audit records. The Lean runner remains isolated
and never receives the MCP user's OAuth access token.

## Implementation status

The repository now contains Worker-compatible gateway and identity-service
modules, protected-resource and authorization-server discovery, stateless
Streamable HTTP request handling, and scope-gated tool definitions. Stateless
handling deliberately verifies OAuth on every tool request rather than relying
on memory local to one Worker isolate. They are protocol scaffolding, not a live
participant integration: the checked-in identity
adapter intentionally returns `503` for authorize, token, and registration,
and the gateway store is unconfigured. No public OAuth URL is deployed yet.

## Rollout gates

- independent email/passkey identity and account recovery;
- OAuth authorization-code flow with PKCE, refresh rotation, exact redirect
  validation, consent CSRF protection, and client-registration policy;
- token audience and scope enforcement at the HTTP boundary;
- Agent registration and delegation selection in the consent screen;
- rate limits, audit logs, revocation, abuse reporting, and observability;
- protocol fixtures for authorization failures, cross-owner access, and scope
  escalation.
