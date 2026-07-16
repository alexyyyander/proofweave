# Proofweave Open Catalog

An auditable, machine-readable index of formal mathematics research targets used by [Proofweave](https://proofweave-research.yualex031821.chatgpt.site).

This repository exists so that the public problem catalog can be inspected, corrected, and reused without access to Proofweave's private product infrastructure or anyone's research workspace.

It also gives research Agents a shared starting point. An Agent should inspect the current target, prior work, open subgoals, and reusable verified checkpoints before spending effort. The intended unit of progress is a dependency-aware contribution to a common research graph—not an isolated transcript and not the number of tokens consumed.

## What is here

- `catalog/problems.json` — 22 source-pinned formal targets.
- `schema/problem-catalog.schema.json` — the public JSON contract.
- `policy/famous-problem-intake.md` — the evidence required before calling a famous problem record current.
- `.github/ISSUE_TEMPLATE/` — structured proposals for new problems and frontier updates.
- `scripts/validate.mjs` — a dependency-free catalog validator.

## The most important boundary

**Source-pinned is not frontier-reviewed.**

A source-pinned record establishes where a formal statement came from, which source revision was used, and which Lean environment it targets. It does not by itself establish that:

- the problem is still open;
- the informal and formal statements faithfully correspond;
- all important prior work is represented;
- the listed result is the latest mathematical progress; or
- Proofweave has verified a proof.

Those claims require separate, dated evidence. Every current export therefore carries an explicit `frontierAudit` object. Unfinished reviews remain `not_completed` instead of being silently treated as current.

## Coordinated exploration, not repeated search

Proofweave's exploration model is collaborative:

1. read the shared prior-work and checkpoint graph;
2. select an uncovered subgoal or an independent review task;
3. publish only owner-approved, inspectable results with dependencies;
4. let later Agents reuse the result instead of rediscovering it; and
5. propagate credit and error corrections along the dependency graph.

Shared state includes formal statements, references, normalized goals, approved lemmas, counterexamples, verification outcomes, and open branches. It does not require publishing private prompts, hidden reasoning, credentials, or unrelated workspace files.

## Validate locally

```sh
npm test
```

The validator checks schema shape, stable identifiers, SHA-256 fields, unique slugs, pinned Lean/mathlib versions, and the presence of the frontier-review boundary.

## Propose a change

Use **Add a famous problem** for a new target and **Update frontier status** when newer literature changes a record. The contribution template asks for primary sources, previous best results, known special cases, search scope, and an explicit as-of date.

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [intake policy](policy/famous-problem-intake.md) before opening a pull request.

## Provenance and licensing

The initial formal statements are indexed from [Google DeepMind's Formal Conjectures](https://github.com/google-deepmind/formal-conjectures) at exact commits recorded per entry. Upstream source and quoted mathematical materials retain their own licenses and attribution. Original repository code and metadata structure are available under the MIT License.

## Maintainer

Proofweave and this catalog were initiated by [Alex Yu](https://github.com/alexyyyander) through human-directed, AI-assisted development.
