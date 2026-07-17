# Zero-cost Turso control plane

Proofweave can now create and migrate a separate remote libSQL control-plane
database without changing the Sites frontend or its D1 binding. This is the
first zero-card path for the durable Runner lease queue and the future public
MCP/OAuth services.

As checked on 2026-07-16, Turso's Free plan is `$0`, requires no credit card,
and includes 100 databases, 5 GB storage, 500 million rows read per month, and
10 million rows written per month. Confirm the current limits on the
[official pricing page](https://turso.tech/pricing) before a production launch.

## One-command setup

Install Turso's official CLI once on macOS:

```sh
brew install tursodatabase/tap/turso
```

Then run:

```sh
npm run turso:bootstrap
```

The command:

1. reuses a complete `.env.local` connection if one already exists;
2. otherwise opens Turso's own browser login;
3. reuses `proofweave-control`, or asks before creating it on the free plan;
4. mints a database-scoped token that expires after 30 days;
5. stores the URL and token in the gitignored `.env.local` with mode `0600`;
6. applies every repository migration in order; and
7. verifies the immutable migration ledger before reporting success.

Proofweave never receives the Turso account password and never prints the
database token. Use another database name when needed:

```sh
npm run turso:bootstrap -- --database=proofweave-beta
```

For a non-interactive shell that is already logged in to Turso, add `--yes` to
approve creating the named database. The script will not bypass Turso login.

## Safe operating commands

```sh
npm run turso:plan
npm run turso:migrate
npm run turso:verify
```

`turso:plan` is read-only and reports only a hash-derived database fingerprint,
never the URL or token. `turso:migrate` is the explicit write operation. Each
SQL migration and its SHA-256 ledger entry run in the same libSQL batch
transaction. `turso:verify` fails unless the complete history and the critical
OAuth, Bundle, Run, verification, Receipt, and Runner queue tables are present.

The migrator only accepts an empty database or a database whose ledger is an
exact contiguous prefix of the repository history. It refuses a non-empty
unledgered database, changed migration hashes, gaps, unknown migrations, and a
partial migration transaction. This prevents accidentally treating the Sites
D1 database or a manually populated Turso database as the new authority.

## Token rotation

The bootstrap token expires after 30 days. Rotate it before expiry with:

```sh
npm run turso:bootstrap -- --database=proofweave-control --rotate-token
```

After every process using the previous token has received the replacement,
invalidate old database tokens with Turso's official command:

```sh
turso db tokens invalidate proofweave-control
```

Because invalidation affects all tokens for the database, do it only after
coordinating the gateway and Runner restart.

## Trust boundary and remaining work

Turso stores shared control-plane state; it does not execute submitted Lean or
become a source of mathematical truth. Private research work remains local.
Only signed, reproducible evidence and append-only state enter the external
database. The trusted Runner still requires its reviewed E2B template (or
optional Modal image), signing key, and execution gate before it can process
live work.

The Sites D1 database remains unchanged. Do not make Sites D1 and Turso two
writable authorities for participant data. Public participant writes move to
Turso only with the separate MCP/OAuth cutover and recovery plan described in
[ADR 0008](./adr/0008-provider-neutral-alpha-hosting.md).

Official references:

- [Turso Cloud quickstart](https://docs.turso.tech/quickstart)
- [Turso CLI installation](https://docs.turso.tech/cli/installation)
- [Create a database](https://docs.turso.tech/cli/db/create)
- [Create a database token](https://docs.turso.tech/cli/db/tokens/create)
- [TypeScript/libSQL transaction reference](https://docs.turso.tech/sdk/ts/reference)
