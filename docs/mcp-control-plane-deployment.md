# Remote MCP control-plane deployment

This is the deployable boundary for the remote MCP resource server. It is
separate from the owner-only Sites frontend because a remote Codex client must
reach `/mcp` without a browser session, while every operation still requires a
Proofweave OAuth token.

## Non-negotiable topology

```text
Proofweave web control plane ─┐
Proofweave OAuth issuer      ─┼─ one shared D1 inline-evidence authority boundary
Remote MCP gateway           ─┘
```

Do not deploy the gateway against a newly created empty D1 database. It would
not see Persons, Agent delegations, OAuth clients, installations, Attempts, or
artifact indexes; it is therefore fail-closed but non-functional. Before a live
gateway rollout, migrate the web control plane to an external Cloudflare Worker
or otherwise bind all three services to the same externally managed D1
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
an issuer on the MCP resource origin, and missing or malformed Receipt issuer
metadata. It prints the exact non-secret gateway binding configuration after
validation. The Receipt private JWK is never read from this manifest or printed.
The command does not deploy or create a resource.

If the gateway will later request Runner jobs, prepare the separate Runner
manifest described in [`runner-deployment-preflight.md`](runner-deployment-preflight.md)
and compare both non-secret manifests before either Worker is deployed:

```bash
npm run alpha:deploy:preflight -- /secure/path/proofweave-mcp-alpha.json /secure/path/proofweave-runner-alpha.json
```

When the optional `runner` block is present, the MCP preflight renders the
non-secret `RUNNER_QUEUE`, image registry, control-plane key ID, and default
limits binding. It deliberately never renders
`RUNNER_CONTROL_PLANE_PRIVATE_KEY_JWK`; that matching private signing key is a
gateway-secret-provider responsibility. The pairwise check rejects any D1,
Queue, image, or control-plane key-ID mismatch. It does not create resources,
enable Runner execution, or prove provider-level Container isolation.

From the secret-provider execution environment only, run the additional
private-key pairing check before deployment:

```bash
npm run alpha:deploy:keys:verify -- /secure/path/proofweave-mcp-alpha.json /secure/path/proofweave-runner-alpha.json
```

It requires `PROOFWEAVE_RUNNER_CONTROL_PLANE_PRIVATE_KEY_JWK`,
`PROOFWEAVE_RUNNER_RESULT_PRIVATE_KEY_JWK`, and
`PROOFWEAVE_RECEIPT_ISSUER_PRIVATE_KEY_JWK` in that process environment. It
signs fixed challenge payloads and verifies them against the manifest public
keys, returning only their key IDs. It never accepts a key on the command line,
writes a key to disk, or prints a JWK. This proves secret/manifest pairing, not
that the Runner result or Receipt issuer key is already active in the externally
provisioned D1 registries.

After a deployment is reachable, run the credential-free live check against
that same manifest:

```bash
npm run mcp:deploy:verify -- /secure/path/proofweave-mcp-alpha.json
```

It follows no redirects and checks only the public discovery boundary: protected
resource metadata, authorization-server metadata, and the `401` MCP challenge.
It rejects a different issuer, a widened scope set, or a challenge that points
to another resource metadata URL. It never creates a Person, Agent,
installation, OAuth client, bearer token, Attempt, Bundle, Run, or Receipt.
The authenticated consent/revocation test in the live gate below remains a
separate operator exercise.

## Live gate

Only after the manifest passes and the following are true may an operator run
Wrangler deployment commands:

1. The same D1 has all repository migrations, including
   `0035_align_review_market_with_receipt_gates.sql`, the opaque remote-MCP
   rate-limit buckets, and the required owner records.
2. `inline_artifact_bytes` is present in the migrated shared D1; evidence is
   content-addressed, immutable, and each object remains within the 1 MB alpha
   limit.
3. The external identity origin has a real browser session, consent, recovery,
   and audit policy; dynamic registration remains disabled unless a finite,
   operator-reviewed client metadata allowlist is configured. The current Sites
   bridge remains closed-alpha only.
4. `MCP_RESOURCE_URL` and `OAUTH_ISSUER_URL` match public HTTPS origins.
5. A fresh unauthenticated `POST /mcp` returns the protected-resource challenge,
   and an OAuth browser flow creates a revocable Agent installation.
6. An integration test confirms a revoked installation’s old token receives no
   MCP access.
7. Set `RECEIPT_ISSUER_PRIVATE_KEY_JWK` as a gateway secret matching
   `receipt_issuer.public_key`. The preflight renders the matching key ID,
   public key, and activation time as non-secret bindings. Supplying only part
   of the four-value runtime set makes the gateway fail closed; omitting the
   whole set preserves reviews but leaves closure at `issuer_unavailable`.

If the gateway will expose `request_runner_run`, its manifest `runner` block
must name the same Queue consumed by the isolated Runner Worker, an exact
`RUNNER_APPROVED_IMAGES_JSON` registry, `RUNNER_DEFAULT_LIMITS_JSON`, and a
matching `RUNNER_CONTROL_PLANE_KEY_ID`. Set
`RUNNER_CONTROL_PLANE_PRIVATE_KEY_JWK` only as a gateway secret; the Runner
Worker receives only the matching public key in
`RUNNER_CONTROL_PLANE_ISSUER_KEYS_JSON`. Supplying only part of this set makes
the gateway fail closed. A queued Run is not proof execution or verification.

The isolated Lean runner is a later deployment boundary; see
[`runner-cloudflare-deployment.md`](runner-cloudflare-deployment.md).

## Closed-alpha client-registration setting

The owner-only Sites identity adapter keeps dynamic client registration off
unless `OAUTH_CLIENT_REGISTRATION_ALLOWLIST_JSON` is set to a finite JSON array
of exact client metadata, for example:

```json
[
  {
    "client_name": "Approved client",
    "redirect_uris": ["https://client.example/callback"]
  }
]
```

Treat every entry as an operator approval for that exact normalized name and
redirect-URI set. Do not use wildcards, accept arbitrary metadata, or set this
binding during the private alpha. The setting has no effect on the deliberately
unavailable standalone identity Worker; a future public identity deployment
must introduce an equivalent reviewed configuration deliberately.
