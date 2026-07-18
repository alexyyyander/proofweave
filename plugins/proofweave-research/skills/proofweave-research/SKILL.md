---
name: proofweave-research
description: Guide Codex through a Proofweave formal-mathematics research attempt with pinned targets, shared checkpoint branches, local Lean evidence, and truthful OAuth-MCP reporting. Use when Codex needs to inspect a Proofweave problem or research DAG, create or continue a delegated Attempt, publish an owner-approved signed checkpoint, stage a reproducible bundle, or submit an assigned independent review without overstating verification.
---

# Proofweave Research

Proofweave uses a remote OAuth MCP gateway. Never ask the user to create,
paste, or share a static Proofweave token. Read
`references/mcp-tools.md` before using MCP tools.

When the private-beta `proofweave-local` tools appear, begin with
`connection_status`. If it is not connected, ask the user whether they want to
run `connect_proofweave` with the least-privilege role: `research`, `review`, or
`research_and_review`. That local tool opens the browser approval and never
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
   `continue_research`. A website handoff may supply its exact target slug; use
   that slug so the read-only recovery either resumes the matching active
   target or reports a connection mismatch without creating a duplicate
   Attempt. Without a handoff slug, if more than one target is active, ask the
   owner to choose from its returned short list rather than guessing.
3. If `begin_research` is unavailable, inspect the pinned target from
   `list_frontier_problems` and `inspect_problem`, then use `list_attempts`
   and `create_attempt` only as the advanced fallback. Record the revision,
   declaration, Lean toolchain, Mathlib revision, and existing claim statuses.
4. Explore in a local, pinned Lean project. Run the target command and retain
   the source diff, `lean-toolchain`, `lake-manifest.json`, diagnostics, and
   dependency list.
5. Before choosing a public direction, call `inspect_research_graph` for the
   exact target. Read its existing checkpoint nodes, explicit parent edges,
   open tips, and imported historical works. Continue a named parent, open an
   independent root, or synthesize at least two parents deliberately; never
   infer a branch from raw private reasoning or silently repeat known work.
6. When a material milestone should join the public DAG, call
   `prepare_research_checkpoint` with a concise structured summary, the exact
   parent node IDs, and only already imported historical citations. This signs
   a draft locally and publishes nothing. Show the owner its kind, summary,
   parents, citations, and checkpoint hash. Only after approval of that exact
   draft call `publish_prepared_research_checkpoint` with
   `ownerConfirmation: "I_CONFIRM_PUBLISH_CHECKPOINT"`. Its result is
   `shared_unverified`: not Lean verification, novelty, review, contribution
   credit, or a Receipt. Never put prompts or chain-of-thought in a checkpoint.
7. Call `report_progress` only for a material milestone: a checked local file,
   a reproducible compiler outcome, a reusable lemma, a refuted direction, or
   a prepared Bundle. First show the owner the concise proposed message and
   percentage, then wait for explicit confirmation before recording it. State
   what changed and where the evidence lives. Never upload prompts,
   chain-of-thought, credentials, or unverifiable conclusions.
8. Before any evidence file is read or uploaded, ask the owner to identify and
   explicitly approve the smallest local file set. Use
   `preview_local_evidence` only with those exact absolute paths; it returns
   local filenames, hashes, and sizes but does not upload, stage, execute, or
   verify anything.
9. Only after the owner explicitly confirms the exact previewed list may you
   call `submit_local_evidence` with the corresponding `expectedSha256` list
   and `ownerConfirmation: "I_CONFIRM_SUBMIT"`. Tell the owner those file
   bytes will leave the computer. If a file changed, stop and preview again.
   Its successful result means immutable objects are stored only; it does not
   create a Bundle, execute Lean, verify a proof, or create a contribution
   record.
10. For the normal executable v2 Bundle path, ask the owner to select one local
   Git/Lean workspace root and its relative Lean entry file. Before any local
   workspace read, explain that the Connector will create temporary evidence
   files outside the workspace and upload nothing. Only after explicit approval
   call `prepare_workspace_bundle_v2` with
   `ownerConfirmation: "I_CONFIRM_PREPARE_WORKSPACE_BUNDLE"`. It builds the
   source archive, normalized patch, Lake manifest, final file tree, and signed
   local manifest itself. It accepts modifications to existing tracked text
   files only; never silently package untracked, new, deleted, renamed, binary,
   symlinked, or credential-like files.
11. If that narrow local Git path cannot represent the work, ask the owner to
   choose exactly `source.tar.zst`, `normalized.patch`, and
   `lake-manifest.json`, then use the advanced `prepare_artifact_bundle_v2`
   path with its final workspace tree and limits. Both preparation tools only
   create a local signed draft. Show the owner its manifest hash and all three
   file hashes; neither uploads, stages, executes, or verifies anything.
12. Only after the owner explicitly approves that exact manifest, file list,
   and isolated Run request may you use the normal
   `submit_prepared_research_submission` action with
   `ownerConfirmation: "I_CONFIRM_STAGE_AND_RUN"` and one fresh idempotency
   key. It re-reads and re-verifies the exact local evidence, stages the Bundle,
   then requests its Run. If Runner dispatch is unavailable, report the
   returned `bundle_staged_run_not_requested` state and retry only
   `request_runner_run` later; never upload the Bundle again. The advanced
   `stage_prepared_artifact_bundle` action remains available when the owner
   intentionally wants to stop at `bundle_staged_only`.
13. Treat a queued Run as a dispatch record, not Lean execution or a result. If
   the remote gateway lists
   `get_runner_run`, use that only for the exact Attempt/Run pair belonging to
   this Agent. Use `cancel_runner_run` only when stopping that exact Run is
   intended; retrying a lost cancellation response is safe. A cancelled status
   is not verification. If dispatch is unavailable, stop at the reproducible
   Bundle.
14. For review work, begin with `list_review_assignments`; do not ask the owner
   to copy an assignment ID. Use `get_review_assignment` to inspect the target,
   requested claim, canonical Bundle manifest, append-only assignment events,
   and only this exact review Agent installation's replay summaries. If the
   assignment is still `assigned`, tell the owner to accept it in Proofweave;
   the Agent must not silently accept Person-level work.
15. For an accepted assignment, use `request_verification_replay` with a fresh
   idempotency key, then poll `get_verification_replay`. A positive
   `bundle_reproducible` decision must use that exact replay's terminal evidence
   hash. Replay evidence alone is not an attestation.
16. After the review Agent reaches an evidence-based decision, call
   `prepare_verification_attestation`. Show the owner the exact assignment,
   Bundle hash, claim, decision, evidence hash, and payload hash. Only after the
   owner approves that exact signed draft call
   `submit_prepared_verification_attestation` with
   `ownerConfirmation: "I_CONFIRM_SUBMIT_VERIFICATION"`. Do not submit a
   same-owner review. Submission records one review claim only; the client
   cannot request a Receipt. If this is the final required positive gate, report
   the control plane's returned `receipt_issued` closure and Receipt ID; otherwise
   report the remaining gates. Never infer closure from the submitted claim.
17. Do not claim `kernel_accepted`, independent review, novelty, or receipt
   issuance until separately recorded Runner and reviewer evidence attests it.

## Integrity rules

- Treat `agent_reported_only` as provisional status.
- Treat `shared_unverified` as public Agent-signed research progress only.
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
