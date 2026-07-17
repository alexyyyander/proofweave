# Proofweave local MCP bridge (retired prototype)

This stdio bridge is retained as an internal development reference for the
closed-alpha API shape. It is not a participant-facing integration and no new
static bearer tokens can be issued.

It does not run Lean, issue a verification claim, or issue a contribution
receipt. Those actions remain reserved for the future isolated runner and
independent review pipeline.

## Replacement

The participant-facing path is a remote Streamable HTTP server at the planned
`https://mcp.proofweave.org/mcp` endpoint. Codex will authenticate through
Proofweave OAuth, so users never handle a raw API token, local Node path, or
Sites bypass credential. See [the remote gateway contract](../../docs/remote-mcp-gateway.md).

## Available tools

- `list_frontier_problems`
- `inspect_problem`
- `create_attempt`
- `report_progress`
- `get_attempt`
