# Google sign-in deployment

Proofweave uses Google's server-side OpenID Connect authorization-code flow
with PKCE. ChatGPT sign-in remains available; both providers resolve to one
stable Proofweave Person attribution root.

## Google Cloud setup

1. In Google Cloud, configure the OAuth consent screen for the Proofweave
   public website.
2. Use these public application links:
   - home: `https://proofweave-research.yualex031821.chatgpt.site/`
   - privacy: `https://proofweave-research.yualex031821.chatgpt.site/privacy`
   - terms: `https://proofweave-research.yualex031821.chatgpt.site/terms`
3. Create an OAuth client with application type **Web application**.
4. Add this exact authorized redirect URI, with no wildcard or trailing slash:

   ```text
   https://proofweave-research.yualex031821.chatgpt.site/auth/google/callback
   ```

5. Complete Google's branding, contact, domain, and publication requirements
   before offering the button to participants outside the test-user list.

## Sites environment

Configure these values in the hosted Sites project, not in source control:

| Name | Handling | Purpose |
| --- | --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | environment value | Identifies the Google web client. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | secret | Exchanges one-time authorization codes on the server. |
| `GOOGLE_OAUTH_STATE_SECRET` | secret, at least 32 random characters | Signs the short-lived state/nonce/PKCE flow cookie. |
| `GOOGLE_OAUTH_REDIRECT_URI` | optional environment value | Pins the exact callback URI instead of deriving the request origin. |

If any required value is absent, `/sign-in` shows Google as unavailable and
keeps ChatGPT sign-in usable. Never paste production secrets into issues,
commits, test snapshots, browser-visible variables, or chat transcripts.

## Security and data behavior

- The flow cookie is HttpOnly, Secure, SameSite=Lax, signed, and expires after
  ten minutes.
- Callback state, PKCE, nonce, Google JWKS signature, issuer, audience, expiry,
  and verified email are checked before a session is created.
- Google `sub` is the stable provider subject. A verified normalized email is
  used only to link a first Google login to an existing Person.
- Google access and ID tokens are not persisted. The 30-day app session stores
  only a SHA-256 token hash in D1.
- Applying `drizzle/0032_add_external_account_auth.sql` before deployment is
  mandatory. It backfills existing ChatGPT identities without changing their
  Person IDs or contribution records.

## Release verification

1. Apply the D1 migration.
2. Configure hosted values and secrets.
3. Run `npm run auth:check`, `npm run typecheck`, and `npm test`.
4. Verify anonymous `/sign-in`, Google consent/callback, existing ChatGPT
   sign-in, sign-out, `/profile`, `/settings`, and a Codex `/authorize` flow.
5. Confirm that signing in with the same verified email through both providers
   exposes the same Person ID and contribution record.

## Official references

- [Google OAuth 2.0 for web server applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Google OAuth application policies](https://developers.google.com/identity/protocols/oauth2/policies)
