import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertReviewedRunnerNode } from "../services/lean-runner/runner-node-policy.mjs";
import { assertMinimalRuntimeTools, assertSupportedExecutionDistro } from "../services/lean-runner/runtime-tool-policy.mjs";

test("Execution image rejects unsupported distro identities and CPU-baseline changes", () => {
  assert.doesNotThrow(() => assertSupportedExecutionDistro('ID="rocky"\nVERSION_ID="9.7"\n'));
  for (const identity of ['ID=wolfi\nVERSION_ID=20230201', 'ID=debian\nVERSION_ID="13"', 'ID=rocky\nVERSION_ID="10.1"', 'ID_LIKE=rocky\nVERSION_ID="9"', 'ID=rocky\nVERSION_ID="90"']) {
    assert.throws(() => assertSupportedExecutionDistro(identity), /reviewed Rocky 9/);
  }
});

test("Runtime inspection rejects package managers and unrelated build tools", () => {
  assert.doesNotThrow(() => assertMinimalRuntimeTools("/opt/lean/bin:/usr/local/bin:/usr/bin", () => false));
  assert.throws(() => assertMinimalRuntimeTools(""), /PATH must be explicit/);
  for (const name of ["npm", "npx", "yarn", "yarnpkg", "gcc", "g++", "make", "wget"]) {
    assert.throws(() => assertMinimalRuntimeTools("/usr/bin", path => path === `/usr/bin/${name}`), /Unexpected build tools/);
  }
});

test("Runner rejects vulnerable, missing, mismatched and unreviewed Node runtimes", () => {
  assert.equal(assertReviewedRunnerNode("22.23.4", "22.23.4"), "22.23.4");
  assert.equal(assertReviewedRunnerNode("22.24.0", "22.24.0"), "22.24.0");
  for (const version of [undefined, "", "22.13.0", "22.23.1", "22.23.3", "24.0.0", "22.23.4-rc.1", "v22.23.4", "022.23.4"]) {
    assert.throws(() => assertReviewedRunnerNode(version, version), /EXPECTED_NODE_VERSION/);
  }
  for (const actual of [undefined, "22.23.1", "22.23.3", "22.23.5", "24.0.0"]) {
    assert.throws(() => assertReviewedRunnerNode(actual, "22.23.4"), /does not match/);
  }
});

const dockerfileUrl = new URL("../services/lean-runner/Dockerfile", import.meta.url);
const coreBaseDockerfileUrl = new URL("../services/lean-runner/Dockerfile.core-alpha-base", import.meta.url);
const mathlibBaseDockerfileUrl = new URL("../services/lean-runner/Dockerfile.mathlib-base", import.meta.url);
const dockerignoreUrl = new URL("../.dockerignore", import.meta.url);
const imageContractUrl = new URL("../docs/runner-container-image.md", import.meta.url);
const imageWorkflowUrl = new URL("../.github/workflows/build-e2b-lean-runner-image.yml", import.meta.url);
const e2bTemplateBuildUrl = new URL("../scripts/build-e2b-lean-runner-template.mjs", import.meta.url);

