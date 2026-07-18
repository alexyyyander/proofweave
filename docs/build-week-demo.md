# Build Week reference and live-Receipt demo

The public `/demo` route is a compact, executable view of Proofweave's trust
model. It uses one checked-in Lean 4.30 Core fixture so a visitor can verify the
complete evidence protocol without signing in. A separate live-network panel is
shown only when shared storage contains a cryptographically valid Receipt from
the hosted replay path.

## What is real

The generated reference record contains:

1. a Person-signed delegation certificate whose Agent public key matches the
   Artifact Bundle;
2. a `pw-artifact-bundle-v3` signed by that Agent and bound to an exact Git
   commit, workspace objects, target declaration, Lean toolchain, and no-sorry
   policy;
3. a signed Runner result produced only after the checked-in
   `core-success` fixture exits successfully under Lean 4.30;
4. three separately signed review claims from Person identities different from
   the Attempt owner; and
5. an issuer-signed reference receipt that satisfies the checked receipt
   policy.

`GET /api/demo/verify` re-hashes the displayed source and the exact archive,
patch, and Lake-manifest bytes. It then verifies the Person delegation, Agent
Bundle, Runner result, review attestations, receipt signature, and receipt
policy. The response contains only a bounded public projection; fixture private
keys are not written to disk.

## Honest boundary

The interactive verification console is a generated protocol fixture, not a
live network contribution, and it is not credited to a real participant. The
live-network panel is deliberately separate. It appears only after a fresh E2B
Lean replay, three signed review gates from owners different from the Attempt
owner, and an issuer-signed Receipt have been persisted and re-verified.

For the Build Week path, two owners are explicitly labelled
`Build Week Mocker 1st (demo)` and `Build Week Mocker 2nd (demo)`. They are not
human participants. Mocker 1st owns the fresh reproducibility replay;
Mocker 2nd owns kernel and pinned-project acceptance. Each has a distinct
Person key, Agent key, possession proof, review-only delegation, and signed
attestations. This exercises multi-owner enforcement without inventing human
review.

The fixture remains useful because it fails closed: changing the signed Git
commit, workspace hashes, target, Run evidence, reviewer identities, or receipt
claims invalidates at least one public check.

## Regenerate and validate

Regeneration requires the repository's pinned Lean/Lake 4.30 toolchain and a
Node.js build with zstd support:

```bash
npm run demo:fixture:generate
npm run demo:check
```

Regeneration creates fresh short-lived demo signing keys in memory, writes only
public keys and detached signatures, runs the checked Lean fixture, and binds
the record to the current full Git commit SHA. Review the generated JSON diff
before committing it.

The repository-wide `npm run check` includes `demo:check` and rendered-route
coverage for `/demo` and `/api/demo/verify`.

## Close one live Bundle

Operators use the protected GitHub Actions workflow
`Proofweave Build Week live Receipt`. It accepts one exact succeeded Artifact
Bundle hash, creates both labelled mock owners idempotently, distributes the
three required review jobs, replays the Bundle in a fresh E2B sandbox, records
the signed attestations, and issues the Receipt. The workflow environment keeps
four distinct mock Person/Agent private keys and the Receipt issuer key in
GitHub environment secrets; none are printed in the audit output.

The underlying phases can also be audited locally against an authorized shared
store:

```bash
npm run demo:live:prepare -- sha256:<bundle-hash>
npm run runner:trusted:once
npm run demo:live:finalize -- sha256:<bundle-hash>
```

## Three-minute walkthrough

1. Open `/demo` and state the problem: Agent work is easy to generate but hard
   to attribute and trust.
2. Walk down the Person → Agent → Lean → independent review → Person credit
   rail.
3. Select **Re-run all checks** and show the six reference protocol boundaries.
4. In the separate live-network panel, open the persisted Receipt and recheck
   its issuer signature, exact Run, replay evidence, and review claims.
5. Show the exact Lean theorem and the content-addressed Bundle/Receipt hashes,
   then open a real frontier target from `/explore`.

For a competition submission, record the qualifying Codex `/feedback` session
ID and the GPT-5.6 work separately. Never insert a model or session claim that
cannot be backed by the official Codex record.
