# Lean Runner Container image build contract

Status: reviewed Lean environment build path, 2026-10-27

This document defines the reproducible build input for the private Lean Runner
Container. It does not approve a particular output digest or authorize a
deployment. The final image must still pass the gates in
[`runner-provider-neutral-deployment.md`](runner-provider-neutral-deployment.md).

## Reviewed Runner profiles

`.github/workflows/build-e2b-lean-runner-image.yml` builds one explicitly
selected environment at a time. The default build profile is
`mathlib-4.35-56a00`: Lean 4.35.0 with Mathlib commit
`56a005855ea17e0b0958f73ec801ae140b0a1679` (the upstream `v4.35.0` tag).
Its official Linux archive is pinned to SHA-256
`7289597a44543246c9227b8cae501767e095ce17f6d448b95fc4a8dc97268f6d`.
This is a build input, not an approved or deployed image. The root
`lean-toolchain` selects the same release for new local work; existing
source-pinned projects and historical fixtures keep their own toolchain.

The historical build profiles remain available: Lean Core 4.27.0,
Mathlib commit `a3a10db0e9d66acbebf76c5e6a135066525ac900` on Lean 4.27.0,
and Mathlib commit `9a9483a92959bc92bd6a60176dd1fe597298c1f8` on Lean 4.31.0.
Every profile pins the Node base by OCI digest and the official Lean archive
by SHA-256.

Changing the build default does not migrate catalog targets. Each migrated
target needs a new source snapshot/revision and a successful compatibility
check before an Attempt can select the new environment. Existing Attempts,
Bundles, and Receipts retain their original Lean and Mathlib pins. See
[`lean-upgrade-2026-10-27.zh-CN.md`](lean-upgrade-2026-10-27.zh-CN.md).

