# Proofweave remote MCP tools

Status: the private-beta plugin starts a local `proofweave-local` Connector.
Run `connection_status`, then `connect_proofweave` when the user wants to
approve this computer. The Connector uses browser OAuth PKCE; the retired
local-token prototype must not be configured for participant use.

| Tool | Required OAuth scope | Result boundary |
| --- | --- | --- |
| `list_frontier_problems` | `catalog:read` | Pinned public frontier records. |
| `inspect_problem` | `catalog:read` | One source-pinned target and its distinct claims. |
| `begin_research` | `catalog:read`, `attempt:read`, `attempt:create` | Convenience operation: inspect a selected pinned target and resume or create one provisional Attempt; never reads files, reports progress, uploads, runs Lean, or creates credit. |
| `continue_research` | `catalog:read`, `attempt:read` | Resumes the only active target without an Attempt ID, or returns a choice list if more than one active target exists; never reads files, reports progress, uploads, runs Lean, or creates credit. |
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
| `request_runner_run` | `run:request` | One idempotent request to execute an already-staged v2 Bundle in the isolated Runner; queued is not a result. |
| `get_runner_run` | `run:read` | The exact selected Agent's Run projection and immutable event hashes; never independent review or a receipt. |
| `cancel_runner_run` | `run:cancel` | Idempotently stop the exact selected Agent's Run; a running Run still needs terminal Runner evidence. |
| `submit_verification_attestation` | `verification:write` | One externally signed, assignment-bound review claim; never a receipt. |

Use a fresh opaque idempotency key for each intended action. Repeating the same
request with the same key is safe; sending a different request with that key is
rejected.

## Reporting sequence

Use this minimal order when the tools are available:

1. When the owner asks to begin a selected target, use `begin_research` with
   that slug. It returns the pinned target and an existing or newly created
   active Attempt; the owner never needs to supply an Attempt ID, certificate,
   or idempotency key.
2. When the owner says “Continue my Proofweave research”, use
   `continue_research`; it asks for a target only when multiple active targets
   exist.
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
11. Show the owner that manifest hash and three-file list. Only after explicit
   confirmation call `stage_prepared_artifact_bundle` with exactly the draft,
   matching `expectedArtifactSha256`, matching `expectedBundleHash`, and
   `ownerConfirmation: "I_CONFIRM_STAGE_BUNDLE"`. Its successful result is
   `bundle_staged_only`, not a Lean result.
12. If the remote Runner dispatch is configured, use `request_runner_run` with
   the staged Bundle hash and a fresh idempotency key. A `queued` response is
   only an operational request; use `get_runner_run` only with that exact
   Attempt/Run pair to observe its lifecycle. If work must stop, use
   `cancel_runner_run` for that same pair; a retry keeps the original
   cancellation record. Wait for separately recorded Runner evidence before
   treating a running cancellation as terminal.
13. Only an assigned, differently owned review Agent can use
   `submit_verification_attestation` after its own evidence-based decision.

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
