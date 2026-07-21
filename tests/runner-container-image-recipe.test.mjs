import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dockerfileUrl = new URL("../services/lean-runner/Dockerfile", import.meta.url);
const coreBaseDockerfileUrl = new URL("../services/lean-runner/Dockerfile.core-alpha-base", import.meta.url);
const mathlibBaseDockerfileUrl = new URL("../services/lean-runner/Dockerfile.mathlib-base", import.meta.url);
const dockerignoreUrl = new URL("../.dockerignore", import.meta.url);
const imageContractUrl = new URL("../docs/runner-container-image.md", import.meta.url);
const imageWorkflowUrl = new URL("../.github/workflows/build-e2b-lean-runner-image.yml", import.meta.url);

test("Lean Runner image recipe fails closed and keeps its build context minimal", async () => {
  const [dockerfile, coreBaseDockerfile, mathlibBaseDockerfile, dockerignore, contract, imageWorkflow] = await Promise.all([
    readFile(dockerfileUrl, "utf8"),
    readFile(coreBaseDockerfileUrl, "utf8"),
    readFile(mathlibBaseDockerfileUrl, "utf8"),
    readFile(dockerignoreUrl, "utf8"),
    readFile(imageContractUrl, "utf8"),
    readFile(imageWorkflowUrl, "utf8"),
  ]);

  assert.match(dockerfile, /^ARG RUNNER_BASE_IMAGE$/m);
  assert.match(dockerfile, /^FROM \$\{RUNNER_BASE_IMAGE\}$/m);
  assert.match(dockerfile, /RUNNER_BASE_IMAGE must be pinned by sha256 digest/);
  assert.match(dockerfile, /pw-lean-image-v1/);
  assert.match(dockerfile, /command -v lake/);
  assert.match(dockerfile, /command -v lean/);
  assert.match(dockerfile, /command -v patch/);
  assert.match(dockerfile, /command -v tar/);
  assert.match(dockerfile, /createZstdDecompress/);
  assert.match(dockerfile, /USER proofweave/);
  assert.match(dockerfile, /ENTRYPOINT \["node", "\/opt\/proofweave\/services\/lean-runner\/container-http-server\.mjs"\]/);
  assert.doesNotMatch(dockerfile, /(?:apt-get|apk add|curl|wget|git clone|npm (?:install|ci))/i);
  assert.doesNotMatch(dockerfile, /ENV\s+PROOFWEAVE_(?:NETWORK_ISOLATED|RESOURCE_LIMITS_ENFORCED)/);

  assert.match(coreBaseDockerfile, /^ARG NODE_BASE_IMAGE$/m);
  assert.match(coreBaseDockerfile, /^FROM \$\{NODE_BASE_IMAGE\}$/m);
  assert.match(coreBaseDockerfile, /NODE_BASE_IMAGE must be pinned by sha256 digest/);
  assert.match(coreBaseDockerfile, /The core-alpha base cannot claim a Mathlib revision/);
  assert.match(coreBaseDockerfile, /github\.com\/leanprover\/lean4\/releases\/download/);
  assert.match(coreBaseDockerfile, /sha256sum --check --strict/);
  assert.match(coreBaseDockerfile, /Installed Lean version does not match the reviewed toolchain/);
  assert.match(coreBaseDockerfile, /createZstdDecompress/);
  assert.doesNotMatch(coreBaseDockerfile, /elan-init|git clone|lake exe cache get/);

  assert.match(mathlibBaseDockerfile, /^ARG NODE_BASE_IMAGE$/m);
  assert.match(mathlibBaseDockerfile, /EXPECTED_MATHLIB_REVISION must be an exact Git commit/);
  assert.match(mathlibBaseDockerfile, /sha256sum --check --strict/);
  assert.match(mathlibBaseDockerfile, /git clone --filter=blob:none --no-checkout/);
  assert.match(mathlibBaseDockerfile, /git -C \/tmp\/mathlib fetch --depth=1 origin/);
  assert.match(mathlibBaseDockerfile, /lake exe cache get/);
  assert.match(mathlibBaseDockerfile, /PROOFWEAVE_LAKE_PACKAGES_ROOT=\/opt\/proofweave\/lake-packages/);
  assert.match(mathlibBaseDockerfile, /adduser --system --ingroup proofweave/);
  assert.match(mathlibBaseDockerfile, /ln -s \.\.\/\.\. \/opt\/proofweave\/lake-packages\/mathlib\/\.lake\/packages/);
  assert.match(mathlibBaseDockerfile, /chown -R proofweave:proofweave \/opt\/proofweave\/lake-packages/);
  assert.match(mathlibBaseDockerfile, /chmod -R a\+rX,a-w \/opt\/proofweave\/lake-packages/);
  assert.match(mathlibBaseDockerfile, /su -s \/bin\/sh nobody -c 'test -r \/opt\/proofweave\/lake-packages\/mathlib\/\.lake\/config\/mathlib'/);
  assert.doesNotMatch(mathlibBaseDockerfile, /find \/opt\/proofweave\/lake-packages -name \.git/);
  assert.match(mathlibBaseDockerfile, /su -s \/bin\/sh proofweave -c 'cd \/opt\/proofweave\/lake-packages\/mathlib && lake env lean/);

  assert.match(imageWorkflow, /node@sha256:[a-f0-9]{64}/);
  assert.match(imageWorkflow, /lean-4\.27\.0-linux\.zip/);
  assert.match(imageWorkflow, /mathlib-4\.27-a3a10/);
  assert.match(imageWorkflow, /mathlib-4\.31-9a948/);
  assert.match(imageWorkflow, /a3a10db0e9d66acbebf76c5e6a135066525ac900/);
  assert.match(imageWorkflow, /9a9483a92959bc92bd6a60176dd1fe597298c1f8/);
  assert.match(imageWorkflow, /lean_release_sha256=[a-f0-9]{64}/);
  assert.match(imageWorkflow, /docker\/setup-buildx-action@[a-f0-9]{40}/);
  assert.match(imageWorkflow, /driver: docker-container/);
  assert.doesNotMatch(imageWorkflow, /^\s+install: true$/m);
  assert.ok(
    imageWorkflow.indexOf("docker/setup-buildx-action@")
      < imageWorkflow.indexOf("docker/build-push-action@"),
    "the attestation-capable Buildx builder must be initialized before the first image build",
  );
  assert.match(imageWorkflow, /network: none/);
  assert.match(imageWorkflow, /--read-only --network=none/);
  assert.match(imageWorkflow, /--entrypoint node "\$FINAL_RUNNER_IMAGE"/);
  assert.match(imageWorkflow, /inspect-image-environment\.mjs/);
  assert.match(imageWorkflow, /docker buildx prune --all --force/);
  assert.ok(imageWorkflow.indexOf("docker buildx prune --all --force") < imageWorkflow.indexOf("Exercise the final image without network access"));
  assert.equal(imageWorkflow.match(/provenance: mode=max/g)?.length, 2);
  assert.equal(imageWorkflow.match(/sbom: true/g)?.length, 2);
  assert.match(imageWorkflow, /if: \$\{\{ github\.event\.repository\.visibility == 'public' \}\}/);
  assert.match(imageWorkflow, /registry-attached BuildKit SBOM and provenance remain the published image evidence/);
  assert.match(imageWorkflow, /actions\/attest-build-provenance@[a-f0-9]{40}/);
  assert.match(imageWorkflow, /build-e2b-template:[\s\S]*?permissions:[\s\S]*?packages: read/);
  assert.match(imageWorkflow, /PROOFWEAVE_E2B_REGISTRY_PASSWORD: \$\{\{ github\.token \}\}/);
  assert.match(imageWorkflow, /PROOFWEAVE_E2B_TEMPLATE_NAME: proofweave-runner:\$\{\{ github\.run_id \}\}/);
  assert.match(imageWorkflow, /existing_runner_image:/);
  assert.match(imageWorkflow, /if: \$\{\{ inputs\.existing_runner_image == '' \}\}/);
  assert.match(imageWorkflow, /inputs\.existing_runner_image \|\| needs\.build-and-inspect\.outputs\.runner_image/);
  assert.match(imageWorkflow, /REVIEWED_RUNNER_PREFIX: ["']ghcr\.io\/\$\{\{ github\.repository_owner \}\}\/proofweave-lean-runner@sha256:["']/);
  assert.match(imageWorkflow, /build-and-inspect:[\s\S]*?permissions:[\s\S]*?packages: write/);
  assert.doesNotMatch(imageWorkflow, /PROOFWEAVE_E2B_REGISTRY_PASSWORD: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);

  assert.match(dockerignore, /^\*$/m);
  assert.match(dockerignore, /^!packages\/\*\*$/m);
  assert.match(dockerignore, /^!services\/lean-runner\/\*\*$/m);
  assert.doesNotMatch(dockerignore, /^!\.env/m);

  assert.match(contract, /--network=none/);
  assert.match(contract, /--read-only --network=none/);
  assert.match(contract, /@sha256:/);
  assert.match(contract, /PROOFWEAVE_RESOURCE_LIMITS_ENFORCED/);
});
