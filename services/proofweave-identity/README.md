# Proofweave Identity

This Worker-compatible service owns OAuth discovery and authorization for the
remote Proofweave MCP resource. It never gives the MCP client a Sites browser
session or bypass credential.

`worker.mjs` remains a deliberately unavailable standalone identity service.
For the current private Sites alpha, `sites-runtime.mjs` can instead be mounted
inside the existing Proofweave Worker. It uses the platform-forwarded signed-in
Sites identity solely to locate the already-created `chatgpt` Person record,
then renders a D1-backed browser consent page at the standard OAuth paths. It
is a closed-alpha bridge, not a public identity system: it has no independent
account creation, recovery, or cross-device identity linking.

`oauth.mjs` implements OAuth 2.1 authorization-code PKCE, code single-use,
token audience/scope rules, and refresh rotation behind injected browser-session
and consent resolvers. `browser-consent.mjs` creates a one-time, CSRF-cookie
bound confirmation page, filters to active delegations capable of the requested
OAuth scopes, and creates or reuses one installation only after approval.
`d1-oauth-store.mjs` stores credential and consent-token hashes; it invalidates
an installation whenever its underlying Agent delegation is no longer active.

Dynamic client registration is intentionally closed by default. The private
Sites adapter reads it only from the optional
`OAUTH_CLIENT_REGISTRATION_ALLOWLIST_JSON` deployment binding: a finite JSON
array of exact client metadata. It passes that array to
`createAllowlistedClientRegistrationPolicy`; only then does discovery advertise
`/register`. Leave the binding absent for the private alpha. The D1 store
derives a stable client ID for identical approved metadata, preventing
re-registration from creating an unbounded client table. The deliberately
unavailable standalone identity Worker does not inherit this setting; a future
public identity service must wire its own reviewed policy explicitly.
