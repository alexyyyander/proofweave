import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as react from "react";
import { closedAlphaAttemptLimits } from "../packages/domain/attempt-policy.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const limit = closedAlphaAttemptLimits.maximumActiveAttemptsPerPerson;
const activeAttempts = () => Array.from({ length: limit }, (_, index) => ({
  id: `attempt-${index}`, status: "active", problemSlug: `target-${index}`,
  agentId: "agent", delegationScope: "prove",
}));

test("at capacity, Continue research opens the existing active record without a POST", async () => {
  const attempts = activeAttempts();
  const view = launcher({ attempts });
  assert.equal(view.button.props.disabled, false);
  assert.match(textContent(view.button), /Continue research/);
  assert.doesNotMatch(textContent(view.tree), /closed-alpha maximum/);
  view.button.props.onClick();
  await new Promise(setImmediate);
  assert.deepEqual(view.selected, [attempts[0]]);
  assert.deepEqual(view.requests, []);
});

test("at capacity, an existing paused record can still be opened", async () => {
  const attempts = activeAttempts();
  attempts[0].problemSlug = "different-target";
  const paused = { ...attempts[0], id: "paused", problemSlug: "target-0", status: "paused" };
  const view = launcher({ attempts: [...attempts, paused] });
  assert.equal(view.button.props.disabled, false);
  view.button.props.onClick();
  await new Promise(setImmediate);
  assert.deepEqual(view.selected, [paused]);
  assert.deepEqual(view.requests, []);
});

test("at capacity, unrelated or completed records cannot bypass the creation limit", async () => {
  for (const change of [
    { problemSlug: "other" }, { agentId: "other" },
    { delegationScope: "formalize" }, { status: "completed" },
  ]) {
    const attempts = activeAttempts();
    attempts[0].problemSlug = "other";
    attempts.push({ ...attempts[1], id: "candidate", problemSlug: "target-0", ...change });
    const view = launcher({ attempts });
    assert.equal(view.button.props.disabled, true);
    assert.match(textContent(view.button), /Active research capacity reached/);
    // Exercise the handler guard too, even if a stale UI dispatches a click.
    view.button.props.onClick();
    await new Promise(setImmediate);
    assert.deepEqual(view.selected, []);
    assert.deepEqual(view.requests, []);
  }
});

test("below capacity, Start research creates a record with the selected target and delegation", async () => {
  const view = launcher({ attempts: activeAttempts().slice(1) });
  assert.equal(view.button.props.disabled, false);
  assert.match(textContent(view.button), /Start research/);
  view.button.props.onClick();
  await new Promise(setImmediate);
  assert.equal(view.requests.length, 1);
  const [url, options] = view.requests[0];
  assert.equal(url, "/api/me/attempts");
  assert.equal(options.method, "POST");
  const body = JSON.parse(options.body);
  assert.equal(body.problemSlug, "target-0");
  assert.equal(body.delegationCertificateId, "delegation");
  assert.equal(body.delegationScope, "prove");
  assert.match(body.idempotencyKey, /^research-launcher:/);
  assert.deepEqual(view.selected, [{ id: "created" }]);
});

test("maintenance still hides research actions even when an existing record could be reused", () => {
  const view = launcher({ attempts: activeAttempts(), writeAvailability: "read_only" });
  assert.equal(view.button, undefined);
  assert.deepEqual(view.requests, []);
});

// Evaluate the actual TSX and local helpers with a single-render hook harness.
// JSX elements and click handlers are real; only state persistence, HTTP, and
// scrolling are substituted. No browser, account, or production writes occur.
function launcher(overrides) {
  const selected = [];
  const requests = [];
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const compiledModule = { exports: {} };
    const source = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: filename,
    }).outputText;
    runInNewContext(source, {
      module: compiledModule, exports: compiledModule.exports, URLSearchParams, crypto: globalThis.crypto,
      window: { setTimeout() {} },
      fetch: async (...args) => {
        requests.push(args);
        return { ok: true, json: async () => ({ attempt: { id: "created" } }) };
      },
      require(specifier) {
        if (specifier === "react") return { ...react, useMemo: (fn) => fn(), useState: (value) => [value, () => {}] };
        if (specifier === "next/link") return { __esModule: true, default: "a" };
        if (specifier.startsWith(".") || specifier.startsWith("@/")) {
          const path = specifier.startsWith("@/") ? resolve(root, specifier.slice(2)) : resolve(dirname(filename), specifier);
          return path.endsWith(".mjs") ? require(path) : load(`${path}.ts`);
        }
        return require(specifier);
      },
    }, { filename });
    cache.set(filename, compiledModule.exports);
    return compiledModule.exports;
  }
  const { ResearchLauncher } = load(resolve(root, "app/workbench/ResearchLauncher.tsx"));
  const tree = ResearchLauncher({
    profile: {
      agents: [{ id: "agent", status: "active", revokedAt: null }],
      delegations: [{ id: "delegation", agentId: "agent", scopes: ["prove"], revokedAt: null, signerKeyRevokedAt: null,
        validFrom: "2000-01-01T00:00:00Z", validUntil: "2100-01-01T00:00:00Z" }],
      agentInstallations: [{ agentId: "agent", agentLabel: "My Agent", status: "active", delegationCertificateId: "delegation" }],
    },
    catalogTargets: [{ id: "target", slug: "target-0", title: "Selected question", source: { leanToolchain: "lean" } }],
    initialTargetSlug: "target-0", initialParentNodeId: null,
    isAuthenticated: true, storageAvailable: true, writeAvailability: "available", signInPath: "/sign-in",
    onAttemptReady: (attempt) => selected.push(attempt), ...overrides,
  });
  const button = elements(tree).find((element) => element.type === "button");
  return { tree, button, selected, requests };
}

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object") return [];
  return [node, ...elements(node.props?.children)];
}

function textContent(node) {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object") return textContent(node.props?.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}
