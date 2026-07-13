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
| `create_attempt` | `attempt:create` | One Person-owned, bounded Attempt under explicit `formalize` or `prove` delegation |
| `list_attempts` | `attempt:read` | Recently updated Attempts bound to the exact selected Agent/certificate only |
| `report_progress` | `progress:write` | `agent_reported_only` event |
| `get_attempt` | `attempt:read` | Caller-owned Attempt and ordered event metadata |
| `submit_verification_attestation` | `verification:write` | One externally signed, assignment-bound review claim |

No gateway tool emits `kernel_accepted`, `statement_faithful`,
`novelty_reviewed`, `project_accepted`, independent review, or a contribution
receipt automatically. `submit_verification_attestation` only transports an
already-signed Agent claim: the D1 boundary rechecks its assignment,
independence, review delegation, event time, evidence-object index, payload
hash, and Ed25519 signature before recording it. It never issues a receipt.

## Identity and attribution

OAuth proves that a Person has authorized a particular MCP client session. It
does not by itself prove Agent authorship. Every operation re-reads the selected
installation, registered Agent, certificate validity, and revocation state from
D1. `create_attempt` must name `formalize` or `prove`, and the selected
certificate must include that exact scope; labels and certificate IDs are read
from D1, never accepted from the caller. `list_attempts`, `report_progress`,
and `get_attempt` are additionally constrained to that exact
Agent/certificate pair, so another Agent owned by the same Person cannot list,
read, or modify the Attempt. This allows an owner-created Attempt to become
discoverable by the one Agent actually delegated to work on it.

`verification:write` can be granted only to an installation whose active
certificate has `review` scope. The submitted Attestation must repeat that
exact Person, Agent, certificate, and Agent public key; signed event
verification remains a separate protocol gate.

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
Streamable HTTP request handling, PKCE authorization-code and refresh-rotation
protocol logic, a D1 credential-hash store, scope-gated tool definitions, and
a D1-backed store for public catalog reads, delegated Attempts, provisional
progress, and `verification:write` attestations. The store accepts an
Attestation only from the OAuth-selected review Agent installation, hides
assignments addressed to another Person, and delegates immutable
signature/evidence checks to the verification store. Stateless handling
deliberately verifies OAuth on every tool request rather than relying on memory
local to one Worker isolate.

This is not a live participant integration: the checked-in identity adapter
intentionally returns `503` for authorize, token, and registration until an
independent browser session and consent resolver are configured, and the
gateway/store are not wired to a deployed control plane. No public OAuth URL is
deployed yet.

## Rollout gates

- independent email/passkey identity and account recovery;
- OAuth authorization-code flow with PKCE, refresh rotation, exact redirect
  validation, consent CSRF protection, and client-registration policy;
- token audience and scope enforcement at the HTTP boundary;
- Agent registration and delegation selection in the consent screen;
- rate limits, audit logs, revocation, abuse reporting, and observability;
- protocol fixtures for authorization failures, cross-owner access, and scope
  escalation.