The reviewed Node **build input** is Docker Official Image `node:22.23.4-bookworm`, pinned
as `node@sha256:63538dfe497cc29dfafdda25ada09b46db68a3f4cc205abf1f5d6bf0913f3384`.
Both base recipes, final assembly and offline smoke require
`EXPECTED_NODE_VERSION=22.23.4` and compare it with the actual Node runtime.
The policy rejects Node 22 versions below 22.23.4 and unreviewed Node majors.
This replaces Node 22.23.1 after the
[2026-10-21 security release](https://nodejs.org/en/blog/release/v22.23.4).
It does not change the selected Lean release or Mathlib commit. Rebuilding
produces a new image digest that still needs full-image vulnerability review,
SBOM/provenance verification and E2B isolation checks before approval.

The published runtime is built separately from the linux/amd64 Rocky Linux 9 minimal manifest
`rockylinux/rockylinux@sha256:8c5ffaa82079057f9d5206379996763a491f0cea9ef0e27c1395557ecd0f5bef`.
Only the Node binary is copied directly from its immutable source stage. The
Lean toolchain, environment metadata and pinned Mathlib closure are copied from
the builder. The shared runtime installer applies available signed RPM updates
and installs only certificates, Git, patch and required shared libraries.
It retains the RPM database and records installed versions for SBOM/scanner
inspection. Package-manager access is confined to image construction; the
execution Sandbox remains unprivileged with network access disabled.

npm/yarn, system compiler packages, development headers and image-processing
libraries stay outside the final image. Offline inspection rejects unexpected
package managers/build tools on PATH. The runtime account has UID/GID 10001;
the copied Lake closure is owned by that account. The external-project Lake
build smoke runs **after** the runtime transition, so missing libraries or
accidental dependence on builder tooling fail the build. E2B declares the Rocky family supported; Rocky 9 keeps the portable CPU
baseline, whereas Rocky 10 requires x86-64-v3. The offline inspector rejects
other distro identities. RPM's required curl CLI remains installed and scanned;
its dependency records are preserved. Wolfi is used only for the Docker-hosted controller,
not for E2B execution images. Provider-side template construction still needs
separate authorization and validation. Each base recipe also
supports `--target minimal-runtime` for a cheaper package/ABI preflight.

The same workflow builds the exported trusted controller locally and scans it
without publishing or deploying it. Its image ID and scan hash are retained
alongside the Lean image evidence. Root and exported-controller dependency
audits run in the full CI gate; Node installation uses the reviewed `.nvmrc`.

The build scans the exact final digest with checksum-pinned Trivy 0.76.1.
HIGH or CRITICAL findings, including unfixed findings, block the job; a scanner
failure also blocks it. The image may already have been published as a candidate
before this gate, so GHCR presence is not approval. The 30-day image-review
artifact retains the full scan JSON, its SHA-256/source/run/image binding and
the offline smoke log. For Mathlib profiles that log also includes the pinned
Lake manifest, which supplements the SPDX package inventory. It does not make
the SBOM itself a complete Lean dependency or license audit.

The workflow publishes a Linux/amd64 base and final image to GHCR, emits SBOM
and build provenance, assembles the final image with Docker build networking
disabled, and smoke-tests it with no network and the image's path-scoped
filesystem permissions intact.
It never creates an E2B template and has no production Environment dependency.
After image publication, the local operator command
`npm run runner:e2b:template:build` creates the template from the exact reviewed
digest using credentials held outside GitHub. The final image digest and E2B
template/build identity still need operator review before admission to the
approved Runner registry.

The Core profile is intentionally limited to projects with no external Lake
dependencies. Each Mathlib profile downloads and verifies dependencies only
during the independently inspectable base build. The final image contains an
image-owned Lake package closure, and the executor mounts that closure only
after the submitted workspace tree has passed its hash checks. Package source,
compiled output, shallow Git revision, and public remote metadata remain
read-only. The only writable paths are Lake's generated `.lake/config` subtree
and its already-existing package records: Lake refreshes those
records with a temporary file and atomic rename when the same pinned closure is
mounted into a different project. They live inside a fresh, single-Run Sandbox
and contain no credentials. A submitted workspace-provided `.lake` directory is
rejected.

## Base-image interface

The deployment owner supplies `RUNNER_BASE_IMAGE` to
[`services/lean-runner/Dockerfile`](../services/lean-runner/Dockerfile). It
must be a Linux `amd64` image reference pinned with `@sha256:`; mutable tags
are rejected during the build. The base image must be independently built and
inspected before it is used as a build input.

Every independently built base must provide, on `PATH` for the unprivileged
`proofweave` user:

- the exact reviewed Node.js 22 version, at least 22.23.4, selected through
  `EXPECTED_NODE_VERSION`;
- `lake` and `lean` for the exact selected Lean toolchain;
- `patch`, `tar`, and either Node native zstd or the `zstd` executable for the
  checked-in private workspace runtime;
- either the exact Mathlib closure required by the selected environment, with
  read-only package source/build output, writable generated Lake config records,
  and no runtime dependency download, or the explicit `none` sentinel for the
  reviewed Lean Core-only profile; and
- a root-owned, world-readable `/opt/proofweave/lean-environment.json`:

```json
{
  "protocolVersion": "pw-lean-image-v1",
  "leanToolchain": "leanprover/lean4:v4.27.0",
  "mathlibRevision": "none"
}
```

The Dockerfile verifies this metadata, validates the required executables, and
then starts the checked-in `container-http-server.mjs` as a dedicated non-root
user. It copies no site frontend, database client, Cloudflare credential,
Node dependency tree, local environment file, or signing key. The root
`.dockerignore` allows only `packages/` and `services/lean-runner/` into this
image build context.

The metadata is a build assertion, not sufficient evidence by itself. The
operator must inspect the actual Lean and Mathlib files, verify their hashes
and revisions, scan the final image, and record the final assembled image
digest in the deployment-owned `PinnedRunnerImageRegistry` configuration.
For the Core profile, the Mathlib inspection is replaced by a check that no
Mathlib dependency is claimed or admitted by the approved environment.

## Offline final assembly

First acquire and inspect the exact base image outside this repository. Then
assemble the final image with networking disabled:

```sh
docker build --platform linux/amd64 --network=none \
  --build-arg RUNNER_BASE_IMAGE='registry.example/proofweave/lean-base@sha256:REPLACE_WITH_64_HEX' \
  --build-arg EXPECTED_LEAN_TOOLCHAIN='leanprover/lean4:v4.27.0' \
  --build-arg EXPECTED_MATHLIB_REVISION='a3a10db0e9d66acbebf76c5e6a135066525ac900' \
  --file services/lean-runner/Dockerfile \
  --tag proofweave-lean-runner:inspection .
```

Do not replace the placeholder with a tag. After a separate static and
vulnerability review, inspect the final `linux/amd64` manifest digest, bind
that digest to the same Lean and Mathlib values in the Worker-owned allowlist,
and only then update the non-deployable Wrangler template in a deployment
repository.

## Isolated smoke test

Before any deployment, the operator must run a non-production smoke test with
no network, explicit CPU/memory/process/disk bounds, and an ephemeral writable
workspace. The reviewed Mathlib image keeps dependency source and compiled
output read-only while allowing only generated `.lake/config/**` state to be
updated. Do not add Docker's whole-root `--read-only` flag to this E2B smoke:
it would override that narrower filesystem policy and prevent Lake from
creating its generated lock files. For example:

```sh
docker run --rm --network=none \
  --cpus=1 --memory=2g --pids-limit=128 \
  --tmpfs /tmp/proofweave:rw,nosuid,nodev,size=1g \
  -e PROOFWEAVE_NETWORK_ISOLATED=true \
  -e PROOFWEAVE_RESOURCE_LIMITS_ENFORCED=true \
  proofweave-lean-runner:inspection
```

Those environment variables are intentionally absent from the Dockerfile: the
process treats them only as deployment assertions. Setting them without the
actual outer isolation is unsafe. A future whole-root read-only container
profile must provide a separate writable overlay for every generated Lake
config tree before it can claim an equivalent filesystem boundary.
