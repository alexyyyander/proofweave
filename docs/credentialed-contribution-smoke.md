# Credentialed contribution release smoke

The credentialed release smoke is the final operator gate for one real
Proofweave contribution path:

```text
Person A -> research Agent -> Attempt -> signed executable Bundle
         -> accepted primary Lean Run
Person B -> review Agent -> fresh replay -> signed claim attestations
         -> policy-valid Contribution Receipt -> public re-verification
```

It is intentionally separate from
`scripts/check-ordinary-user-release.mjs`. The ordinary-user preflight makes
unauthenticated, read-only HTTP checks. This gate examines a privacy-minimal
JSON projection collected **after** real credentialed operations.

## Safety boundary

`scripts/check-credentialed-contribution-release.mjs` is offline and
fail-closed:

- it makes no network request;
- it does not open the control-plane database;
- it accepts no OAuth token, cookie, password, private key, or bearer header;
- it creates no Person, Agent, delegation, Attempt, Bundle, Run, review, or
  Receipt;
- it does not execute Lean or cryptographically verify signatures;
- it never turns fixture data or successful booleans into a real contribution.

Passing means only that a complete redacted evidence graph is internally
consistent. The actual sign-in, browser consent, local key ownership, owner
approval, uploaded bytes, isolated execution, independent reviewer decisions,
issuer signing, and public verification must already have happened and must be
retained in their authoritative stores.

Do not call a dry-run fixture a production smoke. Keep the resulting report
with the release record and link each redacted identifier back to operator-only
audit evidence.

## Release prerequisites

Before collecting evidence:

1. deploy Sites, MCP gateway, and Runner from one reviewed Git SHA;
2. confirm Turso is the sole production authority and the required migration
   head is applied;
3. observe `read_write` and `writesEnabled: true`;
4. keep GitHub Actions out of the participant execution path;
5. use a new Person A and a genuinely different Person B;
6. use active research and review delegations with distinct Agent keys;
7. approve only the exact Bundle files and hashes shown to Person A;
8. preserve primary Runner and independent replay evidence;
9. issue a Receipt only after the three v1 policy claims are attested;
10. re-download and verify the public Receipt against the current issuer
    keyset.

Take the second release observation only after public Receipt verification.
The gate requires all smoke events to fit between the two observations and
requires the Git SHA, database fingerprint, migration head, and mode to remain
unchanged.

## Evidence input

Use either one regular, non-symlink JSON file:

```bash
node scripts/check-credentialed-contribution-release.mjs \
  --evidence-file /secure/operator/path/release-smoke.redacted.json
```

or one bounded environment value:

```bash
PROOFWEAVE_CREDENTIALED_RELEASE_EVIDENCE_JSON='{"schemaVersion":"..."}' \
  node scripts/check-credentialed-contribution-release.mjs
```

The JSON limit is 512 KiB. Do not place credentials in either source. Prefer a
mode-`0600` temporary file outside the repository; delete it according to the
release evidence retention policy.

The schema is
`pw-credentialed-contribution-release-evidence-v1`. Its required top-level
objects are:

| Object | Required evidence |
| --- | --- |
| `release` | expected Git SHA plus before/after Sites, gateway, Runner, Turso fingerprint, migration, and `read_write` observations |
| `researcher` | Person A, research Agent, active connection, owner-matched delegation, `formalize` or `prove` scope |
| `attempt` | exact Person, Agent, delegation, problem revision, state, and creation time |
| `bundle` | executable v2/v3 Bundle, manifest hash, Attempt/revision/Agent/delegation, target statement, valid Agent signature projection, staging time |
| `runner` | exact Attempt and Bundle, request/result hashes, accepted kernel, all policy checks passed, valid Runner signature projection |
| `reviews` | exactly `bundle_reproducible`, `kernel_accepted`, and `project_accepted`; every reviewer differs from Person A and owns an active review-scoped Agent |
| `receipt` | non-verification policy-v1 Receipt bound to the exact research beneficiary, Attempt, target, Bundle, Run, and three review attestations |
| `publicReceiptVerification` | current verified Receipt/hash with issuer keyset and dependency closure checked |

For both `bundle_reproducible` and `kernel_accepted`, `reviews[].replay` is
mandatory. It must be a distinct Run for the exact assignment and Bundle, pass
every Runner policy check, and have a terminal evidence hash equal to the
Attestation evidence hash. The redacted projection also carries the assignment
acceptance time, replay request time, Runner start and finish times, evidence
recording time, and the exact reviewer Person, Agent, and delegation. The gate
requires:

```text
primary Run finished
  ≤ assignment accepted
  ≤ replay requested
  ≤ replay Runner started
  ≤ replay Runner finished
  ≤ replay evidence recorded
  ≤ Attestation signed
```

This mirrors the authoritative verification store's binding boundary instead
of treating an arbitrary second successful Run as independent replay evidence.
Other claims must carry their own evidence and do not inherit either replay
claim.

All hashes use lowercase `sha256:<64 hex>`. Release revisions use a lowercase
40–64 character Git revision. All timestamps are UTC ISO-8601.

## What failure means

Any missing object, read-only observation, deployment drift, database drift,
chronology error, same-owner review, missing review scope, non-executable
Bundle, unaccepted Run, failed policy check, missing claim, broken Receipt
edge, unverified public Receipt, or credential-like field exits nonzero.

Do not “fix” a failure by editing the redacted projection to look successful.
Return to the authoritative service record, resolve the failed operation, and
export a new projection.

## Required manual acceptance record

Keep these human-observed facts alongside a passing report:

- Person A approved the exact checkpoint and Bundle hashes;
- the Bundle contained no prompt, chain-of-thought, or credential;
- the primary Run and Person B replay used isolated workspaces;
- Person B was not another account or Agent owned by Person A;
- the review decisions were based on inspectable evidence;
- the public Receipt page and portable verification bundle were reachable;
- production returned to its intended post-smoke operating mode.

This manual record and the offline gate complement each other. Neither one,
alone, proves that the full contribution chain ran.
