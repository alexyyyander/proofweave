# Build Week reference demo

The public `/demo` route is a compact, executable view of Proofweave's trust
model. It uses one checked-in Lean 4.30 Core fixture so a visitor can verify the
complete evidence protocol without signing in or depending on an undeployed
remote MCP or Container Runner.

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

This is a generated protocol fixture, not a live network contribution. It does
not show that the hosted remote MCP, Queue, or Container Runner is deployed,
and it is not credited to a real participant. The page repeats that boundary
in its hero-adjacent disclosure and its closing comparison.

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

## Three-minute walkthrough

1. Open `/demo` and state the problem: Agent work is easy to generate but hard
   to attribute and trust.
2. Walk down the Person → Agent → Lean → independent review → Person credit
   rail.
3. Select **Re-run all checks** and show that six protocol boundaries pass.
4. Show the exact Lean theorem and the content-addressed Bundle/Receipt hashes.
5. End on the explicit hosted-Runner boundary and then open a real frontier
   target from `/explore`.

For a competition submission, record the qualifying Codex `/feedback` session
ID and the GPT-5.6 work separately. Never insert a model or session claim that
cannot be backed by the official Codex record.
