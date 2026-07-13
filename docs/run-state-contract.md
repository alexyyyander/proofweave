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
