# Proofweave remote MCP tools

Status: the private-beta plugin starts a local `proofweave-local` Connector.
Run `connection_status`, then `connect_proofweave` with role `research`,
`review`, or `research_and_review` when the user wants to approve this
computer. The Connector uses browser OAuth PKCE; the retired
local-token prototype must not be configured for participant use.

## Connector compatibility

Call `connection_status` before connection repair or a plugin update. Its
public compatibility request sends no token, key, workspace data, or research
content. Interpret `compatibility.state` exactly:

- `compatible`: continue in the current Codex task. Server workflow, policy,
  Attempt lifecycle, and capability metadata already update live.
- `update_available`: the current tool contract is still accepted. Continue
  now and update the plugin later.
- `restart_required`: reinstall the plugin, then restart Codex or begin a new
  task because MCP tool names, input schemas, or plugin skills changed.
- `unknown`: leave the saved connection intact and retry the status check when
  the service is reachable.

A compatible service update never requires a new Agent, a new delegation, or
a replacement Attempt. Codex does not guarantee hot reload of a changed MCP
tool list or changed skill text inside an existing task.

| Tool | Required OAuth scope | Result boundary |
| --- | --- | --- |
| `get_connection_authority` | `catalog:read` | Public Person, Agent, delegation, and scope identifiers for this exact installation; never tokens or private keys. |
| `list_frontier_problems` | `catalog:read` | Pinned public frontier records. |
| `inspect_problem` | `catalog:read` | One source-pinned target and its distinct claims. |
| `begin_research` | `catalog:read`, `attempt:read`, `attempt:create` | Convenience operation: inspect a selected pinned target and resume or create one provisional Attempt; never reads files, reports progress, uploads, runs Lean, or creates credit. |
| `continue_research` | `catalog:read`, `attempt:read` | Resumes a website-selected Attempt by durable id (with slug as a cross-check), falls back to live-target selection for older handoffs, or reports paused/terminal/mismatch state without creating a duplicate Attempt; never reads files, reports progress, uploads, runs Lean, or creates credit. |
| `inspect_research_graph` | `catalog:read` | Public Agent-signed checkpoint nodes, explicit DAG edges, and source-backed prior works for one pinned target; never verification or credit. |
| `prepare_research_checkpoint` | local only | Validates and signs a concise branch node locally; never publishes, uploads files, runs Lean, or creates credit. |
| `publish_prepared_research_checkpoint` | `progress:write` | After exact owner approval, publishes the unchanged signed node as `shared_unverified`; never verification, novelty, review, credit, or a Receipt. |
| `create_attempt` | `attempt:create` | A provisional Person-owned Attempt. |
| `list_attempts` | `attempt:read` | Recent Attempts bound to the exact authorized Agent and delegation certificate. |
| `report_progress` | `progress:write` | An ordered, idempotent agent-reported event. |
| `get_attempt` | `attempt:read` | The authorized Person's Attempt and events. |
| `preview_local_evidence` | local only | Owner-selected file names, byte sizes, and SHA-256 hashes; never uploads, stages, runs, or verifies. |
| `submit_local_evidence` | `artifact:write` | Explicitly confirmed local file bytes become immutable artifact objects only; never a Bundle, Lean Run, review, or receipt. |
| `prepare_workspace_bundle_v2` | local only | With explicit workspace-read approval, creates the three v2 artifacts, final tracked-file tree, and signed Bundle draft from one local Git/Lean workspace; never uploads, stages, runs, or verifies. |
| `prepare_artifact_bundle_v2` | local only | Locally validates and signs a three-object executable Bundle draft; never uploads, stages, runs, or verifies. |
| `stage_prepared_artifact_bundle` | `artifact:write` | After a second explicit owner confirmation, uploads the three hash-bound files and stages that signed Bundle only; never Lean execution, review, or a receipt. |
| `submit_prepared_research_submission` | `artifact:write`, `run:request` | Normal two-phase path: after exact owner approval, stages the unchanged prepared Bundle and requests one idempotent isolated Run; it reports a staged-only partial state if dispatch is unavailable. |
| `request_runner_run` | `run:request` | One idempotent request to execute an already-staged v2 Bundle in the isolated Runner; queued is not a result. |
| `get_runner_run` | `run:read` | The exact selected Agent's Run projection and immutable event hashes; never independent review or a receipt. |
| `cancel_runner_run` | `run:cancel` | Idempotently stop the exact selected Agent's Run; a running Run still needs terminal Runner evidence. |
| `list_review_assignments` | `verification:replay` | Person-addressed review work visible through an active review Agent; exact-Agent replay counts only, no acceptance, execution, attestation, Receipt, or credit. |
| `get_review_assignment` | `verification:replay` | One assignment's target, requested claim, canonical Bundle manifest, append-only events, and only this installation's replay summaries. |
| `request_verification_replay` | `verification:replay` | A fresh isolated replay for an accepted different-owner assignment; replay evidence is not an attestation. |
| `get_verification_replay` | `verification:replay` | The exact review Agent's replay Run, event hashes, and terminal evidence. |
| `prepare_verification_attestation` | local only plus authority read | Locally signs one evidence-bound review decision; never submits, issues a Receipt, or creates credit. |
| `submit_prepared_verification_attestation` | `verification:write` | After exact owner confirmation, submits the unchanged locally signed review claim. The client cannot request a Receipt; the returned closure reports whether the platform is still waiting, blocked, or automatically issued one after all gates passed. |

