const authorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const tokenEndpoint = "https://oauth2.googleapis.com/token";
const jwksEndpoint = "https://www.googleapis.com/oauth2/v3/certs";
const allowedIssuers = new Set(["https://accounts.google.com", "accounts.google.com"]);
const flowLifetimeSeconds = 10 * 60;

export class GoogleOidcError extends Error {
  constructor(message, code = "google_oidc_error") {
    super(message);
    this.name = "GoogleOidcError";
    this.code = code;
  }
}

export async function createGoogleAuthorization({
  clientId,
  redirectUri,
  stateSecret,
  returnTo = "/profile",
  now = Date.now(),
}) {
  requireConfig(clientId, "Google client ID");
  requireHttpsUrl(redirectUri, "Google redirect URI");
  requireStateSecret(stateSecret);

  const state = randomBase64Url(24);
  const nonce = randomBase64Url(24);
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = base64UrlEncode(
    new Uint8Array(await crypto.subtle.digest("SHA-256", text(codeVerifier))),
  );
  const payload = {
    state,
    nonce,
    codeVerifier,
    returnTo: safeRelativeReturnPath(returnTo),
    issuedAt: Math.floor(now / 1000),
  };
  const flowCookie = await signPayload(payload, stateSecret);
  const url = new URL(authorizationEndpoint);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { authorizationUrl: url.toString(), flowCookie };
}

export async function verifyGoogleAuthorizationFlow({
  flowCookie,
  returnedState,
  stateSecret,
  now = Date.now(),
}) {
  requireStateSecret(stateSecret);
  if (!flowCookie || !returnedState) {
    throw new GoogleOidcError("The Google sign-in request is missing state.", "invalid_state");
  }
  const payload = await verifySignedPayload(flowCookie, stateSecret);
  if (!payload || typeof payload !== "object") {
    throw new GoogleOidcError("The Google sign-in request state is invalid.", "invalid_state");
  }
  const issuedAt = payload.issuedAt;
  if (!Number.isInteger(issuedAt) || issuedAt > Math.floor(now / 1000) + 60 ||
      issuedAt + flowLifetimeSeconds < Math.floor(now / 1000)) {
    throw new GoogleOidcError("The Google sign-in request has expired. Please try again.", "expired_state");
  }
  if (!constantTimeEqual(payload.state, returnedState)) {
    throw new GoogleOidcError("The Google sign-in request state does not match.", "invalid_state");
  }
  if (!isBase64Url(payload.nonce, 16) || !isBase64Url(payload.codeVerifier, 32)) {
    throw new GoogleOidcError("The Google sign-in request state is malformed.", "invalid_state");
  }
  return {
    nonce: payload.nonce,
    codeVerifier: payload.codeVerifier,
    returnTo: safeRelativeReturnPath(payload.returnTo),
  };
}

export async function exchangeGoogleAuthorizationCode({
  code,
  clientId,
  clientSecret,
  redirectUri,
  codeVerifier,
  fetchImpl = fetch,
}) {
  requireConfig(code, "Google authorization code");
  requireConfig(clientId, "Google client ID");
  requireConfig(clientSecret, "Google client secret");
  requireHttpsUrl(redirectUri, "Google redirect URI");
  requireConfig(codeVerifier, "PKCE code verifier");
  const response = await fetchImpl(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body.id_token !== "string") {
    const reason = typeof body?.error_description === "string" ? body.error_description : "Google rejected the authorization code.";
    throw new GoogleOidcError(reason, "token_exchange_failed");
  }
  return { idToken: body.id_token };
}

