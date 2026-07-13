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

Proofweave Identity: auth.proofweave.org (public beta) or the private
Proofweave Sites origin (closed alpha)
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
| `put_artifact_object` | `artifact:write` | One bounded immutable R2/D1 object; no execution or proof claim |
| `stage_artifact_bundle` | `artifact:write` | One signed Bundle storage/provenance record and `bundle_staged` event; no run, review, or receipt |
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

`artifact:write` is additionally bound to the exact selected Agent/certificate
and its active Attempt: object ingress and Bundle staging require that the
Attempt is active and its current `formalize` or `prove` delegation remains
valid. The stored Bundle independently rechecks the signed Agent event's key,
historical delegation time, revocation state, and every referenced immutable
object. The limited base64url object tool is not a resumable upload protocol
and never starts an execution.

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
progress, bounded immutable artifact/Bundles staging, and `verification:write`
attestations. Its Cloudflare deployment entrypoint now requires explicit `DB`,
`ARTIFACTS`, `MCP_RESOURCE_URL`, and `OAUTH_ISSUER_URL` bindings and fails
closed when any are absent. The store accepts an
Attestation only from the OAuth-selected review Agent installation, hides
assignments addressed to another Person, and delegates immutable
signature/evidence checks to the verification store. Stateless handling
deliberately verifies OAuth on every tool request rather than relying on memory
local to one Worker isolate.

The separate identity Worker remains deliberately unavailable by default. The
private Sites alpha now has an alternative Worker-mounted authorization adapter:
it uses the existing signed-in Sites session to locate the already-created
Person, persists a five-minute one-use consent challenge, binds the POST to an
HttpOnly `SameSite=Lax` CSRF cookie, lists only active Agents whose delegation
covers the requested scopes, and creates or reuses one installation after the
Person approves. Neither the Agent nor Codex sees the browser session or a
copied Proofweave secret. A key, Agent, or delegation revocation invalidates
that installation on every authorization and resource-server read.

This is still not a live participant integration: the remote gateway has no
deployed public URL or control-plane bindings, and the Sites identity bridge is
owner-only and has no independent account recovery. Before a public rollout,
deploy a provider-neutral identity service and keep the same consent/PKCE
boundary.

## Rollout gates

- independent email/passkey identity, account linking, and recovery;
- production rate limits, consent/audit retention policy, and dynamic-client
  registration policy;
- token audience and scope enforcement at the HTTP boundary;
- Agent registration and delegation selection in the consent screen;
- rate limits, audit logs, revocation, abuse reporting, and observability;
- protocol fixtures for authorization failures, cross-owner access, and scope
  escalation.
