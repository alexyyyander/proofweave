# Lean Runner Container image build contract

Status: source recipe only, 2026-07-13

This document defines the reproducible build input for the private Lean Runner
Container. It does not approve an image, provide an image digest, or authorize
a deployment. The final image must still pass the gates in
[`runner-cloudflare-deployment.md`](runner-cloudflare-deployment.md).

## Base-image interface

The deployment owner supplies `RUNNER_BASE_IMAGE` to
[`services/lean-runner/Dockerfile`](../services/lean-runner/Dockerfile). It
must be a Linux `amd64` image reference pinned with `@sha256:`; mutable tags
are rejected during the build. The base image must be independently built and
inspected before it is used as a build input.

It must provide, on `PATH` for the unprivileged `proofweave` user:

- Node.js 22.13 or newer;
- `lake` and `lean` for `leanprover/lean4:v4.27.0`;
- `patch`, `tar`, and `zstd` for the checked-in private workspace runtime;
- the exact Mathlib closure required by the selected environment, with no
  runtime dependency download; and
- a root-owned, world-readable `/opt/proofweave/lean-environment.json`:

```json
{
  "protocolVersion": "pw-lean-image-v1",
  "leanToolchain": "leanprover/lean4:v4.27.0",
  "mathlibRevision": "a3a10db0e9d66acbebf76c5e6a135066525ac900"
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

Before any Cloudflare deployment, the operator must run a non-production
smoke test with a read-only root filesystem, no network, explicit CPU/memory/
process/disk bounds, and an ephemeral writable workspace. For example:

```sh
docker run --rm --read-only --network=none \
  --cpus=1 --memory=2g --pids-limit=128 \
  --tmpfs /tmp/proofweave:rw,nosuid,nodev,size=1g \
  -e PROOFWEAVE_NETWORK_ISOLATED=true \
  -e PROOFWEAVE_RESOURCE_LIMITS_ENFORCED=true \
  proofweave-lean-runner:inspection
```

Those environment variables are intentionally absent from the Dockerfile: the
process treats them only as deployment assertions. Setting them without the
actual outer isolation is unsafe. The Worker/Container deployment must prove
the equivalent Cloudflare controls before it supplies the resource-limit
assertion.
