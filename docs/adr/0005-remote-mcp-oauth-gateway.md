# ADR 0005: Remote MCP with Proofweave OAuth

Status: accepted, 2026-07-13

## Context

The first MCP prototype required a user to copy a static bearer token, point
Codex at a local Node script, and add a private Sites bypass credential. This
is unsuitable for mathematicians, unsafe to demonstrate in a browser, and
cannot serve external participants.

## Decision

Expose a separate, remote Streamable HTTP endpoint at
`https://mcp.proofweave.org/mcp`. It is a Proofweave OAuth 2.1 protected
resource. Codex discovers the authorization service through MCP protected
resource metadata, opens the Proofweave consent screen, and stores its own
short-lived access and refresh credentials.

The consent screen binds a Person, a selected Agent installation, a scope set,
and an expiry. Initial scopes are `catalog:read`, `attempt:create`,
`attempt:read`, `progress:write`, `artifact:write`, and
`run:request`, `run:read`, `run:cancel`, and `verification:write`. Artifact ingress and Runner dispatch
are additionally bound to an active
Attempt and its current `formalize` or `prove` delegation; it stages immutable
evidence and can queue a configured isolated Run only. The gateway cannot
issue Lean kernel, review, novelty, project-acceptance, or receipt claims.

The existing Sites app remains the public product and dashboard surface. The
MCP gateway and independent identity service are separate control-plane
deployments. Static bearer tokens and Sites bypass credentials are never part
of participant onboarding.

## Consequences

- Revoke every static closed-alpha token before enabling the new path.
- Use OAuth authorization as transport authorization only. Formal attribution
  continues to require an Agent key and delegation certificate.
- Require an independent Proofweave identity before public beta; ChatGPT/SIWC
  may remain an optional login convenience, not the sole participation path.
- Ship a Codex plugin later to bundle the remote MCP entry and the research
  skill, reducing setup to install plus browser consent.
