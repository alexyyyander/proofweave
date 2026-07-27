# GitHub independence and remaining dependencies

Status: canonical architecture and product-truth boundary, 2026-07-27

This document answers one narrow question: which parts of Proofweave require
GitHub today? It supersedes older installation and Runner descriptions that
made a private repository or GitHub Actions appear to be part of the normal
participant runtime.

## Canonical participant path

```text
Proofweave-hosted marketplace archive + published checksum
  -> verified and unpacked into a user-approved local directory
  -> Codex adds that local marketplace
  -> browser-approved OAuth Agent delegation
  -> private Codex + Lean workspace on the participant computer
  -> owner-approved, signed provider-neutral Bundle v2
  -> Turso-backed shared control-plane record
  -> authenticated wake to the hosted trusted Runner
  -> one fresh private E2B sandbox
  -> signed Runner evidence
  -> different-owner review
  -> Contribution Receipt and derived Credit
```

No step in this path requires the participant to have a GitHub account, grant
repository access, publish the private workspace, or give the Runner a GitHub
token.

The downloadable marketplace archive is
`/downloads/proofweave-research-marketplace.tar`; its standard SHA-256 checksum
file is `/downloads/proofweave-research-marketplace.tar.sha256`, and the
machine-readable identity and compatibility contract is
`/downloads/proofweave-research-marketplace.json`. Codex must show the local
paths and all download, verification, extraction, and plugin commands before
asking for confirmation. Network output must never be piped into a shell. The
complete procedure is in
[`public/codex-install.md`](../public/codex-install.md).

## Dependency matrix

| Surface | GitHub required? | Boundary |
| --- | --- | --- |
| Proofweave account and browser OAuth approval | No | Proofweave identity and Turso/D1 state |
| Local Codex inference and private Lean workspace | No | Participant computer |
| Plugin installation from the published local marketplace archive | No | Proofweave Sites download plus offline checksum verification |
| Provider-neutral Artifact Bundle v2 | No | Exact signed workspace bytes are carried by the Bundle |
| Artifact Bundle v3 provenance | Optional | Adds a signed GitHub repository/commit reference; the Runner still uses the included workspace |
| Shared Attempt, evidence, review, Receipt, and Credit records | No | Turso/D1 control plane |
| Alpha reference Runner execution | No at request time | Hosted trusted Runner on Render starts one E2B sandbox |
| GitHub Actions Runner workflow | Recovery only | Bounded manual/event recovery path, not the primary controller |
| CI, pull requests, source review, and release gates | Yes today | Engineering delivery, not participant research authority |
| Runner image/template construction and GHCR publication | Yes today | Build-time supply chain; an already provisioned template does not contact GitHub per Run |
| Installing from a source checkout | Optional | Advanced development/audit path |

## Evidence formats

`pw-artifact-bundle-v2` is the default executable evidence format. Its archive,
patch, Lake manifest, final tree hash, target, toolchain, policy, and Agent
signature reconstruct the exact workspace without a repository clone.

`pw-artifact-bundle-v3` contains that same complete executable workspace and
adds `repositorySnapshot` for GitHub provenance. It is useful when a contributor
wants to bind evidence to a public or private repository revision, but it does
not grant repository access, fetch source at execution time, or add kernel
authority. A v2 Bundle is sufficient for a new Run.

## Runner topology

The alpha reference path is:

```text
Proofweave control plane
  -> durable signed lease in Turso
  -> authenticated /v1/wake on the hosted trusted Runner
  -> trusted Render control process
  -> one private, no-egress E2B sandbox
  -> signed result returned to the shared evidence store
```

The hosted process owns the Turso, E2B, control-plane verification, and Runner
result-signing credentials. Submitted Lean receives none of them. The
participant workspace reaches E2B only through the immutable Bundle handoff.

The GitHub Actions E2B workflow is retained for bounded recovery, diagnostics,
and explicitly approved operator runs. It is not the alpha's normal scheduler
or trusted controller. GitHub Actions also remains part of CI and reviewed
image/template releases.

## Failure boundary

If GitHub is unavailable after a release is already provisioned:

- account access, catalog reads, OAuth connection, Turso records, v2 Bundle
  staging, Receipt inspection, and Credits do not inherently stop;
- the hosted Runner and an existing approved E2B template do not need GitHub
  for each Run;
- source checkout, pull-request checks, new releases, image rebuilds, GHCR
  publication, and the Actions recovery path do stop; and
- a fresh install continues through the Proofweave-hosted archive as long as
  the Site download is available.

This is an architecture boundary, not yet a completed production-resilience
claim. Proofweave must not call itself operationally GitHub-independent until a
single current release completes the acceptance drill below.

## Acceptance drill

The operator command is:

```sh
npm run runtime:github-independent:drill
```

With no phase argument it is a read-only preflight. It fails unless
`PROOFWEAVE_GITHUB_RECOVERY_ENABLED=false` and verifies:

- the strict release manifest is valid and source, Site, gateway, and Runner
  revisions all equal the current `origin/main` SHA;
- the live Turso database fingerprint and immutable migration ledger match the
  release manifest;
- every configured Site plugin download is reachable, with the marketplace
  archive matching its published checksum;
