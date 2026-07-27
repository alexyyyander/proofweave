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
file is `/downloads/proofweave-research-marketplace.tar.sha256`. Codex must
show the local paths and all download, verification, extraction, and plugin
commands before asking for confirmation. Network output must never be piped
into a shell. The complete procedure is in
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

1. Confirm the Site serves the marketplace archive and checksum from the same
   release.
2. Install the plugin into a clean Codex environment using only the downloaded
   archive, offline checksum verification, and a local marketplace path.
3. Disable the GitHub Actions Runner and do not use a repository checkout for
   participant evidence.
4. Connect one local Agent through browser OAuth.
5. Prepare and approve one signed v2 Bundle from a local Lean workspace.
6. Stage it in the shared control plane and wake the hosted Runner.
7. Observe the Render controller create a fresh E2B sandbox and persist one
   signed terminal result.
8. Complete a different-owner review, issue one Receipt, and project its
   derived Credit.
9. Verify that the correlation trace, Receipt, and portable evidence closure
   all bind the same Agent, Bundle hash, Run, reviewer evidence, and Person.

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
