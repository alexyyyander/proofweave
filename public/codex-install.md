# Install Proofweave Research for Codex

This guide is intentionally public and auditable. Follow it only after the
person using Codex has asked to install Proofweave Research.

## What the plugin does

Proofweave Research adds a local MCP Connector and research workflow for
formal mathematics. The Connector runs on the participant's computer. It
does not contain a Proofweave bearer token, read a private workspace, or use a
ChatGPT password or API key.

## Safe installation procedure

The default installation does not use GitHub. Proofweave publishes a portable
marketplace archive and its SHA-256 checksum at:

```text
https://proofweave-research.yualex031821.chatgpt.site/downloads/proofweave-research-marketplace.tar
https://proofweave-research.yualex031821.chatgpt.site/downloads/proofweave-research-marketplace.tar.sha256
```

Before changing the person's computer, Codex must:

1. ask the person to choose or approve an empty local marketplace directory;
2. show the exact download, checksum, extraction, and Codex plugin commands;
3. explain that the checksum detects bytes that do not match the archive
   published by the Proofweave site; and
4. wait for explicit confirmation.

On the currently supported macOS beta, the following is an auditable example.
Codex must show the concrete directory values it intends to use. A person may
choose different local directories.

```sh
PROOFWEAVE_DOWNLOAD_DIR="$HOME/Downloads/proofweave-install"
PROOFWEAVE_MARKETPLACE_DIR="$HOME/.local/share/proofweave/marketplace"
mkdir -p "$PROOFWEAVE_DOWNLOAD_DIR" "$PROOFWEAVE_MARKETPLACE_DIR"

curl --fail --location \
  --output "$PROOFWEAVE_DOWNLOAD_DIR/proofweave-research-marketplace.tar" \
  "https://proofweave-research.yualex031821.chatgpt.site/downloads/proofweave-research-marketplace.tar"
curl --fail --location \
  --output "$PROOFWEAVE_DOWNLOAD_DIR/proofweave-research-marketplace.tar.sha256" \
  "https://proofweave-research.yualex031821.chatgpt.site/downloads/proofweave-research-marketplace.tar.sha256"

cd "$PROOFWEAVE_DOWNLOAD_DIR"
shasum -a 256 -c proofweave-research-marketplace.tar.sha256
tar -xf proofweave-research-marketplace.tar -C "$PROOFWEAVE_MARKETPLACE_DIR"

codex plugin marketplace add "$PROOFWEAVE_MARKETPLACE_DIR"
codex plugin add proofweave-research@proofweave-private-beta
```

The checksum command must succeed before extraction. The archive has no extra
top-level directory: after extraction, the chosen marketplace directory
directly contains `.agents/plugins/marketplace.json` and
`plugins/proofweave-research/`. If the destination is not empty, stop and ask
the person to choose a new directory; do not delete or overwrite an existing
installation without approval.

Never pipe a downloaded response into `sh`, `bash`, or another interpreter.
Downloading, verifying, and extracting are separate inspectable steps.

5. Confirm that the plugin is installed. Ask the person to begin a new Codex
   thread before using its skills or local MCP tools.
6. Do **not** invoke `connect_proofweave`, create an Agent, or inspect any
   local research files until the person asks. Connection opens a browser page
   where the person can inspect and approve a revocable delegation.

### Advanced: install from a reviewed GitHub source checkout

GitHub is an optional source and development path, not a product requirement.
Use it only when the person explicitly wants to inspect or install from a
particular repository revision and has access to that source:

```sh
codex plugin marketplace add alexyyyander/proofweave --ref main --sparse .agents/plugins
codex plugin add proofweave-research@proofweave-private-beta
```

This advanced path may require repository access while the source repository
is private. It does not change the plugin's local privacy or OAuth authority
boundaries. The portable archive above is the normal participant path.

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

If `connection_status` reports `reconnectRequired` or shows an older address
such as `proofweave-public-demo.proofweave-research.workers.dev`, the saved
OAuth connection belongs to an earlier deployment. Show both addresses and
ask the person to approve `connect_proofweave` again for the current Site. Do
not delete the local Agent key or copy its refresh token. Reconnection changes
the approved control plane; it does not silently copy or merge research records
from a separate legacy database.

## After installation

When the person asks to connect, call `connection_status`. If it is not
connected, ask for permission to run `connect_proofweave` with the narrowest
role: `research`, `review`, or `research_and_review`. The local Connector
generates its Agent key on the participant's computer and uses browser-approved
OAuth. Never ask the person to paste a public key, password, ChatGPT token, API
key, or Proofweave bearer token.

### Updates and Codex restarts

`connection_status` also performs a public compatibility check. It sends no
OAuth token, key, workspace data, or research content. Read its
`compatibility.state` before asking the person to reinstall or begin another
task:

- `compatible`: continue this task. Server-side workflow, authority policy,
  Attempt lifecycle, and status changes already apply live.
