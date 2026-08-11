# Contributing to Proofweave

Proofweave is an open implementation of a local-first research network for
formal mathematics. Contributions are welcome when they make a contract,
verification boundary, user journey, or source-pinned research record easier
to inspect and reproduce.

## Before you start

1. Read the [README](README.md) and the relevant contract in [`docs/`](docs/).
2. Keep private reasoning, prompts, OAuth tokens, private keys, and local Lean
   workspaces out of commits.
3. Open an issue for a large protocol or deployment change before starting
   implementation.
4. Use a focused branch and explain the user impact in the pull request.

## Contribution lanes

### Code and protocol

Use the smallest contract or test that demonstrates the behavior. Prefer
provider-neutral protocol code in `packages/protocol/`; keep D1/Turso, Sites,
Render, and E2B adapters behind explicit boundaries.

### Catalog and mathematics

Add a source-pinned target through the rules in
[`open-catalog/CONTRIBUTING.md`](open-catalog/CONTRIBUTING.md). A famous name is
not enough: include the canonical statement, variant, source revision, date of
verification, and any known prior work. Do not present an Agent checkpoint as a
proof or a current result.

### Documentation and UX

Documentation, accessibility, copy, and user-flow improvements are first-class
contributions. Link claims to the exact route, contract, test, or upstream
source that supports them.

## Local setup

```bash
git clone https://github.com/alexyyyander/proofweave.git
cd proofweave
npm install
npm run dev
```

The supported Node version is `>=22.13.0`. The repository is a web application,
so `package.json` remains `private: true` intentionally; that is unrelated to
the GitHub repository visibility.

Run the smallest relevant checks first:

```bash
npm run lint
npm run typecheck
npm run demo:check
npm run smoke:solo-contribution
```

Before a protocol or runtime PR, run `npm run check` when the required local
toolchains are available. The isolated smoke uses temporary D1/R2 state and
does not write to the hosted control plane. If a check needs a provider key or
hosted environment, document that boundary instead of committing the secret.

## Pull request checklist

- [ ] The change has a clear user or maintainer impact.
- [ ] Tests or a reproducible manual check cover the change.
- [ ] No credentials, private keys, prompts, or private workspace files are
      included.
- [ ] Public claims distinguish Agent progress, Bundle evidence, Lean replay,
      independent review, and Contribution Receipt.
- [ ] Catalog changes include source, revision, license, and attribution data.
- [ ] The PR description names any deployment or migration follow-up.

## Review standard

Proofweave favors explicit, hash-bound, fail-closed behavior over optimistic
status labels. A successful test is evidence for the tested boundary only; it
does not prove a mathematical claim that the test did not execute.

By submitting a contribution, you agree that it is licensed under the
repository's [Apache-2.0 license](LICENSE).
