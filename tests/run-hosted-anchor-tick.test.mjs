import assert from "node:assert/strict";
import test from "node:test";
import { requestHostedAnchorTick } from "../scripts/run-hosted-anchor-tick.mjs";

const credentials = { url: "https://proofweave.org/api/internal/anchors/tick", token: "test-credential-012345678901234567890123" };

test("Cloudflare HTML failure reports HTTP and Ray ID without exposing the body", async () => {
  const result = await requestHostedAnchorTick(credentials, { fetcher: async () => new Response(
    `<html>${credentials.token}</html>`, { status: 403, headers: { "content-type": "text/html; charset=UTF-8", "cf-ray": "a4b44fe6eaf8c173-LAX" } }) });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.summary, { httpStatus: 403, contentType: "text/html", cloudflareRayId: "a4b44fe6eaf8c173-LAX", status: "edge_blocked" });
  assert.ok(!JSON.stringify(result).includes(credentials.token));
});

test("an upstream redirect is not followed with tick credentials", async () => {
  let calls = 0;
  const result = await requestHostedAnchorTick(credentials, { fetcher: async (url, options) => {
    calls++;
    assert.equal(url, credentials.url);
    assert.equal(options.redirect, "manual");
    assert.equal(options.headers.authorization, `Bearer ${credentials.token}`);
    return new Response(null, { status: 307, headers: { location: "https://other.example/tick" } });
  } });
  assert.equal(calls, 1);
  assert.equal(result.summary.status, "unexpected_redirect");
  assert.equal(result.exitCode, 1);
});

test("a lost response remains unknown and is not automatically retried", async () => {
  let calls = 0;
  const result = await requestHostedAnchorTick(credentials, { fetcher: async () => { calls++; throw Error(credentials.token); } });
  assert.equal(calls, 1);
  assert.deepEqual(result, { summary: { httpStatus: null, status: "transport_error", outcome: "unknown" }, exitCode: 1 });
});

test("HTTP errors cannot be masked by a successful JSON status or spoofed httpStatus", async () => {
  const result = await requestHostedAnchorTick(credentials, { fetcher: async () => Response.json({ status: "ok", httpStatus: 200 }, { status: 503 }) });
  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.httpStatus, 503);
});

test("normal tick fields and busy responses remain available", async () => {
  for (const body of [{status:"ok",batchCreated:false,confirmedBatches:[],failedBatches:[],errors:[]}, {status:"busy"}]) {
    const result = await requestHostedAnchorTick(credentials, { fetcher: async () => Response.json(body) });
    assert.deepEqual(result, { summary: { ...body, httpStatus: 200 }, exitCode: 0 });
  }
});

test("non-JSON and invalid JSON shapes fail without dumping response contents", async () => {
  for (const response of [new Response("<html>upstream</html>", {status:502}), Response.json(null), Response.json([]), Response.json({errors:[]})]) {
    const result = await requestHostedAnchorTick(credentials, { fetcher: async () => response });
    assert.equal(result.summary.status, "invalid_response");
    assert.equal(result.exitCode, 1);
  }
});

test("invalid credential destinations are rejected before any network call", async () => {
  await assert.rejects(requestHostedAnchorTick({...credentials,url:"https://other.example/tick"}, {fetcher: () => assert.fail("must not call")}), /Invalid hosted anchor tick credentials/);
});
