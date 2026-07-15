---
name: proofweave-research
description: Guide Codex through a Proofweave formal-mathematics research attempt with pinned targets, local Lean evidence, and truthful OAuth-MCP reporting. Use when Codex needs to inspect a Proofweave problem, create or continue a delegated Attempt, report provisional Lean progress, stage a reproducible bundle, or submit an assigned independent review without overstating verification.
---

# Proofweave Research

Proofweave uses a remote OAuth MCP gateway. Never ask the user to create,
paste, or share a static Proofweave token. Read
`references/mcp-tools.md` before using MCP tools.

When the private-beta `proofweave-local` tools appear, begin with
`connection_status`. If it is not connected, ask the user whether they want to
run `connect_proofweave`; that local tool opens the browser approval and never
asks them to paste an API key or public key. If the tools are absent or remain
unconnected, continue local Lean work and tell the user that no Proofweave
event was recorded; do not invent an HTTP request, bearer token, or upload.

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
   a prepared Bundle. First show the owner the concise proposed message and
   percentage, then wait for explicit confirmation before recording it. State
   what changed and where the evidence lives. Never upload prompts,
   chain-of-thought, credentials, or unverifiable conclusions.
5. Before any evidence file is read or uploaded, ask the owner to identify and
   explicitly approve the smallest local file set. Use
   `preview_local_evidence` only with those exact absolute paths; it returns
   local filenames, hashes, and sizes but does not upload, stage, execute, or
   verify anything.
6. Only after the owner explicitly confirms the exact previewed list may you
   call `submit_local_evidence` with the corresponding `expectedSha256` list
   and `ownerConfirmation: "I_CONFIRM_SUBMIT"`. Tell the owner those file
   bytes will leave the computer. If a file changed, stop and preview again.
   Its successful result means immutable objects are stored only; it does not
   create a Bundle, execute Lean, verify a proof, or create a contribution
   record.
7. To form an executable v2 Bundle, prepare exactly `source.tar.zst`,
   `normalized.patch`, and `lake-manifest.json` in the owner's local Lean
   workspace. Ask the owner to select those three absolute paths, then call
   `prepare_artifact_bundle_v2` with the final workspace tree, entry Lean file,
   and expansion limits. It checks names and local hashes, derives content
   keys, and signs a manifest locally; it does not upload, stage, execute, or
   verify anything. Show the owner its manifest hash and all three file hashes.
8. Only after the owner explicitly approves that exact manifest and file list
   may you call `stage_prepared_artifact_bundle`, with the Bundle, matching
   expected hashes, matching manifest hash, and
   `ownerConfirmation: "I_CONFIRM_STAGE_BUNDLE"`. It re-reads the files and
   re-verifies the local signature before uploading the three objects and
   asking Proofweave to stage the Bundle. A successful result is
   `bundle_staged_only`, not Lean execution, review, or a receipt.
9. If the remote gateway lists `request_runner_run`, use it only for that
   staged v2 Bundle with a fresh idempotency key. Treat a queued Run as a
   dispatch record, not Lean execution or a result. If it lists
   `get_runner_run`, use that only for the exact Attempt/Run pair belonging to
   this Agent. Use `cancel_runner_run` only when stopping that exact Run is
   intended; retrying a lost cancellation response is safe. A cancelled status
   is not verification. If dispatch is unavailable, stop at the reproducible
   Bundle.
10. Use `submit_verification_attestation` only after an assigned review Agent
   has made and signed its own decision. Do not submit a same-owner review.
11. Do not claim `kernel_accepted`, independent review, novelty, or receipt
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
