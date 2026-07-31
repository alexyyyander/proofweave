# ADR 0009: E2B online Lean Sandbox with a protected one-shot controller

Status: superseded as the active-controller decision, 2026-07-27

The E2B isolation decisions below remain part of the current implementation.
The protected GitHub Actions one-shot controller was superseded by the hosted
trusted Runner on Render as the alpha reference path and then retired. GitHub
Actions now provides secretless diagnostics, CI, and credential-free image
release only. See
[`../github-independence.md`](../github-independence.md) and
[`../runner-provider-neutral-deployment.md`](../runner-provider-neutral-deployment.md).
The original decision is retained below as historical context.

## Context

ADR 0008 established provider-neutral signatures, queues, evidence, and
Receipt boundaries, then selected Modal as the first Sandbox adapter. The
closed alpha has no Modal deployment and needs a no-card path that can execute
real Lean online without moving participant research workspaces into the
platform.

E2B exposes secure per-Run Sandboxes, authenticated private traffic, disabled
Internet access, bounded lifetime, and versioned templates. GitHub Actions can
run the small trusted control process from reviewed repository code within the
account's included minutes. Neither service changes Proofweave's signed domain
protocols.

## Decision

1. Add E2B behind the existing private Container `fetch` contract.
2. Require explicit `PROOFWEAVE_RUNNER_PROVIDER=e2b`; never infer a provider.
3. Create one fresh Sandbox per Run with secure controller access, public
   traffic disabled, all egress denied, and timeout-kill lifecycle.
4. Re-read provider isolation metadata before starting the Lean HTTP process.
5. Keep E2B, Turso, OAuth, queue, GitHub, and Runner signing credentials
   outside the Sandbox.
6. Build E2B templates only from the exact digest-pinned Runner image approved
   by the signed job environment.
7. Use a protected GitHub Actions workflow as a one-shot trusted controller for
   the no-card alpha. It may claim one durable lease and execute only through
   E2B; it must not check out or run participant code on the GitHub host.
8. Retain Modal and Cloudflare adapters as optional providers.

## Consequences

- The Build Week demo can show genuine online Lean replay without Modal.
- The historical controller depended on GitHub startup latency; the current
  hosted controller removes that dependency from the normal per-Run path.
- An E2B account, API key, reviewed template, protected GitHub environment, and
  one real hosted fixture were operational gates for this historical topology;
  production credentials are no longer stored in GitHub.
- E2B execution is still only the kernel gate. Different-owner reviews and the
  Receipt issuer remain separate evidence boundaries.
