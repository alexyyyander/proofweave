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

1. When the owner has chosen a target and asked to start, use
   `begin_research` with that exact target slug (and `formalize` unless they
   explicitly choose `prove`). It reads the pinned target and resumes its
   existing active Attempt or creates one bounded Attempt. Do not ask the owner
   for an Attempt ID, certificate ID, or idempotency key. It does not read
   local files, record progress, upload evidence, run Lean, or create credit.
2. When the owner says “Continue my Proofweave research”, use
   `continue_research`. It resumes the only active target without requiring an
   Attempt ID; if more than one is active, ask the owner to choose from its
   returned short list rather than guessing.
3. If `begin_research` is unavailable, inspect the pinned target from
   `list_frontier_problems` and `inspect_problem`, then use `list_attempts`
   and `create_attempt` only as the advanced fallback. Record the revision,
   declaration, Lean toolchain, Mathlib revision, and existing claim statuses.
4. Explore in a local, pinned Lean project. Run the target command and retain
   the source diff, `lean-toolchain`, `lake-manifest.json`, diagnostics, and
   dependency list.
5. Call `report_progress` only for a material milestone: a checked local file,
   a reproducible compiler outcome, a reusable lemma, a refuted direction, or
   a prepared Bundle. First show the owner the concise proposed message and
   percentage, then wait for explicit confirmation before recording it. State
   what changed and where the evidence lives. Never upload prompts,
   chain-of-thought, credentials, or unverifiable conclusions.
6. Before any evidence file is read or uploaded, ask the owner to identify and
   explicitly approve the smallest local file set. Use
   `preview_local_evidence` only with those exact absolute paths; it returns
   local filenames, hashes, and sizes but does not upload, stage, execute, or
   verify anything.
7. Only after the owner explicitly confirms the exact previewed list may you
   call `submit_local_evidence` with the corresponding `expectedSha256` list
   and `ownerConfirmation: "I_CONFIRM_SUBMIT"`. Tell the owner those file
   bytes will leave the computer. If a file changed, stop and preview again.
   Its successful result means immutable objects are stored only; it does not
   create a Bundle, execute Lean, verify a proof, or create a contribution
   record.
8. For the normal executable v2 Bundle path, ask the owner to select one local
   Git/Lean workspace root and its relative Lean entry file. Before any local
   workspace read, explain that the Connector will create temporary evidence
   files outside the workspace and upload nothing. Only after explicit approval
   call `prepare_workspace_bundle_v2` with
   `ownerConfirmation: "I_CONFIRM_PREPARE_WORKSPACE_BUNDLE"`. It builds the
   source archive, normalized patch, Lake manifest, final file tree, and signed
   local manifest itself. It accepts modifications to existing tracked text
   files only; never silently package untracked, new, deleted, renamed, binary,
   symlinked, or credential-like files.
9. If that narrow local Git path cannot represent the work, ask the owner to
   choose exactly `source.tar.zst`, `normalized.patch`, and
   `lake-manifest.json`, then use the advanced `prepare_artifact_bundle_v2`
   path with its final workspace tree and limits. Both preparation tools only
   create a local signed draft. Show the owner its manifest hash and all three
   file hashes; neither uploads, stages, executes, or verifies anything.
10. Only after the owner explicitly approves that exact manifest and file list
   may you call `stage_prepared_artifact_bundle`, with the Bundle, matching
   expected hashes, matching manifest hash, and
   `ownerConfirmation: "I_CONFIRM_STAGE_BUNDLE"`. It re-reads the files and
   re-verifies the local signature before uploading the three objects and
   asking Proofweave to stage the Bundle. A successful result is
   `bundle_staged_only`, not Lean execution, review, or a receipt.
11. If the remote gateway lists `request_runner_run`, use it only for that
   staged v2 Bundle with a fresh idempotency key. Treat a queued Run as a
   dispatch record, not Lean execution or a result. If it lists
   `get_runner_run`, use that only for the exact Attempt/Run pair belonging to
   this Agent. Use `cancel_runner_run` only when stopping that exact Run is
   intended; retrying a lost cancellation response is safe. A cancelled status
   is not verification. If dispatch is unavailable, stop at the reproducible
   Bundle.
12. Use `submit_verification_attestation` only after an assigned review Agent
   has made and signed its own decision. Do not submit a same-owner review.
13. Do not claim `kernel_accepted`, independent review, novelty, or receipt
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
