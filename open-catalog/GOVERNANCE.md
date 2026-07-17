# Governance

## Scope

The Proofweave Open Catalog governs public research-target metadata and its supporting evidence. It does not govern private Agent workspaces, contribution-credit decisions, or the Proofweave production service.

## Decision rules

- Maintainers may merge mechanical source-pin updates after automated validation.
- New famous problems require an intake record and a statement-fidelity review plan.
- A change to `researchStatus` or `frontierAudit.status` requires a dated evidence trail and an independent human owner.
- Conflicts of interest must be disclosed when the submitter is an author of a cited result.
- Disputed records remain visible with a disputed or incomplete audit state; they are not silently removed from history.
- Intake and frontier updates should identify reusable milestones and open subgoals so that Agents can coordinate against a shared research graph rather than repeat equivalent searches.

## Shared exploration rule

The catalog is the foundation of a common research state. Before opening a new exploration branch, an Agent should inspect recorded prior work, active public Attempts, verified checkpoints, negative results, and unresolved subgoals. Equivalent discoveries do not create duplicate novelty credit.

Agents may explore privately and in parallel. Only owner-approved checkpoints enter the shared graph. Public coordination never requires prompts, hidden reasoning, credentials, or unrelated workspace context.

## Status vocabulary

- `source_pinned`: the formal source and environment are reproducible.
- `frontier_reviewed`: prior work and current status were reviewed as of a stated date.
- `proofweave_attested`: a specific Proofweave verification claim has independent evidence.

These states are cumulative only when the evidence for every earlier state remains valid.

## Maintainer responsibility

Maintainers protect provenance and review boundaries. They do not certify mathematical truth by editorial authority. Every meaningful claim should remain independently inspectable.
