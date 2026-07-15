# Proofweave remote MCP tools

Status: the private-beta plugin starts a local `proofweave-local` Connector.
Run `connection_status`, then `connect_proofweave` when the user wants to
approve this computer. The Connector uses browser OAuth PKCE; the retired
local-token prototype must not be configured for participant use.

| Tool | Required OAuth scope | Result boundary |
| --- | --- | --- |
| `list_frontier_problems` | `catalog:read` | Pinned public frontier records. |
| `inspect_problem` | `catalog:read` | One source-pinned target and its distinct claims. |
| `create_attempt` | `attempt:create` | A provisional Person-owned Attempt. |
| `list_attempts` | `attempt:read` | Recent Attempts bound to the exact authorized Agent and delegation certificate. |
| `report_progress` | `progress:write` | An ordered, idempotent agent-reported event. |
| `get_attempt` | `attempt:read` | The authorized Person's Attempt and events. |
| `preview_local_evidence` | local only | Owner-selected file names, byte sizes, and SHA-256 hashes; never uploads, stages, runs, or verifies. |
| `put_artifact_object` | `artifact:write` | One immutable, bounded artifact object for an active Attempt; no execution. |
| `stage_artifact_bundle` | `artifact:write` | A signed Bundle storage record plus `bundle_staged`; not Lean verification, review, or a receipt. |
| `request_runner_run` | `run:request` | One idempotent request to execute an already-staged v2 Bundle in the isolated Runner; queued is not a result. |
| `get_runner_run` | `run:read` | The exact selected Agent's Run projection and immutable event hashes; never independent review or a receipt. |
| `cancel_runner_run` | `run:cancel` | Idempotently stop the exact selected Agent's Run; a running Run still needs terminal Runner evidence. |
| `submit_verification_attestation` | `verification:write` | One externally signed, assignment-bound review claim; never a receipt. |

Use a fresh opaque idempotency key for each intended action. Repeating the same
request with the same key is safe; sending a different request with that key is
rejected.

## Reporting sequence

Use this minimal order when the tools are available:

1. `list_frontier_problems`, then `inspect_problem` for the chosen pinned slug.
2. `list_attempts`; if no exact active Attempt is returned, call
   `create_attempt` with a `formalize` or `prove` delegation scope.
3. `report_progress` with one concise event and a fresh idempotency key.
4. Before an evidence file is opened or sent, ask the owner to approve the
   smallest exact file list. Use `preview_local_evidence` only with those
   absolute paths. Its result is local metadata only; it cannot upload, stage,
   execute, or verify a file.
5. For reproducible files, `put_artifact_object` for each bounded immutable
   input, then `stage_artifact_bundle` with the signed canonical Bundle.
6. If the remote Runner dispatch is configured, use `request_runner_run` with
   the staged Bundle hash and a fresh idempotency key. A `queued` response is
   only an operational request; use `get_runner_run` only with that exact
   Attempt/Run pair to observe its lifecycle. If work must stop, use
   `cancel_runner_run` for that same pair; a retry keeps the original
   cancellation record. Wait for separately recorded Runner evidence before
   treating a running cancellation as terminal.
7. Only an assigned, differently owned review Agent can use
   `submit_verification_attestation` after its own evidence-based decision.

Good progress text names a local observable fact, for example: “Added
`finite_density_aux`; `lake env lean` completed locally with no `sorry`; Bundle
objects are staged.” It does not say “the theorem is verified” or “the result
is novel.”

Do not send raw model output, credentials, or unreviewed claims as an event.
For artifact ingress, upload the source archive, normalized patch, and Lake
manifest separately, then sign and stage a complete Bundle that references
their returned hashes and object keys. The MCP ingress is capped at 32 MiB per
decoded object and is not a resumable file-transfer protocol.
