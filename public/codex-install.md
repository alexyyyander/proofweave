# Install Proofweave Research for Codex

This guide is intentionally public and auditable. Follow it only after the
person using Codex has asked to install Proofweave Research.

## What the plugin does

Proofweave Research adds a local MCP Connector and research workflow for
formal mathematics. The Connector runs on the participant's computer. It
does not contain a Proofweave bearer token, read a private workspace, or use a
ChatGPT password or API key.

## Safe installation procedure

1. Show the person the two commands below and get confirmation before running
   either command.
2. Add the public Proofweave marketplace:

   ```sh
   codex plugin marketplace add alexyyyander/proofweave --ref main --sparse .agents/plugins
   ```

3. Install the plugin from that marketplace:

   ```sh
   codex plugin add proofweave-research@proofweave-private-beta
   ```

4. Confirm that the plugin is installed. Ask the person to begin a new Codex
   thread before using its skills or local MCP tools.
5. Do **not** invoke `connect_proofweave`, create an Agent, or inspect any
   local research files until the person asks. Connection opens a browser page
   where the person can inspect and approve a revocable delegation.

## After installation

When the person asks to connect, call `connection_status`. If it is not
connected, ask for permission to run `connect_proofweave`. The local Connector
generates its Agent key on the participant's computer and uses browser-approved
OAuth. Never ask the person to paste a public key, password, ChatGPT token,
API key, or Proofweave bearer token.

## Scope and integrity

The initial release can read the public frontier, create bounded Attempts, and
record provisional progress. It must not claim Lean verification, independent
review, novelty, or a contribution receipt merely because an Agent reported
work. Keep private workspaces and chain-of-thought local; record only selected,
bounded evidence through the normal Proofweave flow.
