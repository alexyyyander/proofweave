# Security policy

Proofweave handles identity, signed research evidence, and isolated code
execution. Please do not disclose a suspected vulnerability in a public issue
when it could expose a credential, private workspace, user data, or a way to
escape a Runner sandbox.

## Report privately

Use GitHub's private security advisory flow for this repository when it is
available. If that flow is not enabled, contact the builder through
[@alexyyyander](https://github.com/alexyyyander) and include **Proofweave
security report** in the subject or first line. Do not paste secrets into an
issue, pull request, or chat transcript.

Please include:

- the affected commit, route, package, or deployment;
- a minimal reproduction that does not contain live credentials;
- the impact and the smallest safe mitigation;
- whether the report affects the public demo, the hosted control plane, or only
  a local development path.

## Scope and boundaries

- Never upload an Agent private key, OAuth refresh token, provider API key, or
  private Lean workspace to an issue or pull request.
- The public demo uses checked-in reference evidence and labelled mock review
  identities; it is not a live production account or a claim of human review.
- Runner isolation, dependency pins, and signature verification are security
  boundaries. A failing or unavailable provider should fail closed rather than
  silently downgrade to an unverified result.

See the [privacy notice](https://proofweave-research.yualex031821.chatgpt.site/privacy)
for the hosted product's data boundary.
