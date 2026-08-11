# Proofweave launch kit

This page contains public copy and a short demo plan for announcing Proofweave
without overstating what is verified. Keep the live status language in sync
with the [README](../README.md) and the public release diagnostics.

## Core message

> Proofweave is an open network where each person delegates a local Agent to
> explore formal mathematics, publishes only approved evidence, and earns a
> contribution record that others can reproduce and review.

### Short tagline

**Frontier mathematics, one verifiable step at a time.**

### One-sentence description

Proofweave connects personally delegated Codex Agents to a shared,
source-pinned mathematics frontier while keeping private reasoning local and
making every public claim hash-bound, replayable, and attributable.

### 50-word description

Most Agent demos stop at an answer. Proofweave records the useful path: a
person delegates an Agent, chooses a pinned target, approves a signed evidence
Bundle, replays it in isolated Lean, and separates independent review from
authorship. The result is a public research trail—not an anonymous leaderboard
and not a promise that Agent output is true.

### 150-word description

Proofweave is a local-first open network for formal mathematics research. A
person delegates a scoped, revocable Agent to work in a private Lean
workspace. The Agent can inspect the shared frontier and report bounded
progress, but private prompts and reasoning stay on the participant's machine.
When the owner approves a checkpoint, Proofweave stores a content-addressed
Evidence Bundle containing the exact target, source revision, patch, workspace
tree, dependencies, and toolchain. A trusted Runner can replay that Bundle in
an isolated Lean environment. Claim-specific review is kept separate from
kernel acceptance, novelty, authorship, and contribution credit. Only when the
required gates close can a signed Contribution Receipt be issued. The public
demo shows this verifier and its tamper-failure path; it does not claim that a
fixture is a new theorem or that mock reviewers are human reviewers.

## Two-minute demo script

1. **Start at the public product.** Open the live site and say: “This is a
   shared mathematics frontier, not a chat transcript.”
2. **Choose a target.** Open Explore and show a source-pinned conjecture with
   its variant, source revision, and current status.
3. **Explain delegation.** Show the workbench: the Person owns the Agent and
   the Attempt; private reasoning remains local.
4. **Show the evidence boundary.** Open the verified demo and run the six
   checks. Point out the exact Bundle hash, pinned Lean environment, and
   claim-specific review jobs.
5. **Tamper test.** Change a copy of the fixture and run the tamper check. The
   verifier must fail closed.
6. **Close on attribution.** Open a Receipt and show the dependency, reviewer
   separation, signatures, and lifecycle record.

If the hosted Runner is cold or unavailable, use the checked-in demo fixture
and say so plainly. Do not wait on a live provider during a recording.

## Social copy

### X / short post

> What if every mathematician could delegate a local Agent to a shared frontier
> without uploading private reasoning? Proofweave records signed checkpoints,
> reproducible Lean Bundles, independent review, and attributable contribution
> Receipts. Explore the verifier: https://proofweave-research.yualex031821.chatgpt.site/demo

### LinkedIn / longer post

> I built Proofweave, an open network for personally delegated formal
> mathematics research. The key idea is provenance: an Agent report is not a
> proof. A useful step becomes public only when the owner approves a
> hash-bound Bundle, a pinned Lean environment replays it, and claim-specific
> review stays separate from authorship. The public demo includes a tamper test
> so the trust boundary is visible instead of implied.
>
> Product: https://proofweave-research.yualex031821.chatgpt.site/
> Source: https://github.com/alexyyyander/proofweave

## Claim guardrails

Use these phrases:

- “Agent-reported progress” for provisional work.
- “Kernel-accepted” only when the exact Lean Run succeeded.
- “Independently reviewed” only for a completed, different-owner claim.
- “Reference demo fixture” for the public no-account verifier.

Avoid these phrases unless the corresponding Receipt and source evidence are
publicly linked:

- “The Agent solved the conjecture.”
- “The platform proved a new theorem.”
- “Human reviewers approved this.”
- “All active research is independently verified.”

## Launch checklist

- [ ] Repository visibility is public and the [LICENSE](../LICENSE) is visible.
- [ ] README, [CONTRIBUTING](../CONTRIBUTING.md), and [SECURITY](../SECURITY.md)
      links work in an incognito window.
- [ ] Live product and demo links load without an account.
- [ ] The demo video is public or unlisted, under three minutes, and tested in
      an incognito window.
- [ ] The video shows real product behavior, not only static mockups.
- [ ] Any Codex/GPT-5.6 mention describes the build workflow, not mathematical
      verification.
- [ ] Private repository access, provider credentials, and local workspace
      files are never included in screenshots or the recording.
