import assert from "node:assert/strict";
import test from "node:test";
import { checkBuildWeekDemoRelease } from "../scripts/check-build-week-demo-release.mjs";

const baseUrl = "https://demo.example";
const receiptPath = `/receipt/receipt%3A${"a".repeat(64)}`;

test("the release check covers the public story, verifier, tamper path, and live Receipt", async () => {
  const result = await checkBuildWeekDemoRelease({
    baseUrl,
    fetchImpl: createFetch({ tamperRejected: true }),
  });

  assert.equal(result.outcome, "passed");
  assert.equal(result.referenceChecks, "6/6");
  assert.equal(result.tamperRejected, true);
  assert.equal(result.receiptPath, receiptPath);
  assert.deepEqual(result.checkedRoutes, [
    "/",
    "/demo",
    "/api/demo/verify",
    "/api/demo/verify?tamper=artifact",
    receiptPath,
  ]);
});

test("the release check fails when tampered artifact bytes are accepted", async () => {
  await assert.rejects(
    checkBuildWeekDemoRelease({
      baseUrl,
      fetchImpl: createFetch({ tamperRejected: false }),
    }),
    /modified artifact bytes/,
  );
});

function createFetch({ tamperRejected }) {
  const responses = new Map([
    [`${baseUrl}/`, html("See a proof become public contribution. proof-journey")],
    [`${baseUrl}/demo`, html(`Watch one Lean proof become verifiable evidence. A real cloud replay reached a signed Receipt. <a href="${receiptPath}">Receipt</a>`)],
    [`${baseUrl}/api/demo/verify`, json({
      status: "verified",
      checks: ["delegation", "bundle", "objects", "runner", "review", "receipt"].map((id) => ({ id, passed: true })),
    })],
    [`${baseUrl}/api/demo/verify?tamper=artifact`, json({
      status: "failed",
      mode: "tampered_copy",
      checks: [{ id: "objects", passed: !tamperRejected }],
    })],
    [`${baseUrl}${receiptPath}`, html("Public evidence record ProofweaveCloudSmoke.true_is_inhabited")],
  ]);
  return async (url) => responses.get(url) ?? new Response("not found", { status: 404 });
}

function html(body) {
  return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
}

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}
