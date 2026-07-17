import assert from "node:assert/strict";
import { before, test } from "node:test";
import {
  createGoogleAuthorization,
  exchangeGoogleAuthorizationCode,
  GoogleOidcError,
  verifyGoogleAuthorizationFlow,
  verifyGoogleIdToken,
} from "../packages/auth/google-oidc.mjs";

const clientId = "proofweave-client.apps.googleusercontent.com";
const redirectUri = "https://proofweave.example.test/auth/google/callback";
const stateSecret = "test-only-state-secret-that-is-longer-than-thirty-two-characters";
const now = Date.parse("2026-07-16T04:00:00Z");
let privateKey;
let publicJwk;

before(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  privateKey = pair.privateKey;
  publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "google-test-key", alg: "RS256", use: "sig" };
});

test("Google authorization uses OIDC, state, nonce, and PKCE and restores only a safe return path", async () => {
  const authorization = await createGoogleAuthorization({
    clientId,
    redirectUri,
    stateSecret,
    returnTo: "/workbench?target=erdos-865-k2#research-launcher",
    now,
  });
  const url = new URL(authorization.authorizationUrl);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(url.searchParams.get("nonce"));
  assert.ok(url.searchParams.get("state"));
  const flow = await verifyGoogleAuthorizationFlow({
    flowCookie: authorization.flowCookie,
    returnedState: url.searchParams.get("state"),
    stateSecret,
    now: now + 30_000,
  });
  assert.equal(flow.returnTo, "/workbench?target=erdos-865-k2#research-launcher");
  assert.match(flow.codeVerifier, /^[A-Za-z0-9_-]+$/);

  await assert.rejects(
    verifyGoogleAuthorizationFlow({
      flowCookie: authorization.flowCookie,
      returnedState: "attacker-state",
      stateSecret,
      now,
    }),
    (error) => error instanceof GoogleOidcError && error.code === "invalid_state",
  );
});

test("Google authorization state expires and rejects unsafe return URLs", async () => {
  const authorization = await createGoogleAuthorization({
    clientId,
    redirectUri,
    stateSecret,
    returnTo: "https://attacker.example/steal",
    now,
  });
  const state = new URL(authorization.authorizationUrl).searchParams.get("state");
  await assert.rejects(
    verifyGoogleAuthorizationFlow({ flowCookie: authorization.flowCookie, returnedState: state, stateSecret, now: now + 11 * 60_000 }),
    (error) => error instanceof GoogleOidcError && error.code === "expired_state",
  );
  const valid = await verifyGoogleAuthorizationFlow({ flowCookie: authorization.flowCookie, returnedState: state, stateSecret, now });
  assert.equal(valid.returnTo, "/");
});

test("authorization code exchange sends PKCE to Google's backend token endpoint", async () => {
  let request;
  const result = await exchangeGoogleAuthorizationCode({
    code: "one-time-code",
    clientId,
    clientSecret: "client-secret",
    redirectUri,
    codeVerifier: "pkce-verifier",
    async fetchImpl(url, init) {
      request = { url, init };
      return Response.json({ id_token: "header.payload.signature", access_token: "not-persisted" });
    },
  });
  assert.equal(result.idToken, "header.payload.signature");
  assert.equal(request.url, "https://oauth2.googleapis.com/token");
  assert.equal(request.init.method, "POST");
  const body = new URLSearchParams(request.init.body);
  assert.equal(body.get("code_verifier"), "pkce-verifier");
  assert.equal(body.get("grant_type"), "authorization_code");
});

test("Google ID token verification checks signature, issuer, audience, nonce, expiry, and verified email", async () => {
  const nonce = "nonce-with-enough-entropy";
  const idToken = await signedIdToken({
    iss: "https://accounts.google.com",
    aud: clientId,
    sub: "google-subject-123",
    email: "Alice@Example.test",
    email_verified: true,
    name: "Alice Researcher",
    nonce,
    iat: Math.floor(now / 1000) - 10,
    exp: Math.floor(now / 1000) + 300,
  });
  const identity = await verifyGoogleIdToken({
    idToken,
    clientId,
    nonce,
    now,
    fetchImpl: googleKeysFetch,
  });
  assert.deepEqual(identity, {
    subject: "google-subject-123",
    email: "alice@example.test",
    emailVerified: true,
    displayName: "Alice Researcher",
  });

  await assert.rejects(
    verifyGoogleIdToken({ idToken, clientId, nonce: "wrong-nonce", now, fetchImpl: googleKeysFetch }),
    (error) => error instanceof GoogleOidcError && error.code === "invalid_id_token",
  );
});

test("Google ID token verification refuses an unverified email", async () => {
  const nonce = "nonce-with-enough-entropy";
  const idToken = await signedIdToken({
    iss: "https://accounts.google.com",
    aud: clientId,
    sub: "google-subject-456",
    email: "unverified@example.test",
    email_verified: false,
    nonce,
    iat: Math.floor(now / 1000) - 10,
    exp: Math.floor(now / 1000) + 300,
  });
  await assert.rejects(
    verifyGoogleIdToken({ idToken, clientId, nonce, now, fetchImpl: googleKeysFetch }),
    (error) => error instanceof GoogleOidcError && error.code === "unverified_email",
  );
});

async function signedIdToken(payload) {
  const header = { alg: "RS256", typ: "JWT", kid: "google-test-key" };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

async function googleKeysFetch(url) {
  assert.equal(url, "https://www.googleapis.com/oauth2/v3/certs");
  return Response.json({ keys: [publicJwk] });
}

function base64Url(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Buffer.from(bytes).toString("base64url");
}
