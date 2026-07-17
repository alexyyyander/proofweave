# First local Agent session acceptance

Use this checklist with a second ChatGPT account and a clean Codex profile
before inviting a new participant. It verifies the real local-first path; it
does not use a seeded Person, a copied token, or a pre-existing browser key.

## Preconditions

- The participant has access to the private-beta plugin repository.
- Codex runs on the same computer that will hold the local Agent key.
- The participant has a disposable Lean workspace, but does not need to share
  it with Proofweave.

## First-session path

1. Open `/start` while signed out. The primary action must be sign-in; no
   Person, Agent, delegation, or Attempt may be created.
2. Sign in with the second account. The next action must be **Install or
   connect Codex**, not manual key or token setup.
3. In Codex, install the plugin and ask it to connect Proofweave. Codex must
   open browser approval, generate its own Ed25519 Agent key locally, and not
   request a ChatGPT password, API key, public key, or private workspace.
4. Approve the browser request. The page must explain that a protected Person
   key is created only when necessary and that the resulting delegation is
   revocable. After approval, Settings and Integrations must both report that
   the local Codex is connected.
5. Choose a source-pinned frontier target and open one Attempt. The work queue
   must bind it to the connected Agent and its active certificate; a previous
   Agent's Attempt must not become the current workspace.
6. In the Workspace, copy **Copy for Codex** into the connected Codex session.
   The instruction must include the Attempt ID and tell Codex to read it first.
7. Ask Codex to inspect the target's shared research graph before choosing a
   direction. It must distinguish source-backed prior works, root checkpoints,
   derived branches, and open tips without calling any of them verified.
8. Ask Codex to work locally. Until there is a material local fact, no
   `report_progress` call should occur. For a milestone, Codex must first show
   the proposed message and percentage and wait for the participant's explicit
   confirmation.
9. For a material milestone intended for the public graph, Codex must call
   `prepare_research_checkpoint` first and show the participant the exact kind,
   summary, parent IDs, citations, and checkpoint hash. It may publish only the
   unchanged draft after `I_CONFIRM_PUBLISH_CHECKPOINT`. The result must say
   `shared_unverified`, not Lean-verified, novel, reviewed, credited, or a
   Contribution Receipt.
10. After confirmation, use **Check recorded progress**. The Workspace should
   show the signed Agent event, still labelled provisional/agent-reported only;
   it must not claim Lean verification, independent review, novelty, or a
   Contribution Receipt.
11. If the participant asks to prepare evidence, Codex must first ask them to
   choose the smallest local file set. `preview_local_evidence` may return only
   each filename, byte size, and SHA-256 hash. It must not upload, stage,
   execute, or verify those files.
12. If the participant explicitly says to submit that exact previewed list,
    Codex may call `submit_local_evidence` with the corresponding
    `expectedSha256` preview values and `ownerConfirmation: "I_CONFIRM_SUBMIT"`.
    If a file changed, it must require a new preview. The result must say that
    only immutable objects were stored; it must not claim a signed Bundle, Lean
    Run, review, or receipt.
13. For a normal complete runnable evidence package, the participant selects
    one local Git/Lean workspace root and its entry Lean file. Codex must first
    explain the local read scope, then call `prepare_workspace_bundle_v2` only
    after `ownerConfirmation: "I_CONFIRM_PREPARE_WORKSPACE_BUNDLE"`. It must
    create the source archive, normalized patch, Lake manifest, final tracked
    file tree, and locally signed manifest without uploading any bytes. It must
    stop rather than silently include untracked, new, deleted, renamed, binary,
    or symlinked workspace files. The advanced three-artifact path requires a
    separate exact-file selection.
14. Only after a second, explicit approval of that exact manifest and file list
    may Codex call
    `stage_prepared_artifact_bundle` with
    `ownerConfirmation: "I_CONFIRM_STAGE_BUNDLE"`. A successful response must
    say `bundle_staged_only`, never Lean-verified, independently reviewed, or
    a Contribution Receipt.

## Fail the run when

- any page asks the participant to paste an Agent public key or a Proofweave
  token during the normal flow;
- a browser action can create an Agent progress event without the connected
  local Agent and the participant's confirmation;
- a different Agent's or expired certificate's Attempt is presented as the
  current research workspace; or
- a checkpoint can cite an unlinked historical work, point across problem
  revisions, or be published after its owner-reviewed hash changes; or
- a private workspace file, prompt, model credential, or raw reasoning is sent
  to Proofweave without a separate, explicit evidence action.
