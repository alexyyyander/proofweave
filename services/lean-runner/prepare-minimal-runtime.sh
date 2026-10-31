#!/bin/sh
set -eu
printf '%s' "${RUNTIME_BASE_IMAGE:-}" | grep -Eq '^rockylinux/rockylinux@sha256:[a-f0-9]{64}$'
grep -Eq '^ID="?rocky"?$' /etc/os-release
grep -Eq '^VERSION_ID="?9([.][0-9]+)?"?$' /etc/os-release

# Preserve the RPM database so SBOM and vulnerability scanners see every
# installed package. The immutable image digest records the resolved closure.
retry() {
  for attempt in 1 2 3; do
    if "$@"; then return 0; fi
    sleep 2
  done
  return 1
}
retry microdnf upgrade -y
retry microdnf install -y --setopt=install_weak_deps=0 ca-certificates git-core patch tar gmp libstdc++ libatomic shadow-utils
# RPM itself depends on the patched curl CLI. Keep that dependency and its
# metadata; never force-remove it with --nodeps or hide it from the scanner.
microdnf clean all
groupadd --system --gid 10001 proofweave
useradd --system --uid 10001 --gid proofweave --home-dir /home/proofweave --no-create-home --shell /sbin/nologin proofweave
install -d -o proofweave -g proofweave -m 0700 /home/proofweave
rpm -qa --qf '%{NAME}=%{VERSION}-%{RELEASE}.%{ARCH}\n' > /opt/proofweave/runtime-packages.txt
command -v git
command -v patch
command -v tar
command -v su
command -v install
command -v bash
