import assert from "node:assert/strict";
import { test } from "node:test";
import {
  directCloudflareRequest, cloudflareValidationResponse, sitesLoginEnabled,
} from "../services/hosting/cloudflare-boundary.mjs";

test("direct clients cannot supply Sites identity or dispatch credentials", async () => {
  const request = new Request("https://proofweave.example/api/mcp", {
    method: "POST", body: "signed request body",
    headers: {
      "OAI-Authenticated-User-Email": "owner@example.com",
      "oai-authenticated-user-full-name": "Owner",
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
      "OAI-Sites-Authorization": "untrusted-dispatch-token",
      "x-dispatched-app": "forged",
      "cloudflare-workers-version-key": "forged",
      authorization: "Bearer application-token",
      cookie: "__Host-pw_session=app-session",
    },
  });
  const sanitized = directCloudflareRequest(request);
  for (const name of ["oai-authenticated-user-email", "oai-authenticated-user-full-name",
    "oai-authenticated-user-full-name-encoding", "oai-sites-authorization",
    "x-dispatched-app", "cloudflare-workers-version-key"]) {
    assert.equal(sanitized.headers.get(name), null);
  }
  assert.equal(sanitized.headers.get("authorization"), "Bearer application-token");
  assert.equal(sanitized.headers.get("cookie"), "__Host-pw_session=app-session");
  assert.equal(await sanitized.text(), "signed request body");
  assert.equal(request.headers.get("oai-authenticated-user-email"), "owner@example.com");
});

test("validation and missing stage reject mutating HTTP methods", () => {
  for (const stage of [undefined, "validation", "typo"]) {
    const settings = { PROOFWEAVE_DEPLOYMENT_STAGE: stage };
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const result = cloudflareValidationResponse(new Request("https://example.com/token", { method }), settings);
      assert.equal(result.status, 503);
      assert.equal(result.headers.get("cache-control"), "no-store");
    }
    for (const method of ["GET", "HEAD"]) {
      assert.equal(cloudflareValidationResponse(new Request("https://example.com/", { method }), settings), null);
    }
  }
  assert.equal(cloudflareValidationResponse(new Request("https://example.com/", { method: "POST" }), {
    PROOFWEAVE_DEPLOYMENT_STAGE: "production",
  }), null);
});

test("Sites login is unavailable on the direct deployment", () => {
  assert.equal(sitesLoginEnabled({ PROOFWEAVE_HOSTING_PLATFORM: "cloudflare" }), false);
  assert.equal(sitesLoginEnabled({}), true);
});

test("validation admits explicit OAuth and read-only MCP transport while research remains frozen", async () => {
  const settings = { PROOFWEAVE_DEPLOYMENT_STAGE: "validation", PROOFWEAVE_CONTROL_PLANE_MODE: "read_write",
    PROOFWEAVE_OAUTH_CONTROL_PLANE_MODE: "read_write", PROOFWEAVE_MCP_CONTROL_PLANE_MODE: "read_only" };
  for (const path of ["/authorize", "/token", "/register", "/api/mcp"]) {
    assert.equal(cloudflareValidationResponse(new Request('https://example.com' + path, { method: 'POST' }), settings), null);
  }
  for (const path of ["/api/internal/anchors/tick", "/api/connect/sessions", "/api/attempts", "/api/mcp/extra", "/token/extra"]) {
    assert.equal(cloudflareValidationResponse(new Request('https://example.com' + path, { method: 'POST' }), settings).status, 503);
  }
  for (const mode of [undefined, 'invalid', 'read_write']) {
    assert.equal(cloudflareValidationResponse(new Request('https://example.com/api/mcp', { method: 'POST' }), { ...settings, PROOFWEAVE_MCP_CONTROL_PLANE_MODE: mode }).status, 503);
  }
  for (const mode of [undefined, 'invalid', 'read_only']) {
    assert.equal(cloudflareValidationResponse(new Request('https://example.com/token', { method: 'POST' }), { ...settings, PROOFWEAVE_OAUTH_CONTROL_PLANE_MODE: mode }).status, 503);
  }
  assert.equal(cloudflareValidationResponse(new Request('https://example.com/token', { method: 'POST' }), { ...settings, PROOFWEAVE_CONTROL_PLANE_MODE: 'read_only' }).status, 503);
  for (const method of ['DELETE', 'PUT', 'PATCH']) {
    assert.equal(cloudflareValidationResponse(new Request('https://example.com/api/mcp', { method }), settings).status, 503);
  }
});


test("validation allows connection lifecycle only with an explicit switch; research stays frozen", () => {
  const settings = { PROOFWEAVE_DEPLOYMENT_STAGE: "validation", PROOFWEAVE_CONTROL_PLANE_MODE: "read_write", PROOFWEAVE_CONNECTION_CONTROL_PLANE_MODE: "read_write" };
  const allowed = ["/api/connect/sessions", "/api/connect/sessions/pairing%3Atest/approve", "/api/me/agents", "/api/me/keys", "/api/me/delegations", "/api/me/keys/key%3Atest/proof", "/api/me/keys/key%3Atest/proof-challenge", "/api/me/keys/key%3Atest/revoke", "/api/me/delegations/delegation%3Atest/revoke", "/api/me/agent-installations/install%3Atest/revoke"];
  for (const path of allowed) {
    assert.equal(cloudflareValidationResponse(new Request('https://example.test' + path, { method: 'POST' }), settings), null);
    for (const mode of [undefined, 'invalid', 'read_only']) {
      assert.equal(cloudflareValidationResponse(new Request('https://example.test' + path, { method: 'POST' }), { ...settings, PROOFWEAVE_CONNECTION_CONTROL_PLANE_MODE: mode }).status, 503);
    }
  }
  for (const path of ["/api/attempts", "/api/me/attempts", "/api/internal/anchors/tick", "/api/me/research/sources", "/api/me/keys/k/proof/extra", "/api/connect/sessions/s/approve/extra"]) {
    assert.equal(cloudflareValidationResponse(new Request('https://example.test' + path, { method: 'POST' }), settings).status, 503);
  }
  assert.equal(cloudflareValidationResponse(new Request('https://example.test/api/connect/sessions', { method: 'POST' }), { ...settings, PROOFWEAVE_CONTROL_PLANE_MODE: 'read_only' }).status, 503);
});