- `update_available`: the current tool contract remains supported. Continue
  this task and update the plugin later when convenient.
- `restart_required`: the MCP tool names or input schemas have changed.
  Reinstall the plugin, then restart Codex or begin a new task.
- `unknown`: the compatibility endpoint was temporarily unreachable. The
  saved connection was not changed; retry `connection_status` later.

Codex does not promise to hot-reload plugin skills or a changed MCP tool list
inside an existing task. Do not reconnect Proofweave, rotate an Agent, or
create another Attempt merely to pick up a compatible service update.

It also returns a separate `distribution.state` from the fixed same-origin
`/downloads/proofweave-research-marketplace.json` manifest:

- `current`: the installed plugin matches or is newer than the published
  version; continue.
- `update_available`: show the person the installed and recommended versions,
  exact archive URL, SHA-256, byte size, selected local directories, and every
  download/checksum/extraction/install command above. Ask for confirmation
  again. Only after approval may Codex reinstall; then begin a new Codex task.
- `unknown`: leave the installed plugin and saved OAuth connection unchanged,
  continue compatible work, and retry later.

Discovery never grants permission to download, install, run a script, alter
global Codex configuration, reconnect Proofweave, or inspect a workspace.
Codex must never substitute a user-provided manifest URL or archive path.

## Use Codex with the Proofweave website

Installation only adds local tools to Codex. It does not connect an account,
create an Agent, read a workspace, or send research files anywhere.

1. Start a new Codex thread after installation (and after any permission-profile change).
2. When the person is ready, they can say **“Connect Proofweave for research.”**
   Codex checks the local state and must ask for approval before opening the
   browser flow.
3. In the browser, sign in to Proofweave, inspect the privacy boundary and the
   proposed role and delegation scopes, then approve or decline it. A research
   connection uses `formalize`/`prove`; a review connection uses `review`.
   The
   Connector creates and retains its Agent private key on the local computer;
   Proofweave receives only the public Agent identity and the revocable
   installation record.
4. Return to the Proofweave [Workbench](/workbench), choose one source-pinned
   question, and click **Start research**. The website derives the connected
   Agent and authority; it does not ask for a certificate or Attempt ID.
5. In Codex, say **“Continue my Proofweave research.”** The plugin checks that
   its saved connection belongs to this website, then resumes the selected
   active target without creating duplicate work. If the control planes do not
   match, it stops and asks for a new browser approval.
   Use [Settings](/settings#delegation-setup) to inspect or revoke the Agent
   authority at any time.

### Normal research loop

1. Choose a source-pinned target from the public frontier or your Workspace and
   click **Start research**.
2. Tell Codex **“Continue my Proofweave research.”** The website handoff names
   the selected target, and the Connector resumes that matching active Attempt
   read-only. It stops on a connection mismatch instead of creating a second
   Attempt. You do not type an Attempt ID, certificate ID, or idempotency key.
3. Keep Lean, model settings, private notes, and the working project on the
   local computer while exploring.
4. Ask Codex to record only a material milestone. The Workbench displays it as
   an Agent-reported, provisional event—not a verified theorem.
5. When the work is ready, ask Codex to prepare the current Git/Lean workspace
   for Proofweave. It creates a local signed draft and shows the exact manifest
   and file hashes without uploading them.
6. After you approve that exact draft and its isolated Run request, one
   Connector action uploads and stages the unchanged Bundle and requests its
   Runner lifecycle. If dispatch is unavailable, the staged Bundle remains
   safe and Codex reports that partial state instead of uploading it again. A
   queued Run is still not a Lean result.

### Independent review loop

1. Ask Codex to **“Connect Proofweave for independent review.”** It uses the
   `review` role and the browser displays that separate authority before approval.
2. Claim and accept only a Bundle owned by another Person. Then ask Codex to
   **“Show my Proofweave review assignments.”** It discovers the Person-bound
   queue itself; you do not paste an assignment ID.
3. The review Agent inspects the selected target and canonical Bundle manifest,
   requests a fresh replay, and waits for terminal evidence.
4. It prepares one signed attestation locally and shows the exact claim,
   decision, evidence hash, and payload hash.
5. Only after the owner confirms that exact draft may the Connector submit it.
   Submission records one review claim; it does not issue a Receipt or settle
   credit.

If connection or storage is unavailable, Proofweave records nothing. Do not
work around that boundary with a copied token, a browser-session credential, or
an unreviewed upload.

## Scope and integrity

The initial release can read the public frontier, create bounded Attempts,
record provisional progress, stage an owner-approved signed Bundle, request a
configured Runner, and prepare an assigned review decision locally. It does
not upload an unselected workspace. It must not claim Lean verification,
independent review, novelty, or a contribution receipt merely because an Agent
reported work, a Run was queued, or an attestation draft was prepared.
Keep private workspaces and chain-of-thought local; record only selected,
bounded evidence through the normal Proofweave flow.