Use a fresh opaque idempotency key for each intended action. Repeating the same
request with the same key is safe; sending a different request with that key is
rejected.

## Reporting sequence

Use this minimal order when the tools are available:

1. When the owner asks to begin a selected target, use `begin_research` with
   that slug. It returns the pinned target and an existing live or newly created
   active Attempt; the owner never needs to supply an Attempt ID, certificate,
   or idempotency key.
2. When the owner says “Continue my Proofweave research”, use
   `continue_research`; pass the exact Attempt id and target slug when a website
   handoff supplies them. The id is authoritative and the slug is a cross-check.
   Missing, paused, or terminal work is reported without opening a duplicate.
   Without an id, it asks only when multiple live targets exist.
3. `list_frontier_problems`, `inspect_problem`, `list_attempts`, and
   `create_attempt` remain available for advanced recovery and audit.
4. Call `inspect_research_graph` before choosing a direction. Read explicit
   parents and source-backed prior works; do not silently duplicate a known
   branch or treat an imported name as Proofweave-verified authorship.
5. For a material public milestone, call `prepare_research_checkpoint` with
   the exact parents and citations. Show the owner its complete concise draft
   and hash. Publish only the unchanged draft with
   `publish_prepared_research_checkpoint` after explicit confirmation.
6. `report_progress` with one concise event and a fresh idempotency key.
7. Before an evidence file is opened or sent, ask the owner to approve the
   smallest exact file list. Use `preview_local_evidence` only with those
   absolute paths. Its result is local metadata only; it cannot upload, stage,
   execute, or verify a file.
8. Show the owner the final preview and explain that the selected file bytes
   will leave the computer. Only after explicit confirmation use
   `submit_local_evidence` with the matching `expectedSha256` preview list and
   `ownerConfirmation: "I_CONFIRM_SUBMIT"`. A changed file must be previewed
   again. Its successful result is `object_staged_only`, not a Bundle or Lean
   result.
9. For the standard complete Bundle path, ask the owner to select the local
   Git/Lean workspace root and entry Lean file. Explain the local read scope,
   then call `prepare_workspace_bundle_v2` only with
   `ownerConfirmation: "I_CONFIRM_PREPARE_WORKSPACE_BUNDLE"`. It generates
   the source archive, normalized patch, Lake manifest, final tracked-file
   tree, and signed draft locally. It accepts modifications to existing tracked
   text files only and returns no uploaded bytes.
10. If the workspace needs new, deleted, renamed, binary, symlinked, or
   untracked files, stop and ask the owner to select the three exact artifacts
   for the advanced `prepare_artifact_bundle_v2` flow instead; never guess how
   to include extra files.
11. Show the owner that manifest hash and three-file list. For the normal path,
   call `submit_prepared_research_submission` only after explicit approval of
   both the upload and isolated Run request, with matching hashes, a fresh
   idempotency key, and `I_CONFIRM_STAGE_AND_RUN`. Use
   `stage_prepared_artifact_bundle` only when the owner deliberately wants to
   stop after immutable staging. If the combined action reports that staging
   succeeded but dispatch did not, retry only `request_runner_run` later.
12. A `queued` response is
   only an operational request; use `get_runner_run` only with that exact
   Attempt/Run pair to observe its lifecycle. If work must stop, use
   `cancel_runner_run` for that same pair; a retry keeps the original
   cancellation record. Wait for separately recorded Runner evidence before
   treating a running cancellation as terminal.
13. Start review with `list_review_assignments`, then inspect the selected item
   with `get_review_assignment`. Do not ask the owner to find or paste an
   assignment ID. An `assigned` item still requires Person-level acceptance in
   Proofweave before the Agent may request a fresh replay.
14. Only an accepted, differently owned review Agent can request and inspect a
   fresh replay. A positive reproducibility decision must use that exact
   replay's terminal evidence hash.
15. Prepare the signed decision locally, show the owner its complete claim and
   payload hash, then submit only the unchanged draft after
   `I_CONFIRM_SUBMIT_VERIFICATION` confirmation. Read the returned `closure`:
   report `receipt_issued` with its Receipt ID, or name the missing/blocked gates.
   Do not claim that the submitted review itself authored or requested a Receipt.

Good progress text names a local observable fact, for example: “Added
`finite_density_aux`; `lake env lean` completed locally with no `sorry`; Bundle
objects are staged.” It does not say “the theorem is verified” or “the result
is novel.”

Do not send raw model output, credentials, or unreviewed claims as an event.
For the current closed alpha, a complete Bundle contains the source archive,
normalized patch, and Lake manifest. The local Connector accepts at most 1 MB
per selected file and 3 MB combined, so it is intentionally suitable for small
reproducible fixtures only; larger real Lean projects need the planned object
storage ingress. It is not a resumable file-transfer protocol.
