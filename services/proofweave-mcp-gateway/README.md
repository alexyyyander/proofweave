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
