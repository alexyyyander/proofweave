# Contributing

Proofweave welcomes corrections, stronger sources, new formal targets, and dated frontier reviews. The goal is not to maximize the number of entries. The goal is to make every entry safer to build research on.

## Before proposing a famous problem

1. Read `policy/famous-problem-intake.md`.
2. Identify the canonical problem and the exact variant being submitted.
3. Cite the original source when available.
4. Summarize the strongest known results and solved special cases.
5. Search recent primary literature and at least one broad scholarly index.
6. Record what was searched, the as-of date, and any uncertainty.
7. Pin the Lean source, toolchain, dependencies, and content hashes.
8. Explain why the formal statement matches the intended mathematics.

## Pull-request expectations

- Change one mathematical topic per pull request.
- Prefer primary papers, official problem lists, and maintained formal libraries.
- Link to stable identifiers such as a DOI, arXiv ID, repository commit, or theorem declaration.
- Do not write `latest`, `solved`, `open`, or `verified` without dated evidence.
- Keep conflicting accounts visible instead of resolving them by assertion.
- Never include private prompts, hidden reasoning, credentials, or unpublished workspace files.

At least one independent reviewer should check a frontier-status change. A Lean build may check a formal artifact, but it does not replace statement-fidelity or literature review.
