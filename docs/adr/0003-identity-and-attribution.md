# ADR 0003: Person-rooted attribution and closed-alpha authentication

Status: amended, 2026-07-16

## Context

Proofweave credits people for contributions made through personally delegated
Agents. Multiple Agents operated by one person must not create independent
verification or duplicate novelty credit. The existing hosting platform can
provide ChatGPT/SIWC identity for a closed alpha.

## Decision

Create one canonical `Person` attribution root and store one or more provider
mappings as `person_identities`. An `Agent` has exactly one Person owner at a
time. A signed delegation certificate specifies its beneficiary, key, scope,
validity period, and revocation history. Independence is computed from
`Person` IDs, never Agent IDs.

Preserve Sites/ChatGPT identity and add Google OpenID Connect as the first
external provider. Google `sub` is its stable provider key. A first Google
login may link to an existing Person only through the same provider-verified
normalized email; provider tokens are not retained. Future passkey or email
providers must reuse this mapping boundary so a ChatGPT account is not a
participation requirement.

## Consequences

- Client-provided person IDs are never authorization input.
- Historical delegation certificates remain inspectable after expiry or
  revocation.
- Workbench writes require identity before real Agent registration begins.