- `/healthz` reports a ready `e2b` Runner at the same revision and exposes
  `lastWakeAt`.

Set these non-secret drill values in the operator environment:

```text
PROOFWEAVE_GITHUB_RECOVERY_ENABLED=false
PROOFWEAVE_DRILL_SITE_ORIGIN=https://your-proofweave-site.example
PROOFWEAVE_RUNNER_URL=https://your-proofweave-runner.example
PROOFWEAVE_DRILL_PLUGIN_DOWNLOADS_JSON=["/downloads/proofweave-research-marketplace.tar","/downloads/proofweave-research-marketplace.tar.sha256","/downloads/proofweave-research-marketplace.json"]
```

The three canonical paths are mandatory; the list may contain up to five
additional same-origin public release files. The distribution manifest is
strictly checked against the downloaded archive and checksum and against the
marketplace name, plugin name/version, and canonical connector compatibility
contract in the source release. `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`
remain operator secrets; the command emits only the database fingerprint and
migration head.

The write phases create or update only one local JSON state file. Put it
outside the repository so the strict clean-source check remains meaningful.
Each phase requires the exact confirmation printed below; abbreviations are
rejected:

```sh
npm run runtime:github-independent:drill -- begin \
  --state /private/tmp/proofweave-production-drill.json \
  --confirm I-CONFIRM-GITHUB-RECOVERY-IS-DISABLED \
  --correlation-id correlation:production-20260727-001 \
  --person-id person:production-owner \
  --agent-id agent:production-prover \
  --bundle-hash sha256:REPLACE_WITH_64_HEX_CHARACTERS
```

`begin` does not call a trigger endpoint. After it succeeds, perform the real
participant workflow through the normal local Agent and browser-approved
Connector:

1. Install the plugin into a clean Codex environment using only the Site
   archive, offline checksum verification, and a local marketplace path.
2. Connect one local Agent through browser OAuth.
3. Prepare and owner-approve one signed provider-neutral v2 Bundle from a local
   Lean workspace.
4. Stage it in Turso and allow the normal gateway to wake the hosted Runner.
5. Observe one fresh E2B result, complete different-owner reviews, issue the
   Receipt, and download the portable Receipt closure and current issuer
   keyset.

Record the observed public identifiers and hashes in a local file with this
strict shape:

```json
{
  "correlationId": "correlation:production-20260727-001",
  "revision": "40-to-64-character-release-SHA",
  "personId": "person:production-owner",
  "agentId": "agent:production-prover",
  "artifactBundleHash": "sha256:...",
  "run": {
    "id": "run:production-closure-001",
    "resultHash": "sha256:..."
  },
  "reviews": [
    {
      "verificationAttestationId": "attestation:production-review-1",
      "verificationAttestationHash": "sha256:...",
      "reviewerPersonId": "person:independent-reviewer",
      "reviewerAgentId": "agent:independent-reviewer"
    }
  ],
  "receipt": {
    "id": "receipt:production-closure-001",
    "hash": "sha256:..."
  }
}
```

Then record and finalize:

```sh
npm run runtime:github-independent:drill -- record \
  --state /private/tmp/proofweave-production-drill.json \
  --confirm I-CONFIRM-REAL-PRODUCTION-EVIDENCE-WAS-OBSERVED \
  --evidence /private/tmp/proofweave-observed-evidence.json

npm run runtime:github-independent:drill -- finalize \
  --state /private/tmp/proofweave-production-drill.json \
  --confirm I-CONFIRM-PORTABLE-RECEIPT-CLOSURE-IS-FINAL \
  --correlation-id correlation:production-20260727-001 \
  --receipt-bundle /private/tmp/proofweave-receipt-bundle.json \
  --issuer-keyset /private/tmp/proofweave-issuer-keys.json
```

`record` requires a new observable Runner wake after `begin`. `finalize`
re-runs the read-only preflight, rejects revision/correlation/hash drift and
same-owner review, and invokes the existing portable Receipt verifier with
the current issuer keyset. Receipt or identity fields containing
`mock`, `demo`, `smoke`, or `fixture` are ineligible. Injected transports used
by the test suite can only produce `fixture_verified`; only the non-injected
CLI over real production endpoints can emit `production_passed`.

All command output is one privacy-minimal JSON record. It never includes Turso
credentials, Runner wake credentials, private keys, workspace bytes, or
environment dumps. The local state contains only the release projection and
the correlation, Person, Agent, Bundle, Run, review, and Receipt identifiers
and hashes needed to audit this single drill.

Until this passes against one aligned deployed revision, the truthful status is:

> The core protocol and intended runtime are GitHub-independent; engineering
> delivery and image supply chain still use GitHub, and runtime independence
> remains to be proven by a production drill.

## Wording rules

- Say **“No GitHub account required for the normal participant path.”**
- Say **“GitHub source checkout is an advanced optional installation.”**
- Say **“Bundle v2 is the provider-neutral executable default.”**
- Say **“Bundle v3 adds optional GitHub provenance.”**
- Say **“Hosted Runner + E2B is the alpha reference path.”**
- Say **“GitHub Actions is CI, image-release, and recovery infrastructure.”**
- Do not say the entire product has no GitHub dependency while CI and the image
  supply chain still depend on it.
