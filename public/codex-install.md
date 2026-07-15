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

### If the connection needs repair

The local Connector needs one outbound HTTPS destination to begin a browser
approval and later exchange bounded Proofweave MCP requests:

```text
proofweave-research.yualex031821.chatgpt.site
```

Most people do not need to configure anything else. If Codex says it cannot
reach Proofweave, the task may use a domain allowlist. Allow only that host;
do not disable the sandbox or grant broad network access. In a project-scoped
`.codex/config.toml`, a least-privilege repair profile can be:

```toml
default_permissions = "proofweave-connector"

[permissions.proofweave-connector]
extends = ":workspace"

[permissions.proofweave-connector.network]
enabled = true

[permissions.proofweave-connector.network.domains]
"proofweave-research.yualex031821.chatgpt.site" = "allow"
```

Start a fresh Codex task after changing a permission profile. In a managed
workspace, ask the administrator to add that exact host instead. The browser
approval still requires the person's separate confirmation.

## After installation

When the person asks to connect, call `connection_status`. If it is not
connected, ask for permission to run `connect_proofweave`. The local Connector
generates its Agent key on the participant's computer and uses browser-approved
OAuth. Never ask the person to paste a public key, password, ChatGPT token,
API key, or Proofweave bearer token.

## Use Codex with the Proofweave website

Installation only adds local tools to Codex. It does not connect an account,
create an Agent, read a workspace, or send research files anywhere.

1. Start a new Codex thread after installation (and after any permission-profile change).
2. When the person is ready, they can say **“Connect Proofweave.”** Codex checks
   the local state and must ask for approval before opening the browser flow.
3. In the browser, sign in to Proofweave, inspect the privacy boundary and the
   proposed `formalize`/`prove` delegation, then approve or decline it. The
   Connector creates and retains its Agent private key on the local computer;
   Proofweave receives only the public Agent identity and the revocable
   installation record.
4. Return to the Proofweave [Workbench](/workbench), choose one source-pinned
   question, and click **Start research**. The website derives the connected
   Agent and authority; it does not ask for a certificate or Attempt ID.
5. In Codex, say **“Continue my Proofweave research.”** The plugin uses the
   selected target to resume or create the bounded Attempt automatically.
   Use [Settings](/settings#delegation-setup) to inspect or revoke the Agent
   authority at any time.

### Normal research loop

1. Choose a source-pinned target from the public frontier or your Workspace and
   click **Start research**.
2. Tell Codex **“Continue my Proofweave research.”** It uses one composite
   start operation to read the pinned target and resume or create the matching
   bounded Attempt. You do not type an Attempt ID, certificate ID, or
   idempotency key.
3. Keep Lean, model settings, private notes, and the working project on the
   local computer while exploring.
4. Ask Codex to record only a material milestone. The Workbench displays it as
   an Agent-reported, provisional event—not a verified theorem.
5. If evidence should leave the computer, Codex first previews the exact file
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
