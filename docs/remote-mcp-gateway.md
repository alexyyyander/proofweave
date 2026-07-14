# Remote MCP gateway contract

## User experience

1. A Person installs the private-beta Proofweave Research plugin and asks
   Codex to run `connect_proofweave`.
2. The local Connector generates its Ed25519 Agent key on that computer,
   creates a PKCE request, and opens Proofweave in a browser.
3. The Person signs in, sees the local/network privacy boundary, and approves
   that exact Agent's 30-day formalize/prove delegation.
4. The browser returns a single-use authorization code to the Connector's
   loopback callback.
5. Codex can now call bounded research tools without seeing a raw Proofweave
   credential, ChatGPT session, or local workspace.

The browser cannot silently configure a local application. The initial user
action remains an explicit approval button; the plugin only removes manual key
and endpoint entry.

## Required HTTP surface

```text
Remote MCP gateway: mcp.proofweave.org
POST /mcp                                  Streamable HTTP MCP endpoint
GET  /.well-known/oauth-protected-resource Resource metadata

Proofweave Identity: auth.proofweave.org (public beta) or the same private
Proofweave Sites origin (local-Connector beta)
GET  /.well-known/oauth-authorization-server Authorization-server metadata
GET  /authorize                             Person sign-in and consent
POST /token                                 OAuth code and refresh exchange
POST /register                              Optional; only for an operator allowlist
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
| `put_artifact_object` | `artifact:write` | One bounded immutable D1-inline object (at most 1 MB in alpha); no execution or proof claim |
| `stage_artifact_bundle` | `artifact:write` | One signed Bundle storage/provenance record and `bundle_staged` event; no run, review, or receipt |
| `request_runner_run` | `run:request` | One idempotent Queue request for a staged v2 or v3 Bundle; queued is not a Lean result |
| `get_runner_run` | `run:read` | Exact Agent-bound Run projection and immutable event hashes; Runner evidence is not independent review or a receipt |
| `cancel_runner_run` | `run:cancel` | Idempotent cancellation for that exact Agent-bound Run; a running container must still acknowledge terminal cancellation evidence |
| `request_verification_replay` | `verification:replay` | One accepted-assignment-bound fresh workspace Run; records reproducibility evidence, not an attestation |
| `get_verification_replay` | `verification:replay` | The selected review Agent's own fresh replay Run and immutable event hashes; after a terminal result, its citeable replay evidence hash |
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

`run:request` needs the same exact active `formalize` or `prove` installation
and Attempt binding as artifact staging. It accepts only the hash of an
already-staged signed v2 or v3 Bundle, re-hashes the canonical D1-inline
evidence, and
selects an image only from the deployment-owned Lean/Mathlib allowlist. The
idempotency key binds one Attempt to one immutable Runner request; a Queue
retry can resend that request but cannot create a different Run. A queued Run
does not imply a Container start, kernel acceptance, independent review, or a
receipt.

`run:read` and `run:cancel` repeat that same exact active
Agent/certificate/Attempt binding before looking up a Run. They cannot be used
by another Agent owned by the same Person to enumerate or control its sibling's
Run. A cancellation before execution becomes a terminal `cancelled` projection;
the retained Queue delivery is harmless because Runner preflight skips a
terminal Run. A running Run becomes `cancel_requested` and reaches terminal
state only after its isolated Runner produces the signed result evidence. A
lost cancellation response may be retried without appending another event or
changing the first cancellation timestamp.

`verification:replay` and `verification:write` can be granted only to an
installation whose active certificate has `review` scope. A replay additionally
requires an accepted assignment addressed to the OAuth Person. Its immutable
record binds that assignment, the selected reviewer Agent/certificate/
installation, the assignment Bundle, and a newly isolated Run; it cannot read,
cancel, or reuse the submitting Agent's ordinary Run. The submitted Attestation
must repeat that exact Person, Agent, certificate, and Agent public key; signed
event verification remains a separate protocol gate.

## Deployment boundary

```text
Proofweave web + dashboard     proofweave.org
Remote MCP gateway             mcp.proofweave.org/mcp
Proofweave identity + consent  auth.proofweave.org
Isolated Lean runner           runner.proofweave.org
```

The private local-Connector beta temporarily mounts the resource and
authorization routes on the Proofweave Sites origin so it can share its
closed-alpha D1 binding. It still exposes the standards-required `/mcp` and
`/.well-known/*` paths. It is not a public multi-tenant topology: participant
invites require the D1 migrations, independent identity, rate-limit review,
and the separate public origins above.

The gateway is a Cloudflare Worker-compatible service with D1-backed consent,
client, Agent-installation, and audit records. The Lean runner remains isolated
and never receives the MCP user's OAuth access token.

## Implementation status

The repository now contains Worker-compatible gateway and identity-service
modules, protected-resource and authorization-server discovery, stateless
Streamable HTTP request handling, PKCE authorization-code and refresh-rotation
protocol logic, a D1 credential-hash store, scope-gated tool definitions, and
a D1-backed store for public catalog reads, delegated Attempts, provisional
progress, bounded immutable artifact/Bundles staging, assignment-bound
`verification:replay` Runs, and `verification:write` attestations. It can also turn a staged v2 or v3 Bundle into an idempotent signed
Runner Queue message, but only when the Runner Queue, image registry, fixed
limits, and control-plane signing key are all explicitly configured. Its
source-level Run tools expose only the selected Agent's Run and permit
idempotent cancellation; they do not assert a Lean result or synthesize Runner
evidence. Its
Cloudflare deployment entrypoint requires explicit `DB`, `MCP_RESOURCE_URL`,
and `OAUTH_ISSUER_URL` bindings and fails closed when any are absent. The
closed-alpha artifact adapter stores verified, content-addressed bytes in D1
with a 1 MB object cap; the retained R2 adapter is a later scaling path, not a
runtime requirement. The store accepts an
Attestation only from the OAuth-selected review Agent installation, hides
assignments addressed to another Person, and delegates immutable
signature/evidence checks to the verification store. Stateless handling
deliberately verifies OAuth on every tool request rather than relying on memory
local to one Worker isolate.

The deployment entrypoint also emits one privacy-minimal structured event per
HTTP boundary. It includes a generated opaque correlation ID, method,
path, status, duration, and outcome; it deliberately excludes query strings,
headers, bearer tokens, MCP arguments, identities, artifact bytes, and
exception text. The console sink is non-blocking: logging failures cannot alter
an MCP response. This is source-level audit instrumentation only, not a
deployed retention, metrics, tracing, or alerting service.

The deployable runtime also applies D1-atomic fixed-window request limits
before each authorized tool operation. Limits are aggregated by Person rather
than Agent installation, so creating extra Agents cannot increase an owner's
transport capacity. The rate-limit table stores only a SHA-256 bucket digest,
window, count, and update time; it never stores bearer tokens, raw Person IDs,
Agent IDs, MCP arguments, or mathematical evidence. Counters are trimmed after
the short closed-alpha retention window. This remains source-level protection
until load-tested and paired with deployed abuse response and operator policy.

Dynamic client registration is closed by default. The authorization-server
metadata omits `/register` unless deployment configuration supplies a finite,
operator-reviewed allowlist of exact client names and redirect URIs. For the
private Sites adapter, that configuration is the optional
`OAUTH_CLIENT_REGISTRATION_ALLOWLIST_JSON` binding; the standalone identity
Worker remains unavailable and does not read it. An enabled allowlist gives
repeated registration of identical metadata one deterministic D1 client ID
rather than minting unbounded client records. This avoids treating an arbitrary
redirect URI posted by a remote client as enrollment authority.

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
- load validation for the source-level quotas, consent/audit retention policy,
  abuse response, and an operator-managed dynamic-client allowlist;
- token audience and scope enforcement at the HTTP boundary;
- a shared Queue producer/consumer, approved Runner image registry, fixed
  Runner limits, and matching public/private control-plane signing keys before
  `request_runner_run` is enabled;
- Agent registration and delegation selection in the consent screen;
- rate-limit load/abuse validation, deployed audit-log retention, revocation,
  abuse reporting, metrics/tracing, and alerting;
- protocol fixtures for authorization failures, cross-owner access, and scope
  escalation.
