# Build Week demo runbook

The public demo has one narrative and two independently truthful evidence paths:

- `/` explains the user promise and plays the Person → Agent → evidence →
  Receipt journey;
- `/demo` lets anyone re-verify a checked Lean 4.30 reference fixture and reject
  a tampered copy without signing in; and
- the live-network panel links to a persisted Receipt produced by the hosted
  Turso → Render trusted Runner → E2B → independent review → issuer path.

The reference fixture makes the protocol deterministic during a presentation.
The live Receipt proves that the deployed network path has also completed. Do
not blur these two claims.

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

Before recording or presenting, run the complete release preflight:

```bash
npm run demo:e2e:check
npm run demo:release:check
```

`demo:e2e:check` starts Lean locally against the checked fixture.
`demo:release:check` is read-only: it checks the deployed homepage, Demo, 6/6
reference verifier, tamper rejection, the internal live protocol boundary, and
that smoke-test evidence is absent from the public Receipt index.
Pass another deployment URL as the final argument when rehearsing a preview:

```bash
npm run demo:release:check -- https://preview.example
```

## Close one live Bundle

The normal execution path records one exact signed Bundle in Turso, sends an
authenticated empty-body wake to the hosted trusted Runner on Render, and lets
that trusted process claim the durable lease and create a fresh E2B sandbox.
The legacy GitHub Actions E2B filename is secretless diagnostics only and must
not be presented as a Runner. The exact current-release live closure remains a
release gate until the hosted Runner wake, terminal signed result, independent
review, Receipt, and Credit share one persisted correlation trace.

Operators can prepare and finalize the labelled mock-review phase locally
against an authorized shared store; execution itself should be observed through
the hosted Runner:

```bash
npm run demo:live:prepare -- sha256:<bundle-hash>
npm run demo:live:finalize -- sha256:<bundle-hash>
```

The historical `Proofweave Build Week live Receipt` workflow remains disabled
in its empty demo Environment. It is retained as historical source, not as a
supported recovery or diagnostic path.

## Three-minute walkthrough

### 0:00–0:35 — the product promise

Open `/`. Say: “Agent work is easy to generate; useful mathematical progress is
hard to coordinate, verify, and attribute.” Scroll through the six evidence
moments. Emphasize that private reasoning stays local and only owner-approved
evidence enters the shared network.

### 0:35–1:05 — a real user entry

Open `/explore`. Use the **Begin with bounded formalization** row rather than a
grand conjecture. Open one pinned target, show its source and Lean environment,
then follow **Start this contribution** to the workspace handoff. For a recorded
demo, an already connected presenter account may show the existing Attempt; do
not create a throwaway Attempt on stage.

### 1:05–2:10 — verification that can fail

Open `/demo#verification-console`. Select **Re-verify signed evidence** and show
all six checks passing. Then select **Tamper-test a copy** and show the artifact
integrity gate reject the changed byte. State explicitly that this deterministic
reference uses two labelled mock owners; its hashes, keys, signatures, owner
separation, Runner record, and Receipt policy are real.

### 2:10–2:45 — the deployed network closed the loop

In the separate live-network panel, open **Inspect live Receipt**. Point out the
fresh isolated Run, three signed independent attestations across two distinct
mock Persons, issuer key, content-addressed Bundle, portable verification bundle,
and immutable lifecycle. Say that mock identity is a demo limitation, not a
hidden human-review claim.

### 2:45–3:00 — return to the frontier

Return to `/explore` and finish with the actual product loop: choose a bounded
task, continue it through a personally delegated Agent, publish selected
evidence, let a different owner verify it, and preserve every useful dependency
as public contribution history.

## Presentation fallback

Keep the live Receipt URL open in a second tab before recording. If the hosted
Runner or E2B is delayed during rehearsal, do not claim a new live replay:

1. use the existing persisted live Receipt to demonstrate the completed hosted
   chain;
2. use **Re-verify signed evidence** for the deterministic 6/6 verifier;
3. use **Tamper-test a copy** to prove the verifier fails closed; and
4. show the most recent `npm run demo:release:check` result in the repository.

If any of those three public surfaces is unavailable, stop and fix the release;
do not replace missing evidence with slides or narration.

## Recording checklist

- Use a clean browser window at a stable desktop viewport and 100% zoom.
- Preload `/`, `/explore`, `/demo#verification-console`, and the live Receipt.
- Hide bookmarks, notifications, private tabs, tokens, and local file paths.
- Keep mock labels visible whenever their records are on screen.
- Never show prompts, private reasoning, signing keys, OAuth tokens, or database
  credentials.
- Record the qualifying Codex `/feedback` session ID and GPT-5.6 work separately.

Never insert a model, session, reviewer, or verification claim that cannot be
backed by the official Codex or Proofweave record.
