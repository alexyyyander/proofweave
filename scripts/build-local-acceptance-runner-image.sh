#!/usr/bin/env bash
# Local synthetic-identity acceptance only; this does not publish or deploy an image.
set -euo pipefail
umask 077

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
base_image="${PROOFWEAVE_ACCEPTANCE_BASE_IMAGE:-sha256:ddc3ae8b3a6944c2ea33e0cf574c1924777fd1cee43e2dcc75fd1f5b5cd4824e}"
build_root="${PROOFWEAVE_ACCEPTANCE_IMAGE_BUILD_ROOT:-$(mktemp -d "${TMPDIR:-/tmp}/proofweave-acceptance-image.XXXXXX")}"
release_sha="7289597a44543246c9227b8cae501767e095ce17f6d448b95fc4a8dc97268f6d"
release_url="https://github.com/leanprover/lean4/releases/download/v4.35.0/lean-4.35.0-linux.tar.zst"
container_name="proofweave-local-acceptance-build-$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
image_tag="proofweave-local-acceptance:lean-4.35.0-$(date -u +%Y%m%d%H%M%S)"
created=false

cleanup() {
  if [[ "$created" == true ]]; then
    # The exact UUID name belongs to this invocation. Never prune other resources.
    docker rm --force "$container_name" >/dev/null || true
  fi
}
trap cleanup EXIT

for executable in docker node curl zstd tar; do
  command -v "$executable" >/dev/null || { echo "Missing required executable: $executable" >&2; exit 1; }
done
if [[ ! "$base_image" =~ ^sha256:[a-f0-9]{64}$ && ! "$base_image" =~ ^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$ ]]; then
  echo "PROOFWEAVE_ACCEPTANCE_BASE_IMAGE must be an immutable ID or digest reference." >&2
  exit 1
fi
mkdir -p "$build_root"
build_root="$(cd "$build_root" && pwd)"
# No implicit pull or base substitution: first inspect the explicitly chosen local base.
docker image inspect "$base_image" > "$build_root/base-image.json"
node --input-type=module -e '
  import {readFile} from "node:fs/promises";
  const image = JSON.parse(await readFile(process.argv[1], "utf8"))[0];
  if (image.Os !== "linux" || image.Architecture !== "amd64") throw new Error("The pinned Lean release requires a Linux/amd64 base");
' "$build_root/base-image.json"

archive="$build_root/lean-4.35.0-linux.tar.zst"
if [[ ! -f "$archive" ]]; then
  curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
    --retry 3 --retry-all-errors --connect-timeout 20 "$release_url" --output "$archive"
fi
node --input-type=module -e '
  import {createReadStream} from "node:fs";
  import {createHash} from "node:crypto";
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(process.argv[1])) hash.update(bytes);
  if (hash.digest("hex") !== process.argv[2]) throw new Error("Official Lean release SHA-256 mismatch; refusing extraction");
' "$archive" "$release_sha"

docker create --name "$container_name" --network none --label io.proofweave.local-acceptance=true \
  --entrypoint /bin/sh "$base_image" -c 'mkdir -p /opt/lean /opt/proofweave; sleep 3600' >/dev/null
created=true
docker start "$container_name" >/dev/null
docker exec "$container_name" /bin/sh -eu -c 'command -v patch; command -v tar; node -e '\''if(process.versions.node!=="22.23.4" || !require("node:zlib").createZstdDecompress)process.exit(1)'\'''

# Keep all .olean, .olean.private, .olean.server and .ir files: Lean 4.35 needs
# these during real elaboration. Omit static libraries, IDE info and SDK sources.
zstd -dc "$archive" | docker exec -i "$container_name" tar -xf - -C /opt/lean --strip-components=1 \
  --exclude='*.a' --exclude='*.ilean' --exclude='lean-4.35.0-linux/src' --exclude='lean-4.35.0-linux/include'
(cd "$repo_root" && COPYFILE_DISABLE=1 tar --format=ustar -cf - packages services/lean-runner) | \
  docker exec -i "$container_name" tar -xf - -C /opt/proofweave
node --input-type=module -e '
  import {writeFile} from "node:fs/promises";
  await writeFile(process.argv[1], JSON.stringify({protocolVersion:"pw-lean-image-v1", profile:"core-alpha-local-acceptance", leanToolchain:"leanprover/lean4:v4.35.0", mathlibRevision:"none", leanReleaseSha256:process.argv[2], localAcceptanceOnly:true}));
' "$build_root/lean-environment.json" "$release_sha"
docker cp "$build_root/lean-environment.json" "$container_name:/opt/proofweave/lean-environment.json" >/dev/null

docker exec --user 10001:10001 --env HOME=/tmp --env PATH=/opt/lean/bin:/usr/local/bin:/usr/bin:/bin \
  "$container_name" /bin/sh -eu -c '
    lean --version
    lake --version
    mkdir /tmp/proofweave-image-probe
    cd /tmp/proofweave-image-probe
    printf "name = \"Fixture\"\nversion = \"0.1.0\"\n[[lean_lib]]\nname = \"Main\"\n" > lakefile.toml
    printf "theorem local_acceptance : 1 + 1 = 2 := by rfl\n#print axioms local_acceptance\n" > Main.lean
    lake build Main
    lake env lean Main.lean
  ' > "$build_root/lean-probe.log" 2>&1
docker exec "$container_name" /bin/sh -eu -c 'rm -rf /tmp/proofweave-image-probe; chmod -R a+rX /opt/lean /opt/proofweave'
docker commit --change 'ENV PATH=/opt/lean/bin:/usr/local/bin:/usr/bin:/bin' --change 'ENV HOME=/tmp' \
  --change 'USER 10001:10001' --change 'LABEL io.proofweave.local-acceptance=true' \
  "$container_name" "$image_tag" > "$build_root/image-id.txt"
docker image inspect "$image_tag" > "$build_root/image.json"
node --input-type=module -e '
  import {readFile, writeFile} from "node:fs/promises";
  const root = process.argv[1];
  const image = JSON.parse(await readFile(`${root}/image.json`, "utf8"))[0];
  // The helper intentionally requires the containerd manifest ID semantics.
  if (image.Descriptor?.digest !== image.Id) throw new Error("Docker must expose its OCI manifest digest as the local image ID; classic config IDs are unsupported");
  const record = {mode:"isolated_test", productionAcceptance:false, dockerImageId:image.Id,
    imageDigest:`local/proofweave-acceptance@${image.Descriptor.digest}`, leanToolchain:"leanprover/lean4:v4.35.0",
    mathlibRevision:"none", imageTag:process.argv[2], baseImage:process.argv[3], leanReleaseSha256:process.argv[4],
    builtAt:new Date().toISOString(), buildRoot:root, isolationVerified:false,
    nextStep:"Run tests/local-acceptance-runner.test.mjs with PROOFWEAVE_LOCAL_ACCEPTANCE_DOCKER_IMAGE_ID set to dockerImageId"};
  await writeFile(`${root}/build-record.json`, JSON.stringify(record,null,2)+"\n");
  process.stdout.write(JSON.stringify(record,null,2)+"\n");
' "$build_root" "$image_tag" "$base_image" "$release_sha"
