# Direct Cloudflare source integration

This candidate imports the 37 reviewed overlay paths from the Cloudflare source record `c89246e42ab30e205a4d0ca52f65dfa76a3ec24ab7caa1479b52d32b4296cca1` onto Git main `13c0795`. Historical import hashes are recorded in [the import note](releases/cloudflare-source-import-2026-10-20.json). The historical Sites v196 label is provenance context, not a claim that this candidate reproduces that full old source tree.

The two login/connection pages retain main's layout; only migration behavior is ported. Unrelated UI components, catalog ingestion, React caching, Tron/ethers dependencies and snapshot package scripts are excluded. Existing Sites builds continue to use `vite.config.ts` and the Sites packaging plugin.

## Build and test

```sh
npm ci
npm run cloudflare:check:unit
npm run cloudflare:check
```

`cloudflare:check` builds the direct Worker and exercises real compiled Worker pairing, PKCE token exchange, frozen research writes, revocation and unchanged research-table counts in isolated Miniflare D1. It does not contact production or create an E2B Sandbox.

`npm run build:cloudflare` creates `dist/server/wrangler.json` and `dist/cloudflare-source.json`. A clean committed checkout receives its actual full Git SHA as the source identity. Dirty or changing source receives no release source label; it cannot retain the historical snapshot identity. `npm run build:cloudflare:release` requires a clean checkout and an unchanged commit across the build. The emitted identity binds source, not external configuration, credentials, deployed provider state or executable capacity.

## Release boundary

The tracked direct config keeps the existing research surfaces frozen and has no cron. Local builds do not provision resources, migrate databases, set Secrets, deploy, enable research or restore schedules. No deploy npm script or automatic publish workflow is added.

Before any later deployment, independently record and review the target Worker, exact candidate SHA, resulting build metadata, public config, existing encrypted Secret bindings, shared Turso/0049 identity, and rollback version. Use the generated direct Worker config rather than a root-workspace or historical snapshot artifact. The existing Durable Object migration is part of that later provider deployment review, not permission to apply it now.

The current production source is still the separately recorded Cloudflare snapshot; production Runner remains `13c0795` and paused. The staging-only 0043 contribution verifier and Sites-based strict release binding are unchanged. Cloudflare/0049 evidence validation remains a separate reviewed change before opening research.

Sites bridge sign-in refreshes the email and display name for its existing immutable Sites subject. Once a Person has a stable bridge identity, neither a Google subject nor a different Sites subject may claim it through a verified current or legacy email alias. Existing immutable-subject sessions and the first migration of an unclaimed legacy Sites Person retain their Person mapping. This change does not undo any historical account association or rewrite identities in production.

First Sites migration now rechecks legacy Person ownership in a conditional INSERT within one atomic D1/libSQL batch. A competing subject receives a separate Person; concurrent retries of the same subject reuse the winning identity without orphan rows. No schema migration is added. The fast and full Cloudflare gates include deterministic concurrency tests against all 50 real migrations on isolated Miniflare D1 and local libSQL, including session ownership and legacy email aliases.
