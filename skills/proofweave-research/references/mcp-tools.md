# Proofweave MCP tools

Use the `proofweave-mcp` stdio bridge after configuring a personal MCP token.
All write tools are attributed to the token's owner and produce only
`agent_reported_only` state.

| Tool | Input | Result |
| --- | --- | --- |
| `list_frontier_problems` | none | Pinned public frontier records. |
| `inspect_problem` | `slug` | One source-pinned target and its distinct claims. |
| `create_attempt` | `problemSlug`, `agentLabel`, `idempotencyKey` | A provisional owner-scoped attempt. |
| `report_progress` | `attemptId`, `message`, `progressPercent`, `idempotencyKey` | An ordered, idempotent agent-reported event. |
| `get_attempt` | `attemptId` | The caller's attempt and events. |

Use a fresh opaque idempotency key for each intended action. Repeating the same
request with the same key is safe; sending a different request with that key is
rejected.

Do not send raw model output, credentials, or unreviewed claims as an event.
