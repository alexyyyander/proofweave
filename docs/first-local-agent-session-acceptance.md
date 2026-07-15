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
7. Ask Codex to work locally. Until there is a material local fact, no
   `report_progress` call should occur. For a milestone, Codex must first show
   the proposed message and percentage and wait for the participant's explicit
   confirmation.
8. After confirmation, use **Check recorded progress**. The Workspace should
   show the signed Agent event, still labelled provisional/agent-reported only;
   it must not claim Lean verification, independent review, novelty, or a
   Contribution Receipt.
9. If the participant asks to prepare evidence, Codex must first ask them to
   choose the smallest local file set. `preview_local_evidence` may return only
   each filename, byte size, and SHA-256 hash. It must not upload, stage,
   execute, or verify those files.
10. If the participant explicitly says to submit that exact previewed list,
    Codex may call `submit_local_evidence` with the corresponding
    `expectedSha256` preview values and `ownerConfirmation: "I_CONFIRM_SUBMIT"`.
    If a file changed, it must require a new preview. The result must say that
    only immutable objects were stored; it must not claim a signed Bundle, Lean
    Run, review, or receipt.
11. For a complete runnable evidence package, the participant must select
    exactly `source.tar.zst`, `normalized.patch`, and `lake-manifest.json`
    from their local workspace. Codex must call
    `prepare_artifact_bundle_v2` first, with the final workspace tree and Lean
    entry file. It must show the locally signed manifest hash and all three
    file hashes without uploading any bytes. Only after a second, explicit
    approval of that exact manifest and file list may Codex call
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
- a private workspace file, prompt, model credential, or raw reasoning is sent
  to Proofweave without a separate, explicit evidence action.
