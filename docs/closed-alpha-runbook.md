# Closed-alpha runbook

This runbook describes the current Proofweave alpha honestly. The Sites
application has a publicly readable research catalog and verified reference
Demo. Its Person-scoped setup, workbench, review, and evidence actions require
Sign in with ChatGPT. The private-beta local Codex Connector is available only
after the Site D1 control-plane migrations are applied; it is **not** a public
MCP service and does not itself execute Lean.

## Participant path available today

1. Open the public catalog or verified reference Demo without an account, or
   sign in before creating Person-scoped records.
2. Create a device-held Person signing key and complete its proof of
   possession.
3. Install the private-beta Proofweave Research plugin, run
   `connect_proofweave`, and approve its browser flow. It creates the local
   Agent public key and a scoped, revocable delegation without manual key entry.
4. Open one source-pinned Attempt from the frontier catalog.
5. Inspect the owner-scoped Attempt, provisional Bundle ledger, evidence
   records, Runner summaries, and review outcomes.

An Attempt or staged Bundle is not a proof, kernel acceptance, independent
review, or Contribution Receipt. The workbench shows no invented Agent work or
compiler result. A recorded Runner summary is displayed as accepted only when
its canonical payload, content hash, Run binding, and registered Runner public
key signature all verify.

## What must remain unavailable

Do not give participants a bearer token, Runner endpoint, or a placeholder
configuration. The private local Connector is permitted only after the shared
D1 migrations and OAuth/MCP routes have been deployed and smoke-tested. Do not
claim that it is public, cross-device, independently reviewed, or able to run
Lean; Queue, Runner, and broader participant access remain separately gated.

## Before enrolling a remote Agent

Complete every gate in [MCP control-plane deployment](mcp-control-plane-deployment.md)
and [Runner deployment preflight](runner-deployment-preflight.md):

- one migrated external D1 inline-evidence authority shared by web, OAuth,
  gateway, and Runner; every alpha evidence object must remain below 1 MB;
- reviewed HTTPS origins, finite client allowlist, and revocable installation
  flow;
- paired MCP/Runner manifests, secret-provider key-pair verification, and an
  active external `runner_keys` entry;
- no-Internet Container isolation, pinned image, Queue/DLQ exercise, backup
  restore, retained access-controlled logs, alerting, and incident contacts;
- an unauthenticated live discovery check plus a non-production authenticated
  lifecycle exercise.

Keep `RUNNER_EXECUTION_ENABLED=false` until these externally evidenced gates
are complete. Repository tests and local Lean fixtures are regression evidence,
not deployment evidence.

## Incident response

For suspected gateway, Runner, key, Queue, or storage compromise:

1. Disable Runner execution and the Queue consumer; revoke affected Agent
   installations or delegations as appropriate.
2. Preserve D1 events, immutable inline evidence rows, Queue/DLQ counts, Runner IDs,
   image digest, and privacy-minimal audit records. Do not delete evidence to
   clear a backlog.
3. Reconcile non-terminal Runs by their existing idempotency keys only; never
   synthesize a terminal result.
4. Rotate suspected control-plane or Runner keys, re-run non-production
   exercises, and obtain a new security approval before re-enabling execution.

An integrity flag or failed review is not a receipt retraction. Receipt
corrections use their own append-only lifecycle protocol.

## Release evidence

Before each Sites release run:

```bash
npm run check
npm run security:dependencies
```

The production dependency audit must report no high-severity findings. The
deployment process packages the exact checked commit. Public access is limited
to the frontend and Sign in with ChatGPT boundary: enabling remote MCP, hosted
Lean execution, or broader participant writes still requires the external
deployment and security gates in this runbook.
