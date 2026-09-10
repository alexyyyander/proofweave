import assert from "node:assert/strict";
import test from "node:test";
import { checkOrdinaryUserRelease } from "../scripts/check-ordinary-user-release.mjs";

const baseUrl = "https://release.example";
const target = "erdos-865-k2";
const returnTo = `/workbench?target=${target}#research-launcher`;

test("passes the read-only public journey using unauthenticated GET requests only", async () => {
  const requests = [];
  const result = await checkOrdinaryUserRelease({
    baseUrl,
    expectMode: "read_only",
    fetchImpl: createFetch({ mode: "read_only", requests }),
  });

  assert.equal(result.outcome, "passed");
  assert.equal(result.expectedMode, "read_only");
  assert.equal(result.writesEnabled, false);
  assert.deepEqual(result.providers, {
    chatGPT: "available",
    google: "unavailable",
  });
  assert.deepEqual(result.demoVerification, {
    signedEvidenceReverified: true,
    freshLeanReplay: false,
  });
  assert.ok(result.residualGate.includes("isolated Runner execution"));
  assert.ok(requests.length >= 8);
  assert.equal(requests.every((request) => request.method === "GET"), true);
  assert.equal(requests.every((request) => !request.authorization && !request.cookie), true);
});

test("passes a read-write deployment and reports configured Google sign-in", async () => {
  const result = await checkOrdinaryUserRelease({
    baseUrl,
    expectMode: "read_write",
    fetchImpl: createFetch({ mode: "read_write", googleAvailable: true }),
  });

  assert.equal(result.writesEnabled, true);
  assert.deepEqual(result.providers, {
    chatGPT: "available",
    google: "available",
  });
});

test("fails clearly when the selected target is lost during the start redirect", async () => {
  await assert.rejects(
    checkOrdinaryUserRelease({
      baseUrl,
      expectMode: "read_only",
      fetchImpl: createFetch({ mode: "read_only", lostTarget: true }),
    }),
    /\/start\?target=erdos-865-k2: redirect lost target=erdos-865-k2/,
  );
});

test("requires a real target link instead of accepting catalog marketing copy", async () => {
  await assert.rejects(
    checkOrdinaryUserRelease({
      baseUrl,
      expectMode: "read_only",
      fetchImpl: createFetch({ mode: "read_only", missingCatalogTarget: true }),
    }),
    /public research catalog record link is missing/,
  );
});

test("fails when the capability mode disagrees with the operator expectation", async () => {
  await assert.rejects(
    checkOrdinaryUserRelease({
      baseUrl,
      expectMode: "read_write",
      fetchImpl: createFetch({ mode: "read_write", capabilityMode: "read_only" }),
    }),
    /reported mode="read_only"; expected read_write/,
  );
});

test("fails if demo verification implies a fresh Lean replay", async () => {
  await assert.rejects(
    checkOrdinaryUserRelease({
      baseUrl,
      expectMode: "read_only",
      fetchImpl: createFetch({ mode: "read_only", leanReplay: "executed" }),
    }),
    /fresh Lean replay is outside this request/,
  );
});

function createFetch({
  mode,
  capabilityMode = mode,
  googleAvailable = false,
  lostTarget = false,
  missingCatalogTarget = false,
  leanReplay = "not_run_by_this_request",
  requests = [],
}) {
  const writesEnabled = capabilityMode === "read_write";
  const signInPath = `/sign-in?return_to=${encodeURIComponent(returnTo)}`;
  const integrationsPath = `/integrations?target=${target}&return_to=${encodeURIComponent(returnTo)}`;
  const responses = new Map([
    ["/", html("Proofweave Advance mathematics through your Agent")],
    ["/explore", html(missingCatalogTarget
      ? "Find where your Agent can make a useful contribution"
      : `<h1>Search the frontier.</h1><a href="/explore/${target}">Open record</a>`)],
    [`/explore/${target}`, html(`${target} Pinned source Start with my Agent`)],
    ["/demo", html("Watch one Lean proof become verifiable evidence. Re-verify signed evidence")],
    [`/start?target=${target}`, redirect(lostTarget
      ? "/workbench?target=other#research-launcher"
      : `/workbench?target=${target}#research-launcher`)],
    [signInPath, html(signInHtml({ googleAvailable }))],
    [integrationsPath, html(integrationsHtml({ mode }))],
    ["/api/mcp/capabilities", json({
      controlPlaneOperations: { mode: capabilityMode, writesEnabled },
    })],
    ["/api/demo/verify", json({
      status: "verified",
      executionBoundary: {
        signedEvidenceReverified: true,
        leanReplay,
      },
    })],
  ]);

  return async (url, init = {}) => {
    const parsed = new URL(url);
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    requests.push({
      method,
      path: `${parsed.pathname}${parsed.search}`,
      authorization: headers.get("authorization"),
      cookie: headers.get("cookie"),
    });
    if (method !== "GET") {
      throw new Error(`Unexpected write-capable method: ${method}`);
    }
    return responses.get(`${parsed.pathname}${parsed.search}`)
      ?? new Response("not found", { status: 404 });
  };
}

function signInHtml({ googleAvailable }) {
  const encoded = encodeURIComponent(returnTo);
  const google = googleAvailable
    ? `<a href="/auth/google/start?return_to=${encoded}">Continue with Google</a>`
    : "<div>Continue with Google <small>Available after the deployment owner finishes Google OAuth setup</small><i>Soon</i></div>";
  return `${google}<a href="/signin-with-chatgpt?return_to=${encoded}">Continue with ChatGPT</a>`;
}

function integrationsHtml({ mode }) {
  const maintenance = mode === "read_only"
    ? "Connections are temporarily paused for maintenance. No Agent connection, research task, or evidence write can complete while maintenance is active."
    : "Approve your local Codex once.";
  return `${target} Your target remains selected during connection. <a href="/explore/${target}">Inspect source</a> ${maintenance}`;
}

function html(body) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function json(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function redirect(location) {
  return new Response(null, {
    status: 307,
    headers: { location },
  });
}