export async function verifyGoogleIdToken({
  idToken,
  clientId,
  nonce,
  fetchImpl = fetch,
  now = Date.now(),
}) {
  const { header, payload, signature, signingInput } = parseJwt(idToken);
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) {
    throw new GoogleOidcError("Google returned an unsupported ID token.", "invalid_id_token");
  }

  const response = await fetchImpl(jwksEndpoint, { headers: { Accept: "application/json" } });
  const jwks = await response.json().catch(() => null);
  const jwk = response.ok && Array.isArray(jwks?.keys)
    ? jwks.keys.find((candidate) => candidate?.kid === header.kid && candidate?.kty === "RSA")
    : null;
  if (!jwk) throw new GoogleOidcError("Google's signing key could not be verified.", "invalid_id_token");
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const validSignature = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    signature,
    text(signingInput),
  );
  if (!validSignature) throw new GoogleOidcError("Google's ID token signature is invalid.", "invalid_id_token");

  const nowSeconds = Math.floor(now / 1000);
  if (!allowedIssuers.has(payload.iss)) {
    throw new GoogleOidcError("Google's ID token issuer is invalid.", "invalid_id_token");
  }
  const audiences = typeof payload.aud === "string" ? [payload.aud] : payload.aud;
  if (!Array.isArray(audiences) || !audiences.includes(clientId) ||
      (audiences.length > 1 && payload.azp !== clientId)) {
    throw new GoogleOidcError("Google's ID token audience is invalid.", "invalid_id_token");
  }
  if (!Number.isFinite(payload.exp) || payload.exp <= nowSeconds ||
      !Number.isFinite(payload.iat) || payload.iat > nowSeconds + 300) {
    throw new GoogleOidcError("Google's ID token is expired or not yet valid.", "invalid_id_token");
  }
  if (!constantTimeEqual(payload.nonce, nonce)) {
    throw new GoogleOidcError("Google's ID token nonce does not match.", "invalid_id_token");
  }
  if (typeof payload.sub !== "string" || !payload.sub ||
      typeof payload.email !== "string" || payload.email_verified !== true) {
    throw new GoogleOidcError("A verified Google email is required.", "unverified_email");
  }
  const name = typeof payload.name === "string" && payload.name.trim()
    ? payload.name.trim()
    : payload.email;
  return {
    subject: payload.sub,
    email: payload.email.trim().toLowerCase(),
    emailVerified: true,
    displayName: name,
  };
}

async function signPayload(payload, secret) {
  const encoded = base64UrlEncode(text(JSON.stringify(payload)));
  const key = await importHmacKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, text(encoded));
  return `${encoded}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function verifySignedPayload(value, secret) {
  const parts = value.split(".");
  if (parts.length !== 2) throw new GoogleOidcError("The Google sign-in state is malformed.", "invalid_state");
  const [encoded, encodedSignature] = parts;
  let signature;
  let payload;
  try {
    signature = base64UrlDecode(encodedSignature);
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded)));
  } catch {
    throw new GoogleOidcError("The Google sign-in state is malformed.", "invalid_state");
  }
  const key = await importHmacKey(secret, ["verify"]);
  const valid = await crypto.subtle.verify("HMAC", key, signature, text(encoded));
  if (!valid) throw new GoogleOidcError("The Google sign-in state signature is invalid.", "invalid_state");
  return payload;
}

function importHmacKey(secret, usages) {
  return crypto.subtle.importKey(
    "raw",
    text(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

function parseJwt(value) {
  const parts = typeof value === "string" ? value.split(".") : [];
  if (parts.length !== 3) throw new GoogleOidcError("Google returned a malformed ID token.", "invalid_id_token");
  try {
    return {
      header: JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0]))),
      payload: JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1]))),
      signature: base64UrlDecode(parts[2]),
      signingInput: `${parts[0]}.${parts[1]}`,
    };
  } catch {
    throw new GoogleOidcError("Google returned a malformed ID token.", "invalid_id_token");
  }
}

function safeRelativeReturnPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  let url;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local" || url.pathname.startsWith("/auth/") ||
      url.pathname === "/sign-in" || url.pathname === "/signin-with-chatgpt" ||
      url.pathname === "/signout-with-chatgpt" || url.pathname === "/callback") return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

function randomBase64Url(byteLength) {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid base64url");
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function text(value) {
  return new TextEncoder().encode(value);
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBytes = text(left);
  const rightBytes = text(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function isBase64Url(value, minimumLength) {
  return typeof value === "string" && value.length >= minimumLength && /^[A-Za-z0-9_-]+$/.test(value);
}

function requireStateSecret(value) {
  if (typeof value !== "string" || value.length < 32) {
    throw new GoogleOidcError("Google OAuth state secret must be at least 32 characters.", "configuration_error");
  }
}

function requireConfig(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new GoogleOidcError(`${label} is not configured.`, "configuration_error");
  }
}

function requireHttpsUrl(value, label) {
  requireConfig(value, label);
  const url = new URL(value);
  if (url.protocol !== "https:") throw new GoogleOidcError(`${label} must use HTTPS.`, "configuration_error");
}
