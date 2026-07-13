# Lean Runner deployment preflight and activation

This is the operator procedure for preparing the isolated Lean Runner. It does
not authorize public execution. Until every gate below has durable external
evidence, leave the deployment absent or leave
`RUNNER_EXECUTION_ENABLED=false`.

## What the repository can verify

Copy
`services/lean-runner/deployment-manifest.example.json` to a protected path
outside the repository. The manifest contains names, public keys, and an image
digest only; it must never contain OAuth tokens, an R2 credential, a
control-plane private key, or `RUNNER_RESULT_PRIVATE_KEY_JWK`.

Run:

```bash
npm run runner:deploy:preflight -- /secure/path/proofweave-runner-alpha.json
```

The command uses the same image and Queue-public-key validation code as the
Runner. It validates one D1/R2 authority pair, a distinct Queue and DLQ, one
message per batch, one concurrent Container, an immutable image digest, and a
single pinned Lean/Mathlib environment. Its generated Worker configuration
always keeps execution disabled and omits the result private key. A successful
preflight proves configuration syntax and internal consistency only; it does
not prove that Cloudflare provisioned those resources or that the Container is
isolated.

Before deploying a Runner used by the MCP gateway, compare this manifest with
the validated MCP manifest:

```bash
npm run alpha:deploy:preflight -- /secure/path/proofweave-mcp-alpha.json /secure/path/proofweave-runner-alpha.json
```

This pairwise preflight requires the exact same D1 database name/ID and R2
bucket name, preventing independently valid Workers from splitting the
immutable control-plane record.

## Required evidence before activation

An operator must record all of the following in the deployment change record
before changing the deployed kill switch to `true`:

1. The external web control plane, OAuth service, MCP gateway, and Runner
   Worker are bound to the same migrated D1 and private R2 bucket. Confirm that
   the migration set includes immutable Bundle, Run, output, replay-evidence,
   delegation, and OAuth tables.
2. The final Linux `amd64` image was built with the offline recipe, scanned,
   manually inspected, and recorded by immutable `@sha256:` digest. Its Lean
   toolchain and Mathlib revision exactly match the generated approved-image
   registry.
3. The named Container has no Internet, no cloud credentials, no host socket,
   and externally enforced CPU, memory, disk, process, and wall-time limits.
   Verify this with the deployment platform rather than the source-level
   `PROOFWEAVE_NETWORK_ISOLATED` assertion.
4. The Queue producer uses the paired control-plane private key; the Runner
   receives only its public allowlist. The Worker-only result-signing private
   key has a matching active D1 `runner_keys` record. Neither private key is in
   Wrangler config, D1, R2, a Container, a queue payload, or source control.
5. Retained, access-controlled logs and alerts exist for Queue retries/DLQ,
   Worker failures, Container crashes, D1/R2 errors, and kill-switch changes.
   Audit events may remain privacy-minimal but must be available to the
   incident responders.
6. D1 backup/export and R2 retention/restore procedures were exercised for
   the exact control-plane resources.
7. A non-production account passed duplicate delivery, malformed bundle,
   timeout, output-limit, cancellation, forced Container termination,
   Queue-retry/DLQ, and no-network exercises. Preserve the resulting Run and
   audit evidence; a source test is not a substitute.
8. An external security review approved the image, Worker/Container boundary,
   access policy, incident contacts, and rollback plan.

## Controlled activation

1. Deploy the generated configuration with execution still disabled. Add
   `RUNNER_RESULT_PRIVATE_KEY_JWK` only through the Worker secret provider and
   confirm the Container cannot read it.
2. Verify that a Queue delivery fails closed before Bundle lookup while
   `RUNNER_EXECUTION_ENABLED=false`. Confirm the Worker has no public execution
   route.
3. In non-production, set the kill switch to `true`, execute the recorded
   lifecycle suite, and independently inspect the persisted R2/D1 result,
   output hashes, and Queue acknowledgement. Set the switch back to `false`.
4. Obtain the named approvals, deploy the same reviewed configuration to the
   closed-alpha account, then set the kill switch to `true` in a separately
   recorded change. Enroll no participant until the MCP/OAuth live gate in
   [`mcp-control-plane-deployment.md`](mcp-control-plane-deployment.md) also
   passes.

## Emergency stop and recovery

1. Set `RUNNER_EXECUTION_ENABLED=false` and disable the Queue consumer. Do not
   delete Queue messages, R2 objects, D1 rows, receipts, or audit history.
2. Preserve the affected Queue/DLQ totals, Worker audit records, named
   Container diagnostics, image digest, and known Run IDs in the incident
   record. Treat emitted diagnostics as operational data, never as a
   mathematical result or review claim.
3. Reconcile each queued, preparing, running, and cancellation-requested Run
   from immutable D1 events. Retry only through the existing idempotency key;
   never synthesize a terminal result to clear a backlog.
4. Rotate any suspected control-plane or Runner result key, update both
   allowlists, and leave execution disabled until the non-production lifecycle
   suite and security review are repeated.

The Runner can produce infrastructure evidence only. Re-enabling it does not
issue an Attestation or Contribution Receipt; the independent review and
receipt policies remain separate gates.
