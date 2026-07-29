# Owner-controlled contribution smoke

This is the first executable gate for a single Proofweave maintainer. It proves
that the contribution protocol and real Lean work still compose before any
production database or hosted Runner is unfrozen.

Run:

```bash
npm run smoke:solo-contribution
```

The command uses only a temporary local Miniflare D1/R2 store and temporary
workspaces. It creates fresh test keys and executes:

1. one signed Artifact Bundle;
2. one primary `lake env lean` Run;
3. one fresh reproducibility replay;
4. one separate fresh kernel replay;
5. signed review attestations from generated test Persons;
6. one issuer-signed test Receipt and signature check; and
7. the public signed demo fixture's Lean replay.

The generated Persons exercise the platform's owner-separation rules, but all
of their keys are controlled by this one test process. The result is therefore
labelled `isolated_test` and is not an independent human review, a public
contribution, production Credit, or evidence that Turso, the hosted Runner, or
E2B is currently available.

The smoke has a 90-second fail-closed timeout per stage and prints the exact
stage reached before any failure. When it passes, the next release gate is the
credentialed cloud smoke against an isolated non-production authority. Only
after that gate passes should an operator consider a production migration or
write-mode cutover.
