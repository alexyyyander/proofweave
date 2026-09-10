import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { integrationRefreshHref } from "../packages/protocol/integration-return-href.mjs";

const workbenchSections = await readFile(
  new URL("../app/workbench/workbench-sections.tsx", import.meta.url),
  "utf8",
);
const localAgentHandoff = await readFile(
  new URL("../app/workbench/LocalAgentHandoff.tsx", import.meta.url),
  "utf8",
);
const attemptIntegrationHelper = await readFile(
  new URL("../app/lib/attempt-integration-href.ts", import.meta.url),
  "utf8",
);
const integrationClient = await readFile(
  new URL("../app/integrations/IntegrationClient.tsx", import.meta.url),
  "utf8",
);
const controlPlaneCapability = await readFile(
  new URL("../app/lib/control-plane-write-capability.ts", import.meta.url),
  "utf8",
);
const globalStyles = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("the owner-side journey ends truthfully at Lean verification", () => {
  assert.match(workbenchSections, /\["Lean verification", leanAccepted \? "Kernel accepted · review remains" : "Isolated Lean check"\]/);
  assert.match(workbenchSections, /\{completed\} \/ \{steps\.length\} owner steps complete/);
  assert.match(workbenchSections, /five owner-side steps end at Lean acceptance; they do not issue contribution credit/i);
  assert.doesNotMatch(workbenchSections, /\["Verification & credit"/);
});

test("every existing-Attempt reconnect preserves target and exact return path", () => {
  assert.match(
    attemptIntegrationHelper,
    /function attemptIntegrationHref\([\s\S]*attempt: Pick<McpAttempt, "id" \| "problemSlug">[\s\S]*returnTo = `\/workbench\/attempts\/\$\{encodeURIComponent\(attempt\.id\)\}`[\s\S]*target=\$\{encodeURIComponent\(attempt\.problemSlug\)\}&return_to=\$\{encodeURIComponent\(returnTo\)\}/,
  );
  assert.match(
    workbenchSections,
    /const attemptReconnectHref = attempt \? attemptIntegrationHref\(attempt\) : "\/integrations#codex-beta"[\s\S]*!agentConnected[\s\S]*href: attemptReconnectHref[\s\S]*label: "Connect Agent"/,
  );
  assert.match(
    workbenchSections,
    /needsAttemptConnection[\s\S]*const attemptReconnectHref = attempt \? attemptIntegrationHref\(attempt\) : "\/integrations#codex-beta"[\s\S]*label: "Review Agent connection"[\s\S]*href: attemptReconnectHref/,
  );
  assert.match(
    localAgentHandoff,
    /if \(!connection\)[\s\S]*href=\{attemptIntegrationHref\(attempt\)\}/,
  );
  assert.match(
    localAgentHandoff,
    /if \(!active\)[\s\S]*href: attempt \? attemptIntegrationHref\(attempt\) : "\/integrations#codex-beta"/,
  );
  assert.match(
    integrationClient,
    /const pageHref = integrationRefreshHref\(\{[\s\S]*targetSlug: selectedTarget\?\.slug,[\s\S]*returnHref/,
  );
  assert.equal(
    integrationRefreshHref({
      targetSlug: null,
      returnHref: "/workbench/attempts/attempt%3Aretired-target",
    }),
    "/integrations?return_to=%2Fworkbench%2Fattempts%2Fattempt%253Aretired-target#codex-beta",
  );
  assert.equal(
    integrationRefreshHref({
      targetSlug: "erdos-865-k2",
      returnHref: "/workbench/attempts/attempt:123",
    }),
    "/integrations?target=erdos-865-k2&return_to=%2Fworkbench%2Fattempts%2Fattempt%3A123#codex-beta",
  );
});

test("the contribution rail remains readable on desktop and mobile", () => {
  assert.match(globalStyles, /\.first-contribution-path li strong \{[^}]*font-size: 13px/);
  assert.match(globalStyles, /\.first-contribution-path li small \{[^}]*font-size: 12px/);
  assert.match(globalStyles, /\.first-contribution-boundary \{[^}]*font-size: 12px/);

  const mobileBlock = globalStyles.match(/@media \(max-width: 620px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.doesNotMatch(mobileBlock, /\.first-contribution-path li (?:strong|small) \{[^}]*font-size:\s*(?:[0-9]|1[01])px/);
  assert.doesNotMatch(mobileBlock, /\.first-contribution-boundary \{[^}]*font-size:\s*(?:[0-9]|1[01])px/);
});

test("the ordinary-user surface distinguishes edge blocking from planned read-only maintenance", () => {
  assert.match(controlPlaneCapability, /response\.status === 403\) return \"edge_blocked\"/);
  assert.match(controlPlaneCapability, /return \"network_unavailable\"/);
  assert.match(controlPlaneCapability, /title: \"Proofweave is blocked at its public edge\.\"/);
  assert.match(controlPlaneCapability, /reconnecting or uploading files will not fix this service-side problem/i);
  assert.match(controlPlaneCapability, /title: \"Research updates are paused for maintenance\.\"/);
});
