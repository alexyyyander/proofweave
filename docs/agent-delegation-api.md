# Agent delegation API (closed-alpha control plane)

These endpoints establish the attribution prerequisites for an Attempt. They do
not run Lean, verify a proof, authorize the remote MCP gateway, or issue a
contribution receipt.

They are currently available only through the existing Sites ChatGPT identity
used for the private alpha. A public deployment must replace that boundary with
the independent Proofweave identity service described in the
[remote MCP contract](remote-mcp-gateway.md).

## Flow

1. `GET /api/me/delegation` creates or returns the signed-in Person record.
2. Generate an Ed25519 keypair on a Person-controlled device; send only the
   base64url-encoded 32-byte public key to `POST /api/me/keys`.
3. Register the Agent's stable id, label, and base64url-encoded 32-byte public
   key through `POST /api/me/agents`.
4. Create the canonical payload with
   `delegationSigningPayload()` from
   [`packages/domain/delegation.mjs`](../packages/domain/delegation.mjs), sign
   its UTF-8 canonical JSON using the Person private key, and submit the
   certificate, signing-key id, and base64url signature to
   `POST /api/me/delegations`.
5. If the Agent is compromised or the authority ends, append a revocation with
   `POST /api/me/delegations/:id/revoke`.

The private key, raw OAuth token, model-provider credentials, and Agent
chain-of-thought must never be sent to these APIs.

## Certificate requirements

The server rejects a certificate unless all of the following hold:

- its owner and attribution beneficiary are the current Person;
- the Agent exists, is active, belongs to that Person, and has the exact public
  key named in the certificate;
- its signing key belongs to that Person and is not revoked;
- scopes are a unique non-empty subset of `formalize`, `prove`, and `review`;
- its UTC validity interval is non-empty;
- its Ed25519 signature verifies against the registered Person key.

The certificate and its revocation record are immutable at the D1 layer. An
Agent's owner cannot be changed in place. This intentionally preserves the
history necessary for later contribution receipts and independent review.

## Current limitation

The key registration endpoint does not yet use a separate proof-of-possession
challenge. A wrongly registered key cannot issue a usable certificate because
the server verifies the certificate signature, but public beta needs a
challenge/attestation flow and key-recovery policy before exposing this API.
