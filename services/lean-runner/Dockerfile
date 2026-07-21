# syntax=docker/dockerfile:1.7
#
# This is intentionally a final assembly recipe, not a downloader. The
# deployment owner must first independently build and inspect the immutable
# Linux/amd64 base described in docs/runner-container-image.md, then provide
# its digest through RUNNER_BASE_IMAGE. The build is expected to use
# --network=none.
ARG RUNNER_BASE_IMAGE
FROM ${RUNNER_BASE_IMAGE}

ARG RUNNER_BASE_IMAGE
ARG EXPECTED_LEAN_TOOLCHAIN
ARG EXPECTED_MATHLIB_REVISION
ENV PROOFWEAVE_IMAGE_METADATA=/opt/proofweave/lean-environment.json

# Fail closed if an operator supplies a mutable base tag, a base that lacks the
# declared environment metadata, or a toolchain that cannot run without root.
RUN node --input-type=module -e '\
  import { readFile } from "node:fs/promises"; \
  const [image, toolchain, mathlib] = process.argv.slice(1); \
  if (!/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(image)) throw new Error("RUNNER_BASE_IMAGE must be pinned by sha256 digest."); \
  if (!toolchain || !mathlib) throw new Error("Expected Lean and Mathlib values are required."); \
  const metadata = JSON.parse(await readFile(process.env.PROOFWEAVE_IMAGE_METADATA, "utf8")); \
  if (metadata.protocolVersion !== "pw-lean-image-v1" || metadata.leanToolchain !== toolchain || metadata.mathlibRevision !== mathlib) throw new Error("Base image Lean environment metadata does not match the requested runner environment."); \
' "$RUNNER_BASE_IMAGE" "$EXPECTED_LEAN_TOOLCHAIN" "$EXPECTED_MATHLIB_REVISION" \
 && command -v lake \
 && command -v lean \
 && command -v patch \
 && command -v tar \
 && (node --input-type=module -e 'import * as zlib from "node:zlib"; if (typeof zlib.createZstdDecompress !== "function") process.exit(1)' || command -v zstd)

RUN (getent group proofweave >/dev/null || addgroup --system proofweave) \
 && (id -u proofweave >/dev/null 2>&1 || adduser --system --ingroup proofweave --home /home/proofweave --shell /usr/sbin/nologin proofweave) \
 && install -d -o proofweave -g proofweave -m 0700 /tmp/proofweave/staging /tmp/proofweave/workspaces \
 && su -s /bin/sh proofweave -c 'node --version && lake --version && lean --version'

WORKDIR /opt/proofweave
# Keep the executor source root-owned: submitted Lean code runs as proofweave
# and may write only inside the fresh /tmp/proofweave workspace roots.
COPY packages ./packages
COPY services/lean-runner ./services/lean-runner

LABEL org.opencontainers.image.title="Proofweave Lean Runner" \
      io.proofweave.lean-toolchain="${EXPECTED_LEAN_TOOLCHAIN}" \
      io.proofweave.mathlib-revision="${EXPECTED_MATHLIB_REVISION}" \
      io.proofweave.runner-contract="pw-lean-runner-v1"

USER proofweave
WORKDIR /opt/proofweave
EXPOSE 8080
ENTRYPOINT ["node", "/opt/proofweave/services/lean-runner/container-http-server.mjs"]
