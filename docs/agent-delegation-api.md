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
3. Request a one-time five-minute challenge with
   `POST /api/me/keys/:id/proof-challenge`, sign the canonical payload from
   `personKeyProofChallengeSigningPayload()` in
   [`packages/protocol/person-key-proof.mjs`](../packages/protocol/person-key-proof.mjs),
   and submit its id and base64url signature to `POST /api/me/keys/:id/proof`.
   A proof event is idempotent only for the exact same challenge and signature.
4. Register the Agent's stable id, label, and base64url-encoded 32-byte public
   key through `POST /api/me/agents`.
5. Create the canonical payload with
   `delegationSigningPayload()` from
   [`packages/domain/delegation.mjs`](../packages/domain/delegation.mjs), sign
   its UTF-8 canonical JSON using the Person private key, and submit the
   certificate, signing-key id, and base64url signature to
   `POST /api/me/delegations`.
6. If the Agent is compromised or the authority ends, append a revocation with
   `POST /api/me/delegations/:id/revoke`.
7. When a Person device key is replaced or lost, append a key revocation with
   `POST /api/me/keys/:id/revoke`. A normal revocation requires another
   possession-verified Person key; an explicit `emergency: true` is reserved
   for immediate loss/compromise response.

The private key, raw OAuth token, model-provider credentials, and Agent
chain-of-thought must never be sent to these APIs.

## Read-only certificate record

`GET /api/delegations/:id` returns a machine-verifiable record for one stored
certificate. `GET /delegations/:id` is its human-readable counterpart. Before
returning either representation, the repository recomputes the canonical
signing payload and its hash, and verifies the Ed25519 signature against the
stored public signer key. A failed integrity check is unavailable rather than
silently displayed.

The record includes only the attribution identifiers already named in the
certificate, the Agent and Person public keys, canonical payload, signature,
hash, recorded time, and an append-only revocation if present. It deliberately
omits ChatGPT/provider subjects, Person display names, Agent labels, private
keys, credentials, and private reasoning. Revocation reasons are visible in
the historical record; owners should not put sensitive information in them.

The certificate's signed authority is immutable, but this response is not
cache-immutable because revocation can be appended later. This read route does
not make the closed-alpha identity or write APIs open to participants.

## Closed-alpha workbench

The signed-in `/workbench` route now guides the same API flow without asking a
Person to construct JSON manually:

- it creates an Ed25519 Person signing key in the current browser's WebCrypto
  and IndexedDB store, then registers only its public half;
- it asks that same browser to sign a short-lived, one-time possession
  challenge before the key is eligible to issue a delegation;
- it lets an owner replace a device key by verifying the replacement first and
  then revoking the old key; a local private key is removed only after the
  server has recorded that revocation;
- it accepts an Agent's stable ID, label, and public key, while the Agent
  private key remains at the place the Agent actually runs;
- it constructs the canonical certificate, signs it locally with the Person
  key, and records the certificate through the API;
- it offers an explicit, reasoned revocation action for the active
  certificate.

The browser never sends the Person private key, and it cannot use a Person key
created in another browser profile or on another device. An owner may register
a new device key when needed; key rotation and recovery policy remain a public
beta requirement.

## Controlled evidence records

`/evidence` is a separate, read-only closed-alpha inspection surface. It lists
an owner's staged Bundles and any Bundles assigned to that Person for
independent review. Records are addressed by their immutable Bundle manifest
hash through `GET /api/me/evidence/bundles/:manifestHash`; artifact downloads
use `GET /api/me/evidence/bundles/:manifestHash/artifacts/:artifactId`.

The service rechecks Person ownership or assignment before exposing metadata
or bytes. It then compares the private R2 object's size and stored SHA-256
metadata with its immutable D1 index. It returns attachment bytes with private
no-store caching and never returns internal object keys. Reviewer views omit
the Attempt owner's Person identity. The surface is evidence inspection only:
it cannot start a fresh replay, submit an attestation, or create a receipt.

## Certificate requirements

The server rejects a certificate unless all of the following hold:

- its owner and attribution beneficiary are the current Person;
- the Agent exists, is active, belongs to that Person, and has the exact public
  key named in the certificate;
- its signing key belongs to that Person and is not revoked;
- that signing key has a valid, immutable proof-of-possession event;
- scopes are a unique non-empty subset of `formalize`, `prove`, and `review`;
- its UTC validity interval is non-empty;
- its Ed25519 signature verifies against the registered Person key.

The certificate and its revocation record are immutable at the D1 layer. An
Agent's owner cannot be changed in place. This intentionally preserves the
history necessary for later contribution receipts and independent review.

A Person-key revocation is also an immutable D1 event. It prevents that key
from issuing a new certificate, and it becomes an effective revocation time for
every existing certificate the key signed: Agent progress after that time is
rejected even if the certificate's own expiry has not arrived. Public
delegation records expose the key-revocation state without disclosing provider
identity or private key material.

New provisional Attempts also store the registered Agent id, delegation
certificate id, and delegated `formalize` or `prove` scope. Progress events
re-check the certificate at event time, so a later revocation prevents further
Agent-reported progress while leaving the earlier immutable history visible.

## Person-key proof boundary

The challenge includes the Person id, registered key id and public key, a
32-byte server nonce, issue time, and expiry. The server stores the canonical
payload/hash immutably, verifies the Ed25519 signature before recording one
immutable proof event, and re-checks that stored evidence when a delegation is
issued. An expired, unconsumed challenge cannot be used. The private key never
leaves the browser, while the nonce and signature are retained only as signed
control-plane evidence.

This proves current control of a registered key in the closed alpha. The
closed-alpha replacement/revocation path is deliberately conservative, but it
is not public identity, account recovery, a cross-device recovery ceremony, or
a participant-ready key-rotation policy. Those decisions, together with a
participant-ready identity service, remain prerequisites for general access.
