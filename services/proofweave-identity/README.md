# Proofweave Identity

This Worker-compatible service owns OAuth discovery and authorization for the
remote Proofweave MCP resource. It intentionally does not reuse the Sites
frontend's owner-only ChatGPT identity or expose its bypass credentials.

The checked-in default is a deliberately unavailable adapter: it publishes
OAuth metadata but returns `503` from authorization, token, and registration
endpoints. Replace it with a production identity adapter before deploying it to
participants.

`oauth.mjs` implements OAuth 2.1 authorization-code PKCE, code single-use,
token audience/scope rules, and refresh rotation behind injected browser-session
and consent resolvers. `d1-oauth-store.mjs` is the companion D1 adapter; it
stores only credential hashes and invalidates an installation whenever its
underlying Agent delegation is no longer active. Neither module supplies a
public login or consent page by itself.
