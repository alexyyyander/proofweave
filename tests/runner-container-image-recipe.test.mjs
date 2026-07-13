import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dockerfileUrl = new URL("../services/lean-runner/Dockerfile", import.meta.url);
const dockerignoreUrl = new URL("../.dockerignore", import.meta.url);
const imageContractUrl = new URL("../docs/runner-container-image.md", import.meta.url);

test("Lean Runner image recipe fails closed and keeps its build context minimal", async () => {
  const [dockerfile, dockerignore, contract] = await Promise.all([
    readFile(dockerfileUrl, "utf8"),
    readFile(dockerignoreUrl, "utf8"),
    readFile(imageContractUrl, "utf8"),
  ]);

  assert.match(dockerfile, /^ARG RUNNER_BASE_IMAGE$/m);
  assert.match(dockerfile, /^FROM \$\{RUNNER_BASE_IMAGE\}$/m);
  assert.match(dockerfile, /RUNNER_BASE_IMAGE must be pinned by sha256 digest/);
  assert.match(dockerfile, /pw-lean-image-v1/);
  assert.match(dockerfile, /command -v lake/);
  assert.match(dockerfile, /command -v lean/);
  assert.match(dockerfile, /command -v patch/);
  assert.match(dockerfile, /command -v tar/);
  assert.match(dockerfile, /command -v zstd/);
  assert.match(dockerfile, /USER proofweave/);
  assert.match(dockerfile, /ENTRYPOINT \["node", "\/opt\/proofweave\/services\/lean-runner\/container-http-server\.mjs"\]/);
  assert.doesNotMatch(dockerfile, /(?:apt-get|apk add|curl|wget|git clone|npm (?:install|ci))/i);
  assert.doesNotMatch(dockerfile, /ENV\s+PROOFWEAVE_(?:NETWORK_ISOLATED|RESOURCE_LIMITS_ENFORCED)/);

  assert.match(dockerignore, /^\*$/m);
  assert.match(dockerignore, /^!packages\/\*\*$/m);
  assert.match(dockerignore, /^!services\/lean-runner\/\*\*$/m);
  assert.doesNotMatch(dockerignore, /^!\.env/m);

  assert.match(contract, /--network=none/);
  assert.match(contract, /--read-only --network=none/);
  assert.match(contract, /@sha256:/);
  assert.match(contract, /PROOFWEAVE_RESOURCE_LIMITS_ENFORCED/);
});
