# OpenAI Build Week submission packet

This file keeps the Devpost copy, judge instructions, qualifying Codex evidence,
and recording plan aligned with the deployed product. It is a preparation
artifact, not proof that the project has been finally submitted.

## Deadline and state

- Official deadline: **2026-07-22 00:00 UTC** / **2026-07-22 08:00 China Standard Time**.
- Internal freeze: **2026-07-21 18:00 China Standard Time**.
- Devpost project: [Proofweave](https://devpost.com/software/proofwave).
- Category: **Developer Tools**.
- Submission owner: **Individual**.
- Country of residence: must be confirmed by the owner in Devpost; do not infer it from location or timezone.

## Devpost project copy

### Name

Proofweave

### Tagline

A shared verification and attribution network for personally delegated formal-mathematics Agents.

### Description

Proofweave lets a person delegate a local Codex Agent to participate in formal
mathematics without turning private reasoning into a public transcript. A user
chooses a source-pinned target, opens a bounded Attempt, and keeps Lean files and
exploration on their own computer. Only an owner-approved checkpoint or signed
Artifact Bundle enters the shared network.

The product separates research progress from verification. An Agent report is
provisional. A Bundle binds exact source, dependencies, workspace objects, Git
state, target, and toolchain. A fresh isolated Lean run supplies execution
evidence. Different-owner Agents can sign claim-specific reviews, and a Receipt
is issued only after the required gates close. Useful lemmas, counterexamples,
formalizations, verification work, and downstream dependencies can therefore
remain attributable even when one person did not author the final theorem.

The working submission includes a public Sites application, a source-pinned
research catalog, a Codex plugin with a local OAuth-PKCE MCP Connector, D1/Turso
control-plane storage, signed evidence protocols, a protected E2B Lean Runner,
review workflows, and portable Receipt verification. The public demo lets any
judge re-check six evidence gates and then tamper with a copy to see the verifier
reject it. Two different-owner reviewers in the Build Week fixture are visibly
labelled mock identities; their keys and signatures exercise the enforcement
path but are not represented as human review.

Codex was used throughout the architecture, implementation, testing, PR, and
deployment workflow. GPT-5.6 Sol handled the longest multi-step implementation
and verification decisions; GPT-5.6 Terra handled faster repository inspection
and supporting tasks. The result is not an Agent marketplace or a winner-takes-
all theorem board: it is infrastructure for many people and their Agents to
coordinate on a shared mathematical frontier without duplicating hidden work.

## Built with

- Codex
- GPT-5.6 Sol
- GPT-5.6 Terra
- TypeScript
- React
- Next.js / vinext
- OpenAI Sites
- Cloudflare Workers and D1
- Turso / libSQL
- MCP
- OAuth 2.1 PKCE
- Lean 4.30
- E2B
- GitHub Actions
- Ed25519 signed evidence

## Required Devpost answers

| Field | Answer |
| --- | --- |
| Submitter Type | Individual |
| Country of Residence | **Owner confirmation required** |
| Category | Developer Tools |
| Repository | `https://github.com/alexyyyander/proofweave` |
| Judge test URL | `https://proofweave-research.yualex031821.chatgpt.site/` |
| `/feedback` Session ID | `019f6a44-601d-7cb3-be6e-83ced9dc5dc1` |

The qualifying task is the long-running Proofweave build task. Its local Codex
record identifies GPT-5.6 Sol and GPT-5.6 Terra turns and covers the product,
MCP integration, Runner, public verification demo, pull requests, and deployment.
Before final submission, open that task and run `/feedback` once so the Codex UI
confirms the same Session ID.

## Plugin / developer-tool judge instructions

**Supported platform:** tested on Codex for macOS Apple silicon with Node.js
`>=22.13.0`. Other operating systems have not completed beta acceptance.

**No-rebuild path:**

1. Open the [deployed product](https://proofweave-research.yualex031821.chatgpt.site/).
2. Use [Explore](https://proofweave-research.yualex031821.chatgpt.site/explore)
   to inspect source-pinned targets without an account.
3. Use the [executable verification demo](https://proofweave-research.yualex031821.chatgpt.site/demo#verification-console)
   to re-check the signed fixture and reject a tampered copy.
4. Inspect the linked live Receipt and portable evidence closure. Mock reviewer
   labels remain visible and must not be interpreted as human review.

**Optional Codex plugin path:** follow
[`/codex-install.md`](https://proofweave-research.yualex031821.chatgpt.site/codex-install.md).
Codex must display the two plugin commands and wait for approval. After install,
start a new task, ask for connection status, and approve the browser OAuth flow
only if you want to create a revocable local Agent installation. Installation
does not connect, create an Agent, or read any workspace by itself.

## 2:48 video plan

### 0:00-0:20 — the problem and product promise

- Show the deployed home page.
- Voiceover: “Agents can generate work quickly, but mathematical progress is
  hard to coordinate, verify, and attribute. Proofweave gives every person a
  delegated local research Agent and records only owner-approved evidence.”

### 0:20-0:48 — enter a bounded research task

- Open Explore and a source-pinned, bounded formalization target.
- Show the exact source, Lean environment, and **Start research** action.
- Avoid presenting an open grand conjecture as a near-term proof claim.

### 0:48-1:18 — Codex continues the Attempt

- Show the already installed Proofweave Research plugin in a clean Codex task.
- Ask: “Check Proofweave connection status, then continue my active research.”
- Show the bound Attempt and local-first boundary; do not expose tokens, private
  files, prompts, or chain-of-thought.
- Voiceover: “GPT-5.6 Sol helped implement the multi-step signed workflow and
  verification decisions; Terra accelerated repository inspection and support
  work in this qualifying Codex task.”

### 1:18-1:48 — from checkpoint to isolated evidence

- Use the workbench or prepared records to show:
  `checkpoint → signed Bundle → isolated Lean/E2B Run`.
- State that an Agent checkpoint is shared but unverified, and that a queued Run
  is not yet a Lean result.

### 1:48-2:23 — verification can fail

- Open the Demo verification console.
- Run **Re-verify signed evidence** and show 6/6 checks passing.
- Run **Tamper-test a copy** and show the artifact-integrity failure.
- Say: “These two different-owner reviewers are explicitly labelled mock demo
  identities. Their keys, signatures, owner separation, Runner result, and
  Receipt policy are real; this is not a claim of human review.”

### 2:23-2:40 — Receipt and public history

- Open the live Receipt.
- Point to the E2B replay, signed attestations, Bundle hash, issuer key, and
  portable verification bundle.

### 2:40-2:48 — close

- Return to Explore.
- Voiceover: “Proofweave turns isolated Agent sessions into a shared,
  reproducible mathematical research graph—one useful, verifiable step at a time.”

## Recording and upload gate

- Keep the final edit below 3:00; target 2:40-2:50.
- Include narration that explicitly covers Codex **and** GPT-5.6.
- Record a working product, not slides or design mockups.
- Hide bookmarks, notifications, tokens, private tabs, local paths, and secrets.
- Keep all mock-review labels visible.
- Upload to YouTube as Public or Unlisted.
- Open the final URL in a signed-out private window and verify audio, 1080p
  playback, description links, and visibility before adding it to Devpost.

## Final submission gate

Do not submit until all of these are true:

- both private-repository reviewer invitations have been sent;
- the owner has confirmed Country of Residence;
- `/feedback` in the qualifying Codex task confirms the Session ID;
- a public or unlisted YouTube URL passes signed-out playback;
- the Devpost name, tagline, description, repository, category, test URL,
  install instructions, video, and all required custom answers are present;
- `npm run demo:release:check` passes against production;
- the final submission status is `Submitted`, not `Draft`.
