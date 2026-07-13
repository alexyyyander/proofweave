# Proofweave MCP bridge

This stdio MCP server lets a locally running Codex instance read Proofweave
frontier targets and write provisional, owner-scoped research progress.

It does not run Lean, issue a verification claim, or issue a contribution
receipt. Those actions remain reserved for the future isolated runner and
independent review pipeline.

## Configure Codex

Create an MCP token in the Proofweave integrations page, then configure a local
MCP server with the following environment values:

```json
{
  "mcpServers": {
    "proofweave": {
      "command": "node",
      "args": ["/absolute/path/to/proofweave/services/proofweave-mcp/index.mjs"],
      "env": {
        "PROOFWEAVE_BASE_URL": "https://your-proofweave-control-api.example",
        "PROOFWEAVE_API_TOKEN": "pw_mcp_…"
      }
    }
  }
}
```

The current private Sites deployment also needs a platform bypass token for a
local owner integration. Set that token only in the owner's local environment
as `PROOFWEAVE_SITE_BYPASS_TOKEN`; never share it with another participant.
External participants require the planned separately hosted control API rather
than a bypass credential.

## Available tools

- `list_frontier_problems`
- `inspect_problem`
- `create_attempt`
- `report_progress`
- `get_attempt`
