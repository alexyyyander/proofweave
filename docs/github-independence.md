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
- `/healthz` reports a ready `e2b` Runner at the same revision; and
- the expected hosted Runner queue consumer is supplied explicitly. A GitHub
  recovery consumer is not interchangeable with that production consumer.

Set these non-secret drill values in the operator environment:

```text
PROOFWEAVE_GITHUB_RECOVERY_ENABLED=false
PROOFWEAVE_DRILL_SITE_ORIGIN=https://your-proofweave-site.example
PROOFWEAVE_RUNNER_URL=https://your-proofweave-runner.example
PROOFWEAVE_DRILL_EXPECTED_RUNNER_CONSUMER_ID=consumer:your-hosted-runner
PROOFWEAVE_DRILL_GITHUB_REPOSITORY=owner/repository
PROOFWEAVE_DRILL_GITHUB_REPOSITORY_ID=123456789
PROOFWEAVE_DRILL_RECOVERY_TRUSTED_KEYS_JSON={"schemaVersion":"pw-runtime-recovery-operator-keyset-v1","keys":[{"keyId":"release-operator:production-01","publicKey":"BASE64URL_ED25519_PUBLIC_KEY","keyFingerprint":"sha256:..."}]}
PROOFWEAVE_DRILL_PLUGIN_DOWNLOADS_JSON=["/downloads/proofweave-research-marketplace.tar","/downloads/proofweave-research-marketplace.tar.sha256","/downloads/proofweave-research-marketplace.json"]
```

The three canonical paths are mandatory; the list may contain up to five
additional same-origin public release files. The distribution manifest is
strictly checked against the downloaded archive and checksum and against the
marketplace name, plugin name/version, and canonical connector compatibility
contract in the source release. `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`
remain operator secrets; the command emits only the database fingerprint and
migration head. The URL must use the canonical credential-free
`libsql://hostname` form with no path, query, fragment, or embedded
username/password; the auth token remains a separate secret.

`begin` additionally requires a fine-grained read-only GitHub token in
`PROOFWEAVE_DRILL_GITHUB_TOKEN`, the selected trusted key id in
`PROOFWEAVE_DRILL_RECOVERY_OPERATOR_KEY_ID`, and an absolute external path in
`PROOFWEAVE_DRILL_RECOVERY_OPERATOR_PRIVATE_KEY_JWK_FILE`. The key must be a
regular, non-symlink POSIX file with mode `0600`. Neither the token nor private
JWK is written to state or command output. The trusted public keyset and
immutable repository id are included in the release fingerprint.

Before `begin`, install and connect the local Agent, choose the exact Lean
workspace, and call `prepare_workspace_bundle_v2`. This preparation creates a
signed local draft and its exact Bundle manifest hash; it uploads nothing.
Show that draft to the owner. Do not invent a placeholder hash and do not
prepare another draft after `begin`.

The write phases create or update only one local JSON state file. Put it
outside the repository so the strict clean-source check remains meaningful.
Begin only after the exact draft/hash exists. Each phase requires the exact
confirmation printed below; abbreviations are rejected:

```sh
npm run runtime:github-independent:drill -- begin \
  --state /private/tmp/proofweave-production-drill.json \
  --confirm I-CONFIRM-GITHUB-RECOVERY-IS-DISABLED \
  --correlation-id correlation:production-20260727-001 \
  --person-id person:production-owner \
  --agent-id agent:production-prover \
  --bundle-hash sha256:REPLACE_WITH_64_HEX_CHARACTERS
```

`begin` does not upload or trigger anything. It takes one read-only GitHub API
snapshot: each reviewed queue-consuming workflow must be
`disabled_manually`, have zero active runs, and have release-source bytes
matching the checked-in workflow hash. The release operator signs that
snapshot, and its complete public evidence plus canonical hash are stored in
the v3 state. After it succeeds, submit the same prepared draft through the
normal local Agent and browser-approved Connector:

1. Reconfirm that the retained prepared draft has the exact manifest hash
   recorded by `begin`.
2. Owner-approve and stage that unchanged draft in Turso, then
   allow the normal gateway to wake the hosted Runner.
3. Observe one fresh E2B result, complete different-owner reviews, issue the
   Receipt, and download only the portable Receipt closure. The drill fetches
   the current issuer keyset itself from the same fixed Site.

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
  --receipt-bundle /private/tmp/proofweave-receipt-bundle.json
```

`record` does not use global Runner wake time as causal evidence. It queries
the live Turso control plane for the exact supplied Run and requires:

- the Run's Attempt Person/Agent, Bundle and result hash to match the state
  created by `begin`;
- Run, result, attestation and Receipt timestamps to be at or after
  `state.createdAt`, in their required order;
- migration-0043 queue events for that Run to have positive consecutive
  sequences, the exact configured hosted consumer and lease, and an
  `acknowledged` terminal event;
- the immutable Receipt row to bind the same Run, Bundle, beneficiary and
  Receipt hash; and
- every covered canonical attestation to bind its exact reviewer, Agent,
  Bundle and `sha256Canonical(attestation)` hash, with no same-owner review.

Before any live Turso or Receipt work, both `record` and `finalize` recompute
the full recovery-evidence hash and verify its trusted Ed25519 signature,
two-hour TTL, release SHA/fingerprint, correlation id, and immutable GitHub
repository identity offline. Missing, expired, untrusted, or modified evidence
is a hard failure. Fixture evidence remains `fixture_verified` even if local
state is edited to request production eligibility.

`finalize` re-runs both the read-only preflight and that exact Turso probe,
rejects any live evidence drift, and requires the portable Receipt
`issuedAt >= state.createdAt`. It obtains the current issuer keyset only from
the fixed same-origin HTTPS
`/api/receipts/issuer-keys` endpoint with redirects disabled, JSON content
type, and a bounded response; the production CLI does not accept an operator
keyset file. Receipt or identity fields containing
`mock`, `demo`, `smoke`, or `fixture` are ineligible. Injected transports used
by the test suite can only produce `fixture_verified`; only the non-injected
CLI over real production endpoints can emit `production_passed`.

Recovery evidence is deliberately a **begin-time snapshot**. A
`production_passed` result means GitHub recovery was observed isolated at the
signed start of this bounded drill; it does not prove continuous workflow
disablement after that instant. A continuous-isolation claim would require a
separate signed end observation.

All command output is one privacy-minimal JSON record. It never includes Turso
credentials, Runner wake credentials, private keys, workspace bytes, or
environment dumps. The local state contains only the release projection,
signed public recovery snapshot, and the correlation, Person, Agent, Bundle,
Run, review, and Receipt identifiers and hashes needed to audit this drill.

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
