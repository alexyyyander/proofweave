import assert from "node:assert/strict";
import { test } from "node:test";
import { createSitesChatGPTSessionResolver } from "../services/proofweave-identity/sites-session.mjs";

const issuer = "https://proofweave.example.test";

test("browser authorization accepts a provider-neutral app session before ChatGPT fallback", async () => {
  const token = "opaque-google-session";
  const expectedHash = await sha256(token);
  const calls = [];
  const resolver = createSitesChatGPTSessionResolver({
    store: {
      async findAppSessionPerson(tokenHash) {
        calls.push(["app", tokenHash]);
        return tokenHash === expectedHash ? { id: "person:google", displayName: "Google Person" } : null;
      },
      async findChatGPTPerson(email) {
        calls.push(["chatgpt", email]);
        return null;
      },
    },
  });
  const session = await resolver.currentSession(new Request(`${issuer}/authorize`, {
    headers: {
      cookie: `other=value; __Host-pw_session=${encodeURIComponent(token)}`,
      "oai-authenticated-user-email": "underlying@example.test",
    },
  }));
  assert.deepEqual(session, { personId: "person:google", displayName: "Google Person" });
  assert.deepEqual(calls, [["app", expectedHash]]);
});

test("browser authorization preserves ChatGPT fallback and redirects anonymous users to the provider chooser", async () => {
  const resolver = createSitesChatGPTSessionResolver({
    store: {
      async findAppSessionPerson() { return null; },
      async findChatGPTPerson(email) {
        return email === "owner@example.test" ? { id: "person:chatgpt", displayName: "Owner" } : null;
      },
    },
  });
  assert.deepEqual(
    await resolver.currentSession(new Request(`${issuer}/authorize`, {
      headers: { "oai-authenticated-user-email": "OWNER@example.test" },
    })),
    { personId: "person:chatgpt", displayName: "Owner" },
  );
  const response = resolver.authorizationRequired(new Request(`${issuer}/authorize?client_id=codex-browser`));
  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get("location"),
    `${issuer}/sign-in?return_to=%2Fauthorize%3Fclient_id%3Dcodex-browser`,
  );
});

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
