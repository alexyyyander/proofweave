import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const paths = {
  integration: new URL("../app/integrations/IntegrationClient.tsx", import.meta.url),
  prompt: new URL("../app/integrations/CodexInstallPrompt.tsx", import.meta.url),
  install: new URL("../public/codex-install.md", import.meta.url),
  readme: new URL("../README.md", import.meta.url),
  canonical: new URL("../docs/github-independence.md", import.meta.url),
  bundle: new URL("../docs/artifact-bundle-contract.md", import.meta.url),
  runner: new URL("../docs/runner-provider-neutral-deployment.md", import.meta.url),
  cutover: new URL("../docs/runner-queue-0043-cutover-runbook.md", import.meta.url),
  e2bAdr: new URL("../docs/adr/0009-e2b-online-lean-runner.md", import.meta.url),
  recoveryWorkflow: new URL("../.github/workflows/e2b-lean-runner.yml", import.meta.url),
};

async function sources() {
  const entries = await Promise.all(
    Object.entries(paths).map(async ([name, url]) => [name, await readFile(url, "utf8")]),
  );
  return Object.fromEntries(entries);
}

test("the normal Codex install uses a verified local marketplace without GitHub access", async () => {
  const { integration, prompt, install, readme } = await sources();
  const defaultInstall = install.split("### Advanced:")[0];
  const readmeInstall = readme
    .split("## Install the Codex plugin")[1]
    .split("## Local development")[0];

  for (const text of [integration, prompt, defaultInstall, readmeInstall]) {
    assert.doesNotMatch(text, /GitHub repository access is currently required/i);
    assert.doesNotMatch(text, /marketplace add alexyyyander\/proofweave/i);
  }

  assert.match(integration, /No GitHub account or repository access is required/i);
  assert.match(prompt, /Use the Proofweave-hosted marketplace archive, not a GitHub checkout/i);
  assert.match(prompt, /show me the local download and marketplace directories plus every command/i);
  assert.match(prompt, /Never pipe downloaded content into a shell/i);

  for (const text of [defaultInstall, readmeInstall]) {
    assert.match(text, /downloads\/proofweave-research-marketplace\.tar\b/);
    assert.match(text, /downloads\/proofweave-research-marketplace\.tar\.sha256\b/);
    assert.match(text, /shasum -a 256 -c proofweave-research-marketplace\.tar\.sha256/);
    assert.match(text, /tar -xf proofweave-research-marketplace\.tar -C "\$PROOFWEAVE_MARKETPLACE_DIR"/);
    assert.match(text, /codex plugin marketplace add "\$PROOFWEAVE_MARKETPLACE_DIR"/);
    assert.match(text, /codex plugin add proofweave-research@proofweave-private-beta/);
    assert.doesNotMatch(text, /\|\s*(?:ba)?sh\b/);
  }

  assert.match(install, /Advanced: install from a reviewed GitHub source checkout/i);
  assert.match(install, /GitHub is an optional source and development path, not a product requirement/i);
});

test("the evidence and Runner docs preserve the provider-neutral runtime boundary", async () => {
  const { canonical, bundle, runner, cutover, e2bAdr, recoveryWorkflow } = await sources();

  assert.match(canonical, /Status: canonical architecture and product-truth boundary/i);
  assert.match(canonical, /No step in this path requires the participant to have a GitHub account/i);
  assert.match(canonical, /Bundle v2 is the provider-neutral executable default/i);
  assert.match(canonical, /Hosted Runner \+ E2B is the alpha reference path/i);
  assert.match(canonical, /GitHub Actions is CI, credential-free image release, and diagnostic\s+infrastructure/i);
  assert.match(canonical, /GitHub isolation diagnostic workflow \| Diagnostics only/i);
  assert.match(canonical, /E2B template construction \| No \| Local operator action/i);
  assert.match(canonical, /signed GitHub observation covers fixed reviewed workflow sources\s+at drill begin/i);
  assert.match(canonical, /not continuous or exclusive isolation/i);
  assert.match(canonical, /does not inspect GitHub Environment protection rules/i);
  assert.doesNotMatch(canonical, /I-CONFIRM-GITHUB-RECOVERY-IS-DISABLED\b/);

  assert.match(bundle, /v2: provider-neutral executable workspace evidence/i);
  assert.match(bundle, /default executable format and does not name,\s*fetch, or authenticate against a Git hosting provider/i);
  assert.match(bundle, /v3: optional GitHub provenance/i);
  assert.match(bundle, /never required merely to execute a Run/i);
  assert.doesNotMatch(bundle, /New executable Runs require v2 or GitHub-linked v3/i);

  assert.match(runner, /reference deployment uses a hosted Node control process on Render/i);
  assert.match(runner, /GitHub Actions is not a Runner or recovery execution surface/i);
  assert.match(runner, /manual, secretless static diagnostics/i);
  assert.match(runner, /configuration and control-plane readiness only/i);
  assert.match(runner, /first controlled smoke\s+must verify those provider properties/i);
  assert.doesNotMatch(runner, /protected GitHub Actions trusted Runner/i);

  assert.match(cutover, /External GitHub authority gate/i);
  assert.match(cutover, /not authorized to merge\s+or deploy/i);
  assert.match(cutover, /cannot substitute for this external gate/i);
  assert.match(cutover, /neither proves continuous or hosted-exclusive isolation/i);

  assert.match(e2bAdr, /Status: superseded as the active-controller decision/i);
  assert.match(e2bAdr, /hosted\s+trusted Runner on Render as the alpha reference path/i);

  assert.match(recoveryWorkflow, /no Environment, no production secret, no queue authority, and no E2B client/i);
  assert.match(recoveryWorkflow, /Diagnostic only — no production Environment, Turso queue, or E2B authority/i);
  assert.doesNotMatch(recoveryWorkflow, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(recoveryWorkflow, /^\s+environment:/m);
});
