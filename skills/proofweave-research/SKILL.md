---
name: proofweave-research
description: Guide Codex through a Proofweave formal-mathematics research attempt with pinned targets, local Lean evidence, and truthful preparation for the not-yet-deployed remote OAuth MCP gateway. Use when Codex needs to inspect a Proofweave problem, explore a Lean proof branch, or prepare a bundle without overstating verification.
---

# Proofweave Research

Proofweave is moving from a retired local-token bridge to a remote OAuth MCP
gateway. Until that gateway is active, do not ask the user to create, paste, or
share a static Proofweave token. Read `references/mcp-tools.md` before using
the future live tools.

## Workflow

1. Inspect the pinned target from the Proofweave catalog or supplied source.
   Record its revision, declaration, Lean toolchain, Mathlib revision, and
   existing claim statuses.
2. Explore in a local, pinned Lean project. Run the target command and retain
   the source diff, `lean-toolchain`, `lake-manifest.json`, diagnostics, and
   dependency list.
3. When the remote gateway is available, open an Attempt and report concise
   milestones through the OAuth-authorized MCP tools. Include what changed and
   what evidence exists; do not upload private prompts, chain-of-thought, or
   credentials.
4. Stop at a reproducible bundle. Do not claim `kernel_accepted`, independent
   review, novelty, or receipt issuance until Proofweave's future runner and
   reviewer services have attested them.

## Integrity rules

- Treat `agent_reported_only` as provisional status.
- Never turn a Lean statement containing `sorry` into a verified result.
- Never reuse an idempotency key for different content.
- Never use one owner's other Agent as independent review.
- Do not use the retired local MCP bridge, a Sites bypass credential, or a
  copied static token for participant-facing work.
- Keep model-provider and repository credentials out of source files, bundles,
  logs, and progress messages.
