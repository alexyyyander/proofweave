# Proofweave worktree inventory

Status: M0 source-control record

Recorded: 2026-07-27

Main baseline: `origin/main@1c7b6b4666a2b270b9d5d084d4cbe2f2ac768fa8`

## Rules

- `/private/tmp/proofweave-mcp-control-plane` is the canonical clean `main`
  release worktree after it is fast-forwarded to the recorded main baseline.
- Feature, stabilization, deployment-export, and historical Sites worktrees
  are never release sources.
- A release command must verify that its worktree is clean and that `HEAD`
  equals the locally fetched `origin/main`.
- Worktrees are not deleted until their unique commits and uncommitted files
  have been classified.
- Historical `sites/*`, `sites-managed/*`, and `proofweave-sites/*` refs record
  deployment lineage. They are not merged into product source.

## Inventory

| Path | Branch/revision at audit | Purpose | Disposition |
| --- | --- | --- | --- |
| `/Users/alexyu/Documents/proofwave` | `codex/e2b-runner-source-overlay@eb99e2d` when inventoried | Runner repair work in the shared user workspace | Do not deploy; its reviewed descendants are already on main |
| `/private/tmp/proofweave-stabilization-m0` | `codex/stabilization-m0`; working tree based on `origin/main@1c7b6b4` with post-rebase feature commits and reviewed uncommitted changes | M0/M1 release manifest, deterministic queue, dependency, budget, and truth-boundary work | Active reviewed feature worktree; its mutable HEAD is not a release reference; merge through PR #108 only |
| `/private/tmp/proofweave-mcp-control-plane` | `main@8fc525b`, two commits behind | Canonical clean release worktree | Fast-forward only to `origin/main@1c7b6b4` before release verification |
| `/private/tmp/proofweave-hf-runner` | `codex/huggingface-runner@1c7b6b4` | Hosted Runner/export history | Temporary build/reference worktree; not a release source |
| `/private/tmp/proofweave-sites-main` | detached `1684fdf` | Sites deployment history | Read-only historical reference; never merge into main |

## Superseded Runner fix

Local commit:

```text
3d629e29184ea7f5432fd3edb4509cc0c78db698
```

Main commit:

```text
a564dae46e9517ebc46c0076d8f9b7de843d9a8d
```

Both have stable patch ID:

```text
81b0ed640fcb6de64410b23a54053c90843a1a8e
```

The five affected files are content-identical at both tips. The local commit is
therefore superseded and must not be cherry-picked, rebased, or resubmitted.

## Reviewed remote branches

- `origin/codex/actions-budget-guardrails` is superseded by the reviewed M1
  implementation now rebased at `522120d`; do not merge both.
- The React/RSC security updates were reproduced in the M0 lockfile rather
  than merging a stale Dependabot branch.
- The E2B production-dependency branch remains deferred because its optional
  `undici8` dependency requires a newer Node 22 minor than the reviewed Runner
  image. E2B stays at `2.35.0`; vulnerable transitive `tar` and
  `brace-expansion` versions were refreshed within compatible ranges.

Old Runner fix branches whose patches are already in main remain audit history.
Delete or archive them only after M1 restores a reliable protected-branch
workflow.
