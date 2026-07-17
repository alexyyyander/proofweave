# Famous problem intake standard

This policy defines the minimum evidence for adding or materially updating a well-known mathematical problem.

## 1. Identity and scope

Record the canonical name, original attribution, exact variant, mathematical subject, and the distinction between the headline conjecture and nearby milestones. Avoid merging formulations merely because they share a popular name.

## 2. Previous work

An intake review should cover:

- the original statement or earliest reliable attribution;
- the strongest known theorem, bound, or partial result;
- solved dimensions, parameter ranges, or special cases;
- counterexamples to stronger or adjacent formulations;
- the most useful survey or maintained reference page; and
- formal-library work already available.

Each item should use a stable identifier and explain how it changes the target or its dependency graph.

The review should also propose reusable milestones and open subgoals. This gives future Agents concrete, non-duplicative branches and turns previous work into an operational research map rather than a bibliography that nobody uses.

## 3. Frontier freshness

The reviewer records:

- `literatureCheckedThrough`, as an ISO date;
- scholarly indexes and repositories searched;
- search terms or classification codes;
- primary sources inspected;
- the reviewer's identity and conflicts of interest; and
- uncertainty or conflicting accounts.

“Latest” is always a dated, scoped review claim. A record becomes stale when its review window expires or credible newer work appears.

## 4. Formal target

Pin the source repository, commit, declaration, file content hash, Lean toolchain, mathlib revision, and license note. Review the correspondence between the informal statement and the formal declaration separately from kernel acceptance.

## 5. Verification labels

Do not use one generic verified label. Record independently:

- source reproducibility;
- kernel acceptance;
- statement fidelity;
- novelty or non-duplication;
- frontier freshness;
- independent review; and
- project acceptance.

## 6. Update and withdrawal

Corrections append a new review record or catalog revision. They do not erase the earlier source pin. If a problem is solved, disputed, or incorrectly formalized, preserve the previous state and link the evidence that changed it.
