# Ordinary-user readiness

Proofweave should feel like a mathematics product, not a control-plane
operation. A participant chooses a question, connects a local Agent once,
approves useful evidence, and follows verification. Database migrations,
runner providers, queue leases, signing identifiers, and retry keys remain
platform responsibilities.

## Current boundary

### Available without an account

- Read the welcome page and product explanation.
- Browse the public research catalog.
- Inspect a source-pinned target, its Lean statement, provenance, and current
  evidence boundary.
- Run the public reference-demo walkthrough.
- Re-hash the demo bytes and re-check its signatures, owner separation, and
  Receipt policy.

The demo verification request does **not** execute Lean again. A fresh Lean
replay is a separate developer/reviewer audit path and must stay labelled as
such.

### Not currently available as a complete public contribution path

- Production writes are intentionally disabled while the control plane is in
  read-only mode.
- A new participant therefore cannot finish Agent connection, create a new
  Attempt, publish a checkpoint, stage a Bundle, or request a new Runner job.
- No new contribution can reach independent review or a Contribution Receipt
  until writes are deliberately restored.
- Google sign-in remains unavailable until its deployment owner completes the
  OAuth configuration. ChatGPT sign-in remains the available normal provider.
- Independent-review latency is not yet guaranteed; a checked Bundle may wait
  for a different owner even after Runner acceptance.

The public catalog and reference demo remain useful during read-only
maintenance, but the site must not present a write action as executable.

## Five-step participant journey

1. **Choose a question.** Browse without an account and select one
   source-pinned target.
2. **Sign in.** Create or recover one stable Proofweave Person. The selected
   target and return path remain intact.
3. **Connect an Agent once.** Approve a local Codex connection. Private prompts,
   repository files, credentials, and unfinished reasoning stay on the
   participant's computer.
4. **Approve a contribution.** Work locally, then approve only the concise
   checkpoint or reproducible evidence intended for the public record.
5. **Follow verification.** See distinct states for progress saved, evidence
   prepared, Lean checked, independent review pending/completed, and
   contribution recorded.

The default interface should use these participant-facing phrases. `Attempt`,
Bundle hashes, certificate identifiers, idempotency keys, and Agent tool names
belong in optional audit details or Agent instructions, not in primary calls to
action.

## Platform responsibilities

Proofweave, rather than the participant, must:

- pin the exact statement, source revision, Lean toolchain, and mathlib
  revision;
- create and validate Person, Agent, delegation, and Attempt bindings;
- keep private keys local and validate public signatures;
- preserve the selected target across sign-in, installation, connection, and
  task resumption;
- stage immutable evidence and deduplicate retries;
- enqueue, isolate, and observe Lean execution;
- keep signed-evidence re-verification separate from fresh Lean execution;
- assign conflict-free independent review work;
- issue contribution records only after the required claims are supported;
- back up, migrate, monitor, and fail closed when durable storage or writes are
  unavailable.

## Smoke gate before restoring writes

Do not describe the ordinary-user path as open until a fresh, non-operator test
identity completes all of the following against the release candidate:

### Public preflight

Before using credentials or creating any data, run the repeatable public
preflight against the exact release URL:

```sh
npm run smoke:ordinary-user -- \
  --base-url https://proofweave-research.yualex031821.chatgpt.site \
  --expect-mode read_only
```

Use `--expect-mode read_write` only after writes have deliberately been
restored. The command performs unauthenticated `GET` requests only. It checks
that:

- the homepage, public catalog, one pinned target, and verified demo are
  readable;
- the selected target survives `/start`, sign-in, and Agent-connection
  routing;
- sign-in reports the actual ChatGPT and Google provider state;
- maintenance is explicit on the connection page in `read_only` mode;
- `/api/mcp/capabilities` agrees with the expected mode and
  `writesEnabled` value; and
- `/api/demo/verify` labels signed-evidence re-verification separately from a
  fresh Lean replay.

Run its deterministic regression test with:

```sh
npm run smoke:ordinary-user:check
```

Passing this preflight is **not** evidence that the contribution path works.
It does not sign in, connect an Agent, create or manage an Attempt, publish a
checkpoint or Bundle, execute Lean, submit a different-owner review, or issue
a Contribution Receipt. Those steps remain the credentialed real-user smoke
below.

### Credentialed real-user smoke

1. Open `/explore`, select a target, and reach sign-in with the target encoded
   in `return_to`.
2. Complete ChatGPT sign-in and land on the same selected target.
3. Connect a new local Codex installation through one explicit browser
   approval; no API key, public key, certificate ID, or repository upload is
   pasted into the website.
4. Create or resume exactly one bounded research record and confirm that retry
   or refresh does not duplicate it.
5. Publish one owner-approved checkpoint without exposing prompts or private
   reasoning.
6. Stage one reproducible Bundle and request one isolated Lean run.
7. Observe truthful queued, running, succeeded/failed, and kernel states. A
   queued run must never be labelled as a Lean result.
8. Complete the required review gates using a genuinely different owner.
9. Inspect the resulting contribution record and trace it back to the target,
   Bundle, Run, and reviews.
10. Repeat the write actions once to confirm safe retry behavior, then pause or
    close the research record from the ordinary workspace.

After the real smoke, export only its redacted evidence projection and run:

```sh
npm run smoke:credentialed-contribution -- \
  --evidence-file /secure/operator/path/release-smoke.redacted.json
```

The schema, collection boundary, and manual acceptance record are documented
in [credentialed-contribution-smoke.md](credentialed-contribution-smoke.md).
This offline command does not perform the smoke, execute Lean, or
cryptographically reverify a signature.

Also run two failure smokes:

- With control-plane mode `read_only`, public pages remain readable while all
  connection and research write controls are visibly paused or disabled.
- With durable storage unavailable, the workspace shows no sample records,
  local fallbacks, or enabled write actions.

The offline regression suite in
`tests/ordinary-user-journey.test.mjs` covers the non-network rendering and
routing portion of this gate. The connection, Runner, and independent-review
steps still require a bounded release-candidate smoke with real services.
