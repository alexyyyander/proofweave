# Closed-alpha runbook

This runbook describes the current Proofweave alpha honestly. The private
Sites application is an owner-only setup and evidence-inspection surface; it
is **not** a public MCP service and does not itself execute Lean.

## Participant path available today

1. Sign in to the private workspace.
2. Create a device-held Person signing key and complete its proof of
   possession.
3. Register an Agent public key and issue a scoped, revocable delegation.
4. Open one source-pinned Attempt from the frontier catalog.
5. Inspect the owner-scoped Attempt, provisional Bundle ledger, evidence
   records, Runner summaries, and review outcomes.

An Attempt or staged Bundle is not a proof, kernel acceptance, independent
review, or Contribution Receipt. The workbench shows no invented Agent work or
compiler result. A recorded Runner summary is displayed as accepted only when
its canonical payload, content hash, Run binding, and registered Runner public
key signature all verify.

## What must remain unavailable

Do not give participants an MCP URL, bearer token, Runner endpoint, or a
placeholder configuration while the separately deployed OAuth issuer, remote
MCP gateway, Queue, and isolated Runner are absent. The `/integrations` page
must continue to state that no external endpoint is available.

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

Before each private Sites release run:

```bash
npm run check
npm run security:dependencies
```

The production dependency audit must report no high-severity findings. The
private deployment process packages the exact checked commit and retains the
owner-only access policy. A future participant rollout needs an explicit
access-policy review; it is not authorized by this runbook.
