# Remote MCP control-plane deployment

This is the deployable boundary for the remote MCP resource server. It is
separate from the owner-only Sites frontend because a remote Codex client must
reach `/mcp` without a browser session, while every operation still requires a
Proofweave OAuth token.

## Non-negotiable topology

```text
Proofweave web control plane ─┐
Proofweave OAuth issuer      ─┼─ one shared D1 + R2 authority boundary
Remote MCP gateway           ─┘
```

Do not deploy the gateway against a newly created empty D1 database. It would
not see Persons, Agent delegations, OAuth clients, installations, Attempts, or
artifact indexes; it is therefore fail-closed but non-functional. Before a live
gateway rollout, migrate the web control plane to an external Cloudflare Worker
or otherwise bind all three services to the same externally managed D1/R2
resources.

## Operator manifest

Copy `services/proofweave-mcp-gateway/deployment-manifest.example.json` outside
the repository and replace all values with the actual external resources and
HTTPS origins. It intentionally contains no credentials.

Run:

```bash
npm run mcp:deploy:preflight -- /secure/path/proofweave-mcp-alpha.json
```

The command rejects placeholders, non-HTTPS origins, an invalid D1 identifier,
and an issuer on the MCP resource origin. It prints the exact gateway binding
configuration after validation. It does not deploy or create a resource.

## Live gate

Only after the manifest passes and the following are true may an operator run
Wrangler deployment commands:

1. The same D1 has all repository migrations (including the opaque remote-MCP
   rate-limit buckets) and the required owner records.
2. The R2 bucket is private and contains only content-addressed evidence.
3. The external identity origin has a real browser session, consent, recovery,
   and audit policy; dynamic registration remains disabled unless a finite,
   operator-reviewed client metadata allowlist is configured. The current Sites
   bridge remains closed-alpha only.
4. `MCP_RESOURCE_URL` and `OAUTH_ISSUER_URL` match public HTTPS origins.
5. A fresh unauthenticated `POST /mcp` returns the protected-resource challenge,
   and an OAuth browser flow creates a revocable Agent installation.
6. An integration test confirms a revoked installation’s old token receives no
   MCP access.

The isolated Lean runner is a later deployment boundary; see
[`runner-cloudflare-deployment.md`](runner-cloudflare-deployment.md).
