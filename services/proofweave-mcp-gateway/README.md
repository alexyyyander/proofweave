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
signed review-Agent attestation. Attempt creation must select `formalize` or
`prove`; the store derives the Agent label and certificate from the selected
OAuth installation and requires that exact certificate scope. Reads and
progress remain bound to that same Agent/certificate pair, including for two
Agents owned by one Person.

The `verification:write` adapter binds an Attestation to the selected OAuth
installation, requires its delegation to include `review`, and then lets the
verification store recheck assignment, evidence, revocation, timestamp,
payload hash, and Ed25519 signature. It receives attribution context, never the
raw OAuth token, and cannot issue a contribution receipt.

Do not deploy either default worker as a public participant service. Configure
a production identity adapter that implements authorization-code PKCE, refresh
rotation, consent, client registration policy, token audience validation, and
revocation first.

## Deployment contract

```text
https://mcp.proofweave.org/mcp
https://mcp.proofweave.org/.well-known/oauth-protected-resource
https://auth.proofweave.org/.well-known/oauth-authorization-server
https://auth.proofweave.org/authorize
https://auth.proofweave.org/token
```

The gateway receives an injected `identityProvider` and `store`. This keeps
OAuth account handling, D1 access, and the isolated Lean runner out of the MCP
transport module.
