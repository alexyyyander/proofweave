# Proofweave remote MCP gateway

This Worker-compatible service is the participant-facing replacement for the
retired local bridge. It exposes a Streamable HTTP MCP endpoint and the OAuth
discovery endpoints Codex needs before it can open Proofweave browser consent.

## Current implementation boundary

The MCP transport, protected-resource metadata, stateless request handling,
scope checks, and tool contract are implemented. Stateless handling is
intentional: each short-lived tool request is freshly OAuth-authorized, so no
access token or MCP session needs to be retained in a Worker isolate. OAuth
discovery, authorization, and token issuance are owned by the separate
[`proofweave-identity`](../proofweave-identity) service.

The source includes a D1-backed gateway store for source-pinned public catalog
reads, delegated Attempt creation, provisional progress, and one externally
signed review-Agent attestation, plus bounded immutable artifact-object and
signed Bundle staging. Attempt creation must select `formalize` or
`prove`; the store derives the Agent label and certificate from the selected
OAuth installation and requires that exact certificate scope. Reads and
progress remain bound to that same Agent/certificate pair, including for two
Agents owned by one Person.

When every Runner binding is explicitly supplied, the gateway can also accept
`run:request` for an exact active Attempt and staged v2 Bundle. It rechecks the
canonical D1 inline-evidence manifest and Agent signature, chooses the single
operator-approved image matching the Bundle's Lean/Mathlib environment, and
persists an idempotent signed Queue request. A queued Run is operational work
only: it is never represented as a Lean result, review, or receipt. With no
Runner configuration, this tool reports that dispatch is unavailable instead
of falling back to a local executor or simulated result.

`run:read` and `run:cancel` are also constrained to the same exact active
Agent/certificate and Attempt. They expose only the immutable Run projection
and event hashes belonging to that Attempt; another Agent of the same owner
cannot inspect or cancel it. Cancellation is idempotent: a queued/preparing
Run becomes terminally cancelled and is skipped if its Queue delivery arrives;
a running Run records a cancellation request until its isolated runner returns
signed terminal evidence. Neither tool creates verification, review, or a
receipt.

For an accepted assignment addressed to the OAuth Person, a review-scoped
installation may instead use `verification:replay`. The
`request_verification_replay` tool maps the assignment's immutable v2 Bundle
to one new isolated Run and records immutable replay provenance containing the
assignment, reviewer Person/Agent/certificate/installation, Bundle, Run, and
idempotency key. The resulting fresh workspace is not the submitting Agent's
Run and does not give the reviewer `run:*` authority over that Attempt.
`get_verification_replay` is likewise limited to the exact review Agent
installation. A replay result is reproducibility infrastructure evidence only;
it never completes the assignment or replaces the separately signed
`verification:write` attestation.

The `verification:write` adapter binds an Attestation to the selected OAuth
installation, requires its delegation to include `review`, and then lets the
verification store recheck assignment, evidence, revocation, timestamp,
payload hash, and Ed25519 signature. It receives attribution context, never the
raw OAuth token. After the claim is durable, an optional operator-configured
Receipt coordinator re-reads the immutable Bundle, primary accepted Run, all
required different-owner attestations, and active issuer registry. The client
cannot supply a Receipt payload or choose its beneficiary, kind, Run, or key.

`cloudflare-worker.mjs` is the deployment entrypoint. It composes the D1 token
store, D1 inline gateway store, and stateless resource server from `DB`,
`MCP_RESOURCE_URL`, and `OAUTH_ISSUER_URL` bindings. Missing or
invalid bindings fail closed with `503`; it never silently falls back to an
in-memory store.

Automatic closure is enabled only when all four issuer settings are present:
`RECEIPT_ISSUER_KEY_ID`, `RECEIPT_ISSUER_PUBLIC_KEY`,
`RECEIPT_ISSUER_PRIVATE_KEY_JWK` (secret), and
`RECEIPT_ISSUER_ACTIVATED_AT`. Missing all four leaves signed reviews durable
with `issuer_unavailable`; a partial or mismatched set fails runtime startup.

For the provider-neutral Turso path, set `RUNNER_QUEUE_MODE=d1` instead of a
Cloudflare Queue binding. The gateway then writes the same signed queue
envelope to migration `0032`'s durable lease table that the trusted Runner
polls. This mode is valid only when MCP/OAuth and the Runner use the exact same
external migrated database. It still requires the approved image registry,
control-plane key ID/private JWK, and default limits; partial configuration or
combining D1 mode with a provider Queue binding fails closed.

A scale-to-zero trusted Runner can be woken after (and only after) the signed
queue delivery is durable. Configure `RUNNER_WAKE_URL` with the exact HTTPS
`/v1/wake` endpoint and `RUNNER_WAKE_TOKEN` as a shared secret. For a private
host such as a private Hugging Face Space, also configure the host's bounded
read token as `RUNNER_WAKE_HOST_AUTHORIZATION_TOKEN`. The client allows up to
60 seconds for a free host's cold start. A provider rejection is reported as
`wake_failed`; a timeout or transport failure is reported as
`wake_unconfirmed`, because the authenticated request may still have reached
the host. Neither state rolls back or loses the durable job.
The wake endpoint cannot receive a workspace, Bundle, Run payload, or signing
material.

The deployed runtime also uses a D1-atomic fixed-window limiter before every
authorized tool operation. Its quotas aggregate on the Person root rather than
on an Agent installation, so parallel Agents cannot multiply a participant's
transport capacity. It stores only short-lived SHA-256 Person/operation bucket
digests and counters—not bearer tokens, raw identities, MCP arguments, or
contribution evidence. Load validation and abuse-response operations remain
pre-deployment gates.

Do not deploy this as a public participant service until a production identity
adapter implements browser session handling, authorization-code PKCE, refresh
rotation, consent, client registration policy, token audience validation, and
revocation.

## Deployment contract

```text
https://mcp.proofweave.org/mcp
https://mcp.proofweave.org/.well-known/oauth-protected-resource
https://auth.proofweave.org/.well-known/oauth-authorization-server
https://auth.proofweave.org/authorize
https://auth.proofweave.org/token
```

The transport remains dependency-injected for tests. The deployment entrypoint
uses the shared D1 token store only for resource-server authentication; OAuth
account handling and consent remain outside the gateway and must stay separate
from the isolated Lean runner.
