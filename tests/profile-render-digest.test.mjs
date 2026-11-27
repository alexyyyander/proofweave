import assert from "node:assert/strict";
import { test } from "node:test";
import { onRequestError } from "../instrumentation.ts";
import { createAppRscOnErrorHandler } from "../node_modules/vinext/dist/server/app-rsc-error-handler.js";

for (const source of ["server-rendering", "react-server-components"]) {
  test(`profile logs the client digest for ${source}`, (t) => {
    const log = t.mock.method(console, "error", () => {});
    const path = "/zh-CN/profile";
    const handler = createAppRscOnErrorHandler(onRequestError, new Request("https://example.test" + path), path, "/profile", { renderSource: source });
    const digest = handler(new Error("private test detail"));
    assert.match(digest, /^\d+$/);
    const records = log.mock.calls.map(call => call.arguments).filter(args => args[0] === "profile_render_failed");
    assert.equal(records.length, 1);
    assert.equal(records[0][1].digest, digest);
    assert.doesNotMatch(JSON.stringify(records), /private test detail/);
  });
}

test("profile diagnostics skip other routes and framework navigation", (t) => {
  const log = t.mock.method(console, "error", () => {});
  onRequestError(new Error("unrelated"), { path: "/people" }, { routeType: "render" });
  onRequestError(Object.assign(new Error("redirect"), { digest: "NEXT_REDIRECT" }), { path: "/profile" }, { routeType: "render" });
  assert.equal(log.mock.callCount(), 0);
});
