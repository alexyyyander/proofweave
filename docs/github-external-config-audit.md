# GitHub external configuration audit

Checked-in workflow review cannot prove GitHub's server-side authorization
state. Run this read-only audit before a release is merged, before a production
drill begins, and again in the final same-SHA release record.

The audit closes the external parts of the GitHub recovery gate:

- `proofweave-runner-alpha` requires the reviewed approver, denies administrator
  bypass, and accepts only the reviewed deployment branch patterns;
- the two reviewed recovery workflows are `disabled_manually` and have zero
  `in_progress`, `pending`, `queued`, `requested`, or `waiting` runs;
- recovery Runner image, E2B template, template build, and approved-image
  variables exactly match the literal values in the Render Blueprint;
- the production Environment contains only the allowlisted production secret
  names and contains no `DEMO`, `MOCK`, `FIXTURE`, or `SMOKE` authority;
- repository Actions policy enforces immutable SHA references; and
- every checked-in third-party Action is pinned to a full 40-character commit.

This is an instantaneous provider observation, not proof of continuous
isolation. Keep its observation interval together with the release SHA and the
other freeze evidence described in
[`runner-queue-0043-cutover-runbook.md`](runner-queue-0043-cutover-runbook.md).

## Policy

The reviewed expectation is
[`config/github-external-config-policy.json`](../config/github-external-config-policy.json).
Changes to the repository identity, approver, deployment branches, secret-name
allowlist, or recovery workflow set are release-policy changes and require
independent review.

Expected non-secret Runner values are not duplicated in that file. The auditor
reads them directly from
[`deploy/huggingface-runner/render.yaml`](../deploy/huggingface-runner/render.yaml)
and compares their SHA-256 hashes with GitHub Environment variables. Raw
variable values are never copied into evidence.

The historical `build-week-live-receipt.yml` workflow belongs to
`proofweave-demo-alpha`. It must still be disabled and idle during a production
freeze, but demo/mocker keys must never be stored in
`proofweave-runner-alpha`.

## Run

Use a clean worktree at the exact candidate or release commit. Authenticate
GitHub CLI with an account that can read repository Actions, Environment
protection, deployment-branch policies, Environment variables, and Environment
secret metadata. The auditor uses `GH_TOKEN`/`GITHUB_TOKEN` when supplied by an
approved secret provider, otherwise it reads the existing `gh auth` credential
without printing it.

```bash
gh auth status
npm run github:external-config:check
npm run github:external-config:audit -- \
  --output /secure/release-records/github-external-config.json
```

The output path must not already exist. The evidence file is created mode
`0600`. Omit `--output` to emit the complete evidence JSON on standard output.

Exit status:

| Status | Meaning |
| --- | --- |
| `0` | Complete observation; every reviewed policy matched |
| `1` | Complete observation; one or more classified policy mismatches |
| `2` | Audit could not establish a complete observation |

Any unknown, forbidden, missing, malformed, truncated, unauthorized, or
network-failed observation blocks the release. Do not convert status `1` or `2`
into a warning.

## Evidence privacy

The JSON evidence contains:

- UTC start and finish;
- the full local commit SHA;
- repository and workflow identifiers;
- reviewer and branch-policy metadata;
- Environment variable names with expected/observed value hashes;
- Environment secret **names** and violation classifications;
- Actions policy and pinned Action references; and
- bounded finding codes.

It never contains the GitHub credential, request headers, secret values,
Environment variable values, API response headers, or API URLs/query strings.
The implementation also replaces provider/network errors with bounded error
codes so an upstream exception cannot echo a credential into a release log.

## Provider remediation order

When the audit fails, remediate provider state rather than editing the evidence:

1. cancel active recovery runs and manually disable both workflows;
2. remove demo/mocker secrets from the production Environment after preserving
   any still-needed demo authority in the separately reviewed demo Environment;
3. align the four non-secret Runner values with the Render Blueprint;
4. apply the reviewed required-reviewer, no-admin-bypass, and branch rules;
5. require full-SHA pinning at repository level; and
6. rerun the audit from the clean release worktree.

Never place a secret value in an issue, pull request, terminal transcript, audit
file, or command-line argument.
