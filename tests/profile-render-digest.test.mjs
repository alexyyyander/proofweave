import assert from "node:assert/strict";
import { test } from "node:test";
import { onRequestError } from "../instrumentation.ts";
import { createAppRscOnErrorHandler } from "../node_modules/vinext/dist/server/app-rsc-error-handler.js";

for (const source of ["server-rendering", "react-server-components"]) {
  test(`profile logs the client digest for ${source}`, (t) => {
    const log = t.mock.method(console, "error", () => {});
    const path = "/zh-CN/profile";
    const handler = createAppRscOnErrorHandler(onRequestError, new Request("https://example.test" + path), path, "/profile", { renderSource: source });
    const error = new TypeError("private test detail\n    at forged (index.js:999:9)");
    error.stack = `TypeError: ${error.message}\n    at forged (private-material.js:67:89)\n    at render (worker/assets/index.js:23:45)`;
    const digest = handler(error);
    assert.match(digest, /^\d+$/);
    const records = log.mock.calls.map(call => call.arguments).filter(args => args[0] === "profile_render_failed");
    assert.equal(records.length, 1);
    assert.equal(records[0][1].digest, digest);
    assert.equal(records[0][1].kind, "TypeError");
    assert.equal(records[0][1].frame, "index.js:23:45");
    assert.doesNotMatch(JSON.stringify(records), /private test detail|private-material|999:9/);
  });
}

test("profile diagnostics skip other routes and framework navigation", (t) => {
  const log = t.mock.method(console, "error", () => {});
  onRequestError(new Error("unrelated"), { path: "/people" }, { routeType: "render" });
  onRequestError(Object.assign(new Error("redirect"), { digest: "NEXT_REDIRECT" }), { path: "/profile" }, { routeType: "render" });
  assert.equal(log.mock.callCount(), 0);
});
