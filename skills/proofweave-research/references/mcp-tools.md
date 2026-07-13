# Proofweave remote MCP tools

Status: planned remote OAuth gateway. The retired local-token prototype must
not be configured for participant use.

| Tool | Required OAuth scope | Result boundary |
| --- | --- | --- |
| `list_frontier_problems` | `catalog:read` | Pinned public frontier records. |
| `inspect_problem` | `catalog:read` | One source-pinned target and its distinct claims. |
| `create_attempt` | `attempt:create` | A provisional Person-owned Attempt. |
| `report_progress` | `progress:write` | An ordered, idempotent agent-reported event. |
| `get_attempt` | `attempt:read` | The authorized Person's Attempt and events. |

Use a fresh opaque idempotency key for each intended action. Repeating the same
request with the same key is safe; sending a different request with that key is
rejected.

Do not send raw model output, credentials, or unreviewed claims as an event.
