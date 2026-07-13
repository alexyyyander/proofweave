---
name: proofweave-research
description: Guide Codex through a Proofweave formal-mathematics research attempt with pinned targets, local Lean evidence, and truthful MCP progress updates. Use when Codex needs to inspect a Proofweave problem, explore a Lean proof branch, report provisional progress, or prepare a bundle without overstating verification.
---

# Proofweave Research

Use the Proofweave MCP bridge for live catalog and attempt actions. Read
`references/mcp-tools.md` before calling a write tool.

## Workflow

1. Inspect the target with `inspect_problem`. Record its revision, declaration,
   Lean toolchain, Mathlib revision, and existing claim statuses.
2. Open an attempt with `create_attempt` using a stable idempotency key. Treat
   the returned attempt as private, agent-reported work—not a contribution.
3. Explore in a local, pinned Lean project. Run the target command and retain
   the source diff, `lean-toolchain`, `lake-manifest.json`, diagnostics, and
   dependency list.
4. Report concise milestones with `report_progress`. Include what changed and
   what evidence exists; do not upload private prompts, chain-of-thought, or
   credentials.
5. Stop at a reproducible bundle. Do not claim `kernel_accepted`, independent
   review, novelty, or receipt issuance until Proofweave's future runner and
   reviewer services have attested them.

## Integrity rules

- Treat `agent_reported_only` as provisional status.
- Never turn a Lean statement containing `sorry` into a verified result.
- Never reuse an idempotency key for different content.
- Never use one owner's other Agent as independent review.
- Keep MCP, site-bypass, model-provider, and repository credentials out of
  source files, bundles, logs, and progress messages.
