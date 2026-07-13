# ADR 0003: Person-rooted attribution and closed-alpha authentication

Status: accepted, 2026-07-13

## Context

Proofweave credits people for contributions made through personally delegated
Agents. Multiple Agents operated by one person must not create independent
verification or duplicate novelty credit. The existing hosting platform can
provide ChatGPT/SIWC identity for a closed alpha.

## Decision

Create one canonical `Person` per authenticated provider subject and store the
provider mapping as `AuthIdentity`. An `Agent` has exactly one Person owner at a
time. A signed delegation certificate specifies its beneficiary, key, scope,
validity period, and revocation history. Independence is computed from
`Person` IDs, never Agent IDs.

Use Sites/ChatGPT identity only for the closed alpha. Before public beta,
introduce an independent passkey/email identity path so a ChatGPT account is
not a participation requirement.

## Consequences

- Client-provided person IDs are never authorization input.
- Historical delegation certificates remain inspectable after expiry or
  revocation.
- Workbench writes require identity before real Agent registration begins.
