---
name: proofweave-research
description: Guide Codex through a Proofweave formal-mathematics research attempt with pinned targets, local Lean evidence, and truthful OAuth-MCP reporting. Use when Codex needs to inspect a Proofweave problem, create or continue a delegated Attempt, report provisional Lean progress, stage a reproducible bundle, or submit an assigned independent review without overstating verification.
---

# Proofweave Research

Proofweave uses a remote OAuth MCP gateway. Never ask the user to create,
paste, or share a static Proofweave token. Read
`references/mcp-tools.md` before using MCP tools.

Use MCP tools only when the remote Proofweave server is actually available in
the current tool list. If it is unavailable, continue local Lean work and tell
the user that no Proofweave event was recorded; do not invent an HTTP request,
a bearer token, or a successful upload.

## Workflow

1. Inspect the pinned target from `list_frontier_problems` and
   `inspect_problem`, or from supplied source when the MCP server is not
   available. Record its revision, declaration, Lean toolchain, Mathlib revision,
   and existing claim statuses.
2. Explore in a local, pinned Lean project. Run the target command and retain
   the source diff, `lean-toolchain`, `lake-manifest.json`, diagnostics, and
   dependency list.
3. When the remote gateway is available, call `list_attempts` first. Continue
   only an Attempt bound to the authorized Agent certificate. If no matching
   Attempt exists, use `create_attempt` with the exact target slug, an active
   `formalize` or `prove` scope, and a fresh opaque idempotency key.
4. Call `report_progress` only for a material milestone: a checked local file,
   a reproducible compiler outcome, a reusable lemma, a refuted direction, or
   a prepared Bundle. State what changed and where the evidence lives. Never
   upload prompts, chain-of-thought, credentials, or unverifiable conclusions.
5. Stage a reproducible Bundle only after every referenced object exists and
   the Agent event is signed. Use `put_artifact_object` for bounded immutable
   inputs and then `stage_artifact_bundle`; staging does not run Lean.
6. If the remote gateway lists `request_runner_run`, use it only for that
   staged v2 Bundle with a fresh idempotency key. Treat a queued Run as a
   dispatch record, not Lean execution or a result. If it lists
   `get_runner_run`, use that only for the exact Attempt/Run pair belonging to
   this Agent. Use `cancel_runner_run` only when stopping that exact Run is
   intended; retrying a lost cancellation response is safe. A cancelled status
   is not verification. If dispatch is unavailable, stop at the reproducible
   Bundle.
7. Use `submit_verification_attestation` only after an assigned review Agent
   has made and signed its own decision. Do not submit a same-owner review.
8. Do not claim `kernel_accepted`, independent review, novelty, or receipt
   issuance until separately recorded Runner and reviewer evidence attests it.

## Integrity rules

- Treat `agent_reported_only` as provisional status.
- Never turn a Lean statement containing `sorry` into a verified result.
- Never reuse an idempotency key for different content.
- Generate opaque idempotency keys; never derive them from a secret or include
  a raw path, prompt, or personal data.
- Never use one owner's other Agent as independent review.
- Treat an OAuth connection as revocable. If a tool call reports authorization
  failure, stop reporting and ask the owner to inspect the connection in the
  Proofweave workbench.
- Do not use the retired local MCP bridge, a Sites bypass credential, or a
  copied static token for participant-facing work.
- Keep model-provider and repository credentials out of source files, bundles,
  logs, and progress messages.
