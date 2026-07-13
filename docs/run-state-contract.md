# Run state contract v1

A `Run` is a control-plane execution record for exactly one Attempt, artifact
bundle hash, and idempotent runner request hash. It is not a verification claim
or contribution receipt.

```text
queued ──start──> running ──result──> succeeded | failed | timed_out | rejected
  │                   │
  └─cancel──> cancelled └─cancel request──> cancel_requested ──result──> terminal
```

Only a runner result bound to the exact Run id, Attempt id, and request hash can
finish a running Run. A queued item can be removed immediately; a running
container must acknowledge cancellation. Lean jobs have no safe checkpoint
format, so this alpha intentionally offers cancellation rather than pretending
that a paused process can be resumed reproducibly.

Every terminal runner-completed state retains a result hash. The state machine
does not turn any terminal result into `kernel_accepted`, independent review,
or a contribution receipt; those claims remain separate policy gates.

Before a result reaches that state, the D1 store resolves its `runnerKeyId`
against an active operator allowlist and verifies its detached Ed25519
signature. The pure domain transition remains cryptography-agnostic so it can
be replayed independently; the persistence boundary supplies the trust check.

The closed-alpha D1 adapter stores the status projection separately from
immutable canonical transition events and the terminal result. It is not a
public execution API and cannot be used to run Lean until the isolated runner,
R2 bundle flow, and authenticated runner channel exist.

For hosted Queue consumption, `RunnerJobPreflight` accepts only an already
authenticated envelope. It checks the envelope's request hash, Attempt, and
Bundle hash against the persisted Run, resolves the immutable D1/R2 Bundle,
then claims `queued -> running`. A duplicate delivery that sees a non-queued
Run is a no-op; it cannot cause a second Container execution.
