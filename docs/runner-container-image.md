# Lean Runner Container image build contract

Status: reproducible reviewed Lean environment build path, 2026-07-21

This document defines the reproducible build input for the private Lean Runner
Container. It does not approve a particular output digest or authorize a
deployment. The final image must still pass the gates in
[`runner-cloudflare-deployment.md`](runner-cloudflare-deployment.md).

## Reviewed Runner profiles

`.github/workflows/build-e2b-lean-runner-image.yml` builds one explicitly
selected environment at a time. The reviewed profiles are Lean Core 4.27.0,
Mathlib commit `a3a10db0e9d66acbebf76c5e6a135066525ac900` on Lean 4.27.0,
and Mathlib commit `9a9483a92959bc92bd6a60176dd1fe597298c1f8` on Lean 4.31.0.
Every profile pins the Node base by OCI digest and the official Lean archive
by SHA-256.

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

- Node.js 22.13 or newer;
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
