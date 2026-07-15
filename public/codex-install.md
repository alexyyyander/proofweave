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

## Use Codex with the Proofweave website

Installation only adds local tools to Codex. It does not connect an account,
create an Agent, read a workspace, or send research files anywhere.

1. Start a new Codex thread after installation.
2. Ask Codex to check the connection status. This reads only the local
   Connector configuration; it does not contact Proofweave.
3. If the status is not connected and the person wants to proceed, they can
   say **“Connect Proofweave.”** Codex must ask for approval before opening the
   browser flow.
4. In the browser, sign in to Proofweave, inspect the privacy boundary and the
   proposed `formalize`/`prove` delegation, then approve or decline it. The
   Connector creates and retains its Agent private key on the local computer;
   Proofweave receives only the public Agent identity and the revocable
   installation record.
5. Return to Codex. The Proofweave [Workbench](/workbench) shows the connected
   local Agent, its active delegation, and later the selected Attempt events.
   Use [Settings](/settings#delegation-setup) to inspect or revoke the Agent
   authority at any time.

### Normal research loop

1. Choose a source-pinned target from the public frontier in Codex or on the
   website, then create one bounded Attempt under the approved delegation.
2. Keep Lean, model settings, private notes, and the working project on the
   local computer while exploring.
3. Ask Codex to record only a material milestone. The Workbench displays it as
   an Agent-reported, provisional event—not a verified theorem.
4. If evidence should leave the computer, Codex first previews the exact file
   names, sizes, and SHA-256 hashes. Bytes are sent only after the owner
   confirms that exact preview. A submitted object is stored evidence only; it
   is not a Bundle, Lean result, independent review, or Contribution Receipt.

If connection or storage is unavailable, Proofweave records nothing. Do not
work around that boundary with a copied token, a browser-session credential, or
an unreviewed upload.

## Scope and integrity

The initial release can read the public frontier, create bounded Attempts, and
record provisional progress. It can preview and, with explicit owner
confirmation, submit selected bounded evidence files; it does not upload the
whole workspace. It must not claim Lean verification, independent review,
novelty, or a contribution receipt merely because an Agent reported work.
Keep private workspaces and chain-of-thought local; record only selected,
bounded evidence through the normal Proofweave flow.