test("Image scan gate rejects high findings and missing or mismatched evidence", async () => {
  const workflow = await readFile(imageWorkflowUrl, "utf8");
  const scanStep = workflow.slice(workflow.indexOf("      - name: Scan the exact final image"), workflow.indexOf("      - name: Inspect the exported trusted controller"));
  const code = /node --input-type=module -e '([\s\S]*)'\s*$/.exec(scanStep)?.[1];
  assert.ok(code, "exercise the exact scan gate executed by the workflow");
  const image = `ghcr.io/example/runner@sha256:${"a".repeat(64)}`;
  const cases = [
    { name: "clean", report: { Metadata: { RepoDigests: [image] }, Results: [{ Vulnerabilities: [] }] }, approved: true },
    { name: "high-unfixed", report: { Metadata: { RepoDigests: [image] }, Results: [{ Vulnerabilities: [{ Severity: "HIGH", VulnerabilityID: "CVE-test" }] }] }, approved: false, blocking: 1 },
    { name: "critical", report: { Metadata: { RepoDigests: [image] }, Results: [{ Vulnerabilities: [{ Severity: "CRITICAL" }] }] }, approved: false, blocking: 1 },
    { name: "no-results", report: { Metadata: { RepoDigests: [image] }, Results: [] }, approved: false },
    { name: "wrong-image", report: { Metadata: { RepoDigests: [image.replace(/a/g, "b")] }, Results: [{}] }, approved: false },
  ];
  for (const fixture of cases) {
    const directory = await mkdtemp(join(tmpdir(), "pw-image-scan-"));
    try {
      const evidenceRoot = join(directory, "runner-image-evidence");
      await mkdir(evidenceRoot);
      await writeFile(join(evidenceRoot, "trivy.json"), JSON.stringify(fixture.report));
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
        cwd: directory,
        env: { ...process.env, FINAL_RUNNER_IMAGE: image, GITHUB_SHA: "b".repeat(40), GITHUB_RUN_ID: "123" },
        encoding: "utf8",
      });
      assert.equal(result.status === 0, fixture.approved, fixture.name + ": " + result.stderr);
      if (fixture.approved || fixture.blocking) {
        const evidence = JSON.parse(await readFile(join(evidenceRoot, "image-review.json"), "utf8"));
        assert.equal(evidence.image, image);
        assert.equal(evidence.blockingHighCritical, fixture.blocking ?? 0);
        assert.equal(evidence.ignoredUnfixed, false);
        assert.match(evidence.scanSha256, /^[a-f0-9]{64}$/);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

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
  assert.match(coreBaseDockerfile, /^FROM \$\{NODE_BASE_IMAGE\} AS node-source$/m);
  assert.match(coreBaseDockerfile, /^FROM node-source AS builder$/m);
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
  assert.match(mathlibBaseDockerfile, /lake build Mathlib/);
  assert.match(mathlibBaseDockerfile, /lake build proofwidgets\/widgetPackageLock/);
  assert.match(mathlibBaseDockerfile, /PROOFWEAVE_LAKE_PACKAGES_ROOT=\/opt\/proofweave\/lake-packages/);
  assert.match(mathlibBaseDockerfile, /adduser --system --ingroup proofweave/);
  assert.match(mathlibBaseDockerfile, /ln -s \.\.\/\.\. \/opt\/proofweave\/lake-packages\/mathlib\/\.lake\/packages/);
  assert.match(mathlibBaseDockerfile, /chown -R proofweave:proofweave \/opt\/proofweave\/lake-packages/);
  assert.match(mathlibBaseDockerfile, /chmod -R a\+rX,a-w \/opt\/proofweave\/lake-packages/);
  assert.match(mathlibBaseDockerfile, /find \/opt\/proofweave\/lake-packages \\\( -path '\*\/\.lake\/config' -o -path '\*\/\.lake\/config\/\*' \\\) -type d -exec chmod a\+rwx/);
  assert.match(mathlibBaseDockerfile, /find \/opt\/proofweave\/lake-packages -path '\*\/\.lake\/config\/\*' -type f -exec chmod a\+rw/);
  assert.match(mathlibBaseDockerfile, /su -s \/bin\/sh nobody -c 'test -z/);
  assert.match(mathlibBaseDockerfile, /find \/opt\/proofweave\/lake-packages/);
  assert.match(mathlibBaseDockerfile, /-type f ! -readable/);
  assert.match(mathlibBaseDockerfile, /-type d ! -executable/);
  assert.doesNotMatch(mathlibBaseDockerfile, /find \/opt\/proofweave\/lake-packages -name \.git/);
  assert.match(mathlibBaseDockerfile, /proofweave-external-smoke\/\.lake\/packages/);
  assert.match(mathlibBaseDockerfile, /lean_lib ProofweaveImageSmoke/);
  assert.match(mathlibBaseDockerfile, /name: "proofweaveExternalSmoke", packages: \[mathlib, \.\.\.manifest\.packages\]/);
  assert.match(mathlibBaseDockerfile, /su -s \/bin\/sh proofweave -c 'cd \/tmp\/proofweave-external-smoke && lake build ProofweaveImageSmoke && lake env lean ProofweaveImageSmoke\.lean'/);
  for (const recipe of [coreBaseDockerfile, mathlibBaseDockerfile]) {
    assert.match(recipe, /^ARG RUNTIME_BASE_IMAGE$/m);
    assert.match(recipe, /^FROM \$\{RUNTIME_BASE_IMAGE\} AS minimal-runtime$/m);
    assert.match(recipe, /^FROM minimal-runtime$/m);
    assert.match(recipe, /COPY --from=node-source \/usr\/local\/bin\/node \/usr\/local\/bin\/node/);
    assert.match(recipe, /COPY --from=builder \/opt\/lean \/opt\/lean/);
    assert.doesNotMatch(recipe, /COPY --from=builder \/usr\/local\s/);
    assert.ok(recipe.indexOf("FROM minimal-runtime") < recipe.lastIndexOf("su -s /bin/sh proofweave"));
  }
  const runtimeSetup = await readFile(new URL("../services/lean-runner/prepare-minimal-runtime.sh", import.meta.url), "utf8");
  assert.match(runtimeSetup, /microdnf upgrade -y/);
  assert.match(runtimeSetup, /rpm -qa/);
  assert.doesNotMatch(runtimeSetup, /rm\s+-rf.*(?:rpm|lib\/rpm)/);

  assert.match(imageWorkflow, /node@sha256:[a-f0-9]{64}/);
  assert.match(imageWorkflow, /EXPECTED_NODE_VERSION: 22\.23\.4/);
  assert.equal(imageWorkflow.match(/EXPECTED_NODE_VERSION=\$\{\{ env\.EXPECTED_NODE_VERSION \}\}/g)?.length, 2);
  assert.match(imageWorkflow, /-e EXPECTED_NODE_VERSION="\$EXPECTED_NODE_VERSION"/);
  for (const recipe of [dockerfile, coreBaseDockerfile, mathlibBaseDockerfile]) {
    assert.match(recipe, /^ARG EXPECTED_NODE_VERSION$/m);
    assert.match(recipe, /assertReviewedRunnerNode\(process\.versions\.node, process\.env\.EXPECTED_NODE_VERSION\)/);
  }
  const inspector = await readFile(new URL("../services/lean-runner/inspect-image-environment.mjs", import.meta.url), "utf8");
  assert.match(inspector, /assertReviewedRunnerNode\(process\.versions\.node, process\.env\.EXPECTED_NODE_VERSION\)/);
  assert.match(imageWorkflow, /cancel-in-progress: false/);
  assert.match(imageWorkflow, /trivy_0\.76\.1_Linux-64bit\.tar\.gz/);
  assert.match(imageWorkflow, /c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0/);
  assert.match(imageWorkflow, /--scanners vuln --list-all-pkgs/);
  assert.match(imageWorkflow, /RepoDigests\?\.includes\(process\.env\.FINAL_RUNNER_IMAGE\)/);
  assert.doesNotMatch(imageWorkflow, /--ignore-unfixed|continue-on-error: true/);
  assert.match(imageWorkflow, /actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(inspector, /proofweave-image-dependency-inventory/);
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
  assert.match(imageWorkflow, /docker run --rm --network=none/);
  assert.doesNotMatch(imageWorkflow, /docker run --rm --read-only --network=none/);
  assert.match(imageWorkflow, /--cpus=2 --memory=2g/);
  assert.match(imageWorkflow, /--entrypoint node "\$FINAL_RUNNER_IMAGE"/);
  assert.match(imageWorkflow, /inspect-image-environment\.mjs/);
  assert.match(imageWorkflow, /docker buildx prune --all --force/);
  assert.ok(imageWorkflow.indexOf("docker buildx prune --all --force") < imageWorkflow.indexOf("Exercise the final image without network access"));
  assert.equal(imageWorkflow.match(/provenance: mode=max/g)?.length, 2);
  assert.equal(imageWorkflow.match(/sbom: true/g)?.length, 2);
  assert.match(imageWorkflow, /if: \$\{\{ github\.event\.repository\.visibility == 'public' \}\}/);
  assert.match(imageWorkflow, /registry-attached BuildKit SBOM and provenance remain the published image evidence/);
  assert.match(imageWorkflow, /actions\/attest-build-provenance@[a-f0-9]{40}/);
  assert.match(imageWorkflow, /build-and-inspect:[\s\S]*?permissions:[\s\S]*?packages: write/);
  assert.match(imageWorkflow, /password: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.doesNotMatch(imageWorkflow, /^\s+environment:/m);
  assert.doesNotMatch(imageWorkflow, /\b(?:build-e2b-template|build_e2b_template|existing_runner_image)\b/);
  assert.doesNotMatch(imageWorkflow, /\b(?:E2B_API_KEY|TURSO_DATABASE_URL|TURSO_AUTH_TOKEN)\b/);
  assert.doesNotMatch(imageWorkflow, /runner:e2b:template:build/);
  assert.match(contract, /It never creates an E2B template and has no production Environment dependency/);
  assert.match(contract, /local operator command\s+`npm run runner:e2b:template:build`/);

  assert.match(dockerignore, /^\*$/m);
  assert.match(dockerignore, /^!packages\/\*\*$/m);
  assert.match(dockerignore, /^!services\/lean-runner\/\*\*$/m);
  assert.doesNotMatch(dockerignore, /^!\.env/m);

  assert.match(contract, /--network=none/);
  assert.match(contract, /docker run --rm --network=none/);
  assert.match(contract, /whole-root read-only container/);
  assert.match(contract, /@sha256:/);
  assert.match(contract, /PROOFWEAVE_RESOURCE_LIMITS_ENFORCED/);
});

test("E2B template source overlay is explicit, bounded, and root-owned", async () => {
  const source = await readFile(e2bTemplateBuildUrl, "utf8");

  assert.match(source, /PROOFWEAVE_E2B_RUNNER_SOURCE_OVERLAY/);
  assert.match(source, /const repositoryRoot = fileURLToPath\(new URL\("\.\.", import\.meta\.url\)\)/);
  assert.match(source, /fileContextPath: repositoryParent/);
  assert.match(source, /\.remove\(\[\s*"\/opt\/proofweave\/packages",\s*"\/opt\/proofweave\/services\/lean-runner",/);
  assert.match(source, /force: true,\s*recursive: true,\s*user: "root"/);
  assert.match(source, /\.copy\(`\$\{repositoryDirectory\}\/packages`, "\/opt\/proofweave\/packages\/"/);
  assert.match(source, /\.copy\(`\$\{repositoryDirectory\}\/services\/lean-runner`, "\/opt\/proofweave\/services\/lean-runner\/"/);
  assert.equal(source.match(/forceUpload: true/g)?.length, 2);
  assert.equal(source.match(/user: "root"/g)?.length, 4);
  assert.equal(source.match(/resolveSymlinks: false/g)?.length, 2);
  assert.match(source, /chown -R root:root \/opt\/proofweave\/packages \/opt\/proofweave\/services\/lean-runner/);
  assert.match(source, /find \/opt\/proofweave\/packages \/opt\/proofweave\/services\/lean-runner -type d -exec chmod 0755/);
  assert.match(source, /find \/opt\/proofweave\/packages \/opt\/proofweave\/services\/lean-runner -type f -exec chmod 0644/);
  assert.match(source, /grep -F 'allowedRootWorkspaceDotfiles' \/opt\/proofweave\/packages\/protocol\/workspace-tree\.mjs/);
  assert.match(source, /grep -F 'from \\"\.\.\/\.\.\/packages\/protocol\/workspace-tree\.mjs\\"' \/opt\/proofweave\/services\/lean-runner\/container-workspace-runtime\.mjs/);
  assert.match(source, /node --check \/opt\/proofweave\/services\/lean-runner\/container-http-server\.mjs/);
  assert.doesNotMatch(source, /\.copy\([^)]*(?:\.env|secret|credential|node_modules)/i);
});
