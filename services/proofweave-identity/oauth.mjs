import { remoteMcpScopes } from "../../packages/protocol/remote-mcp-scopes.mjs";
import { delegationAllowsOAuthScopes } from "./delegation-scope-policy.mjs";

const defaultAccessLifetimeSeconds = 60 * 60;
const defaultRefreshLifetimeSeconds = 30 * 24 * 60 * 60;

/**
 * OAuth 2.1 authorization-code provider for Proofweave. Login, consent and
 * persistence are deliberately injected: this module owns protocol validation,
 * PKCE and token rotation, while a future independent identity provider owns
 * the browser session.
 */
export function createProofweaveOAuthProvider({
  resource,
  sessionResolver,
  consentResolver,
  store,
  now = () => new Date(),
  accessLifetimeSeconds = defaultAccessLifetimeSeconds,
  refreshLifetimeSeconds = defaultRefreshLifetimeSeconds,
}) {
  return {
    async authorize(request) {
      const session = await sessionResolver.currentSession(request);
      if (request.method === "POST") {
        if (!session) return sessionResolver.authorizationRequired(request, null);
        if (typeof consentResolver.complete !== "function") return methodNotAllowed("GET");
        const completed = await consentResolver.complete({ request, personId: session.personId });
        if (completed instanceof Response) return completed;
        const client = await store.findClient(completed.authorization.clientId, completed.authorization.redirectUri);
        if (!client) return oauthError("invalid_request", "Unknown OAuth client or redirect URI.", 400);
        return completeAuthorization({
          authorization: completed.authorization,
          decision: completed.decision,
          personId: session.personId,
          store,
          resource,
          now,
        });
      }
      if (request.method !== "GET") return methodNotAllowed("GET, POST");

      const parameters = Object.fromEntries(new URL(request.url).searchParams);
      const authorization = validateAuthorizationRequest(parameters, resource);
      const client = await store.findClient(authorization.clientId, authorization.redirectUri);
      if (!client) return oauthError("invalid_request", "Unknown OAuth client or redirect URI.", 400);
      if (!session) return sessionResolver.authorizationRequired(request, authorization);

      const decision = await consentResolver.resolve({
        request,
        authorization,
        client,
        personId: session.personId,
      });
      if (decision instanceof Response) return decision;
      return completeAuthorization({ authorization, decision, personId: session.personId, store, resource, now });
    },

    async token(request) {
      if (request.method !== "POST") return methodNotAllowed("POST");
      let form;
      try {
        form = await request.formData();
      } catch {
        return oauthError("invalid_request", "Token requests must use form data.", 400);
      }
      const grantType = form.get("grant_type");
      if (grantType === "authorization_code") {
        return exchangeAuthorizationCode({
          store,
          form,
          now,
          accessLifetimeSeconds,
          refreshLifetimeSeconds,
          resource,
        });
      }
      if (grantType === "refresh_token") {
        return exchangeRefreshToken({
          store,
          form,
          now,
          accessLifetimeSeconds,
          refreshLifetimeSeconds,
          resource,
        });
      }
      return oauthError("unsupported_grant_type", "Only authorization_code and refresh_token are supported.", 400);
    },

    async register(request) {
      if (request.method !== "POST") return methodNotAllowed("POST");
      let metadata;
      try {
        metadata = await request.json();
      } catch {
        return oauthError("invalid_client_metadata", "Client metadata must be JSON.", 400);
      }
      const validated = validateClientMetadata(metadata);
      const client = await store.registerClient(validated);
      return json(client, 201);
    },
  };
}

/** Build the resource-server adapter consumed by the MCP gateway. */
export function createOAuthAccessTokenAuthenticator({ store, resource, now = () => new Date() }) {
  return {
    async authenticate(request) {
      const authorization = request.headers.get("authorization");
      if (!authorization?.startsWith("Bearer ")) return null;
      const token = authorization.slice("Bearer ".length).trim();
      if (!token) return null;

      const record = await store.findAccessToken(await sha256(token), resource, now().toISOString());
      if (!record || !record.installationActive) return null;
      return {
        accessToken: token,
        clientId: record.clientId,
        personId: record.personId,
        agentInstallationId: record.agentInstallationId,
        scopes: normalizeScopes(record.scopes),
        expiresAt: record.expiresAt,
      };
    },
  };
}

async function exchangeAuthorizationCode({
  store,
  form,
  now,
  accessLifetimeSeconds,
  refreshLifetimeSeconds,
  resource,
}) {
  const code = requiredFormString(form, "code");
  const clientId = requiredFormString(form, "client_id");
  const redirectUri = requiredFormString(form, "redirect_uri");
  const verifier = requiredFormString(form, "code_verifier");
  if (!code || !clientId || !redirectUri || !verifier) {
    return oauthError("invalid_request", "code, client_id, redirect_uri and code_verifier are required.", 400);
  }
  const record = await store.consumeAuthorizationCode(await sha256(code), now().toISOString());
  if (!record || record.clientId !== clientId || record.redirectUri !== redirectUri || record.resource !== resource) {
    return oauthError("invalid_grant", "Authorization code is invalid, expired, or already used.", 400);
  }
  if ((await pkceChallenge(verifier)) !== record.codeChallenge) {
    return oauthError("invalid_grant", "PKCE verification failed.", 400);
  }
  return issueTokenPair({ store, grant: record, now, accessLifetimeSeconds, refreshLifetimeSeconds, resource });
}

async function exchangeRefreshToken({
  store,
  form,
  now,
  accessLifetimeSeconds,
  refreshLifetimeSeconds,
  resource,
}) {
  const refreshToken = requiredFormString(form, "refresh_token");
  const clientId = requiredFormString(form, "client_id");
  if (!refreshToken || !clientId) {
    return oauthError("invalid_request", "refresh_token and client_id are required.", 400);
  }
  const record = await store.consumeRefreshToken(await sha256(refreshToken), now().toISOString());
  if (!record || record.clientId !== clientId || record.resource !== resource) {
    return oauthError("invalid_grant", "Refresh token is invalid, expired, or already used.", 400);
  }
  return issueTokenPair({ store, grant: record, now, accessLifetimeSeconds, refreshLifetimeSeconds, resource });
}

async function issueTokenPair({ store, grant, now, accessLifetimeSeconds, refreshLifetimeSeconds, resource }) {
  const installation = await store.findAgentInstallation(
    grant.personId,
    grant.agentInstallationId,
    grant.clientId,
  );
  if (
    !installation ||
    (Array.isArray(installation.delegationScopes) &&
      !delegationAllowsOAuthScopes(grant.scopes, installation.delegationScopes))
  ) {
    return oauthError("invalid_grant", "The delegated Agent installation is no longer active.", 400);
  }
  const accessToken = randomToken("pw_at");
  const refreshToken = randomToken("pw_rt");
  const issuedAt = now().toISOString();
  const accessExpiresAt = expiry(now(), accessLifetimeSeconds);
  const refreshExpiresAt = expiry(now(), refreshLifetimeSeconds);
  await store.issueTokenPair({
    accessTokenHash: await sha256(accessToken),
    refreshTokenHash: await sha256(refreshToken),
    clientId: grant.clientId,
    resource,
    personId: grant.personId,
    agentInstallationId: grant.agentInstallationId,
    scopes: normalizeScopes(grant.scopes),
    issuedAt,
    accessExpiresAt,
    refreshExpiresAt,
  });
  return json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: accessLifetimeSeconds,
    refresh_token: refreshToken,
    scope: normalizeScopes(grant.scopes).join(" "),
  });
}

function validateAuthorizationRequest(parameters, resource) {
  if (parameters.response_type !== "code") {
    throw new OAuthProtocolError("unsupported_response_type", "Only response_type=code is supported.");
  }
  const clientId = requiredString(parameters.client_id);
  const redirectUri = validRedirectUri(parameters.redirect_uri);
  const codeChallenge = requiredString(parameters.code_challenge);
  if (!clientId || !redirectUri || !codeChallenge || parameters.code_challenge_method !== "S256") {
    throw new OAuthProtocolError("invalid_request", "client_id, redirect_uri, and an S256 PKCE challenge are required.");
  }
  if (parameters.resource && parameters.resource !== resource) {
    throw new OAuthProtocolError("invalid_target", "The OAuth resource does not match Proofweave MCP.");
  }
  return {
    clientId,
    redirectUri,
    resource,
    codeChallenge,
    scopes: normalizeScopes(parameters.scope ?? ""),
    state: typeof parameters.state === "string" ? parameters.state : null,
  };
}

function validateClientMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new OAuthProtocolError("invalid_client_metadata", "Client metadata must be an object.");
  }
  const redirectUris = metadata.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    throw new OAuthProtocolError("invalid_client_metadata", "redirect_uris is required.");
  }
  return {
    clientName: typeof metadata.client_name === "string" ? metadata.client_name.slice(0, 160) : "Proofweave MCP client",
    redirectUris: redirectUris.map(validRedirectUri),
    tokenEndpointAuthMethod: "none",
  };
}

function normalizeScopes(value) {
  const scopes = Array.isArray(value) ? value : String(value).split(" ");
  const normalized = [...new Set(scopes.filter(Boolean))].sort();
  if (!normalized.every((scope) => remoteMcpScopes.includes(scope))) {
    throw new OAuthProtocolError("invalid_scope", "Requested OAuth scope is not supported.");
  }
  return normalized;
}

async function completeAuthorization({ authorization, decision, personId, store, resource, now }) {
  if (!decision || typeof decision !== "object" || typeof decision.approved !== "boolean") {
    return oauthError("invalid_request", "Consent decision is invalid.", 400);
  }
  if (!decision.approved) {
    return redirectError(authorization.redirectUri, "access_denied", authorization.state);
  }
  const scopes = normalizeScopes(decision.grantedScopes ?? authorization.scopes);
  if (!scopes.every((scope) => authorization.scopes.includes(scope))) {
    return oauthError("invalid_request", "Consent cannot grant unrequested scopes.", 400);
  }
  const installation = await store.findAgentInstallation(
    personId,
    decision.agentInstallationId,
    authorization.clientId,
  );
  if (
    !installation ||
    (Array.isArray(installation.delegationScopes) &&
      !delegationAllowsOAuthScopes(scopes, installation.delegationScopes))
  ) {
    return oauthError("access_denied", "The selected Agent installation is unavailable.", 403);
  }

  const code = randomToken("pw_code");
  await store.issueAuthorizationCode({
    codeHash: await sha256(code),
    clientId: authorization.clientId,
    redirectUri: authorization.redirectUri,
    resource,
    personId,
    agentInstallationId: installation.id,
    scopes,
    codeChallenge: authorization.codeChallenge,
    issuedAt: now().toISOString(),
    expiresAt: expiry(now(), 5 * 60),
  });
  return redirectSuccess(authorization.redirectUri, code, authorization.state);
}

function validRedirectUri(value) {
  const uri = requiredString(value);
  if (!uri) throw new OAuthProtocolError("invalid_request", "A redirect_uri is required.");
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new OAuthProtocolError("invalid_request", "redirect_uri is invalid.");
  }
  const loopback = parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !loopback) {
    throw new OAuthProtocolError("invalid_request", "redirect_uri must use HTTPS or localhost HTTP.");
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new OAuthProtocolError("invalid_request", "redirect_uri must not contain credentials or a fragment.");
  }
  return parsed.toString();
}

function redirectSuccess(redirectUri, code, state) {
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  return Response.redirect(url, 302);
}

function redirectError(redirectUri, error, state) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (state) url.searchParams.set("state", state);
  return Response.redirect(url, 302);
}

function oauthError(error, errorDescription, status) {
  return json({ error, error_description: errorDescription }, status);
}

function methodNotAllowed(method) {
  return new Response(null, { status: 405, headers: { Allow: method } });
}

function json(value, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function requiredFormString(form, key) {
  const value = form.get(key);
  return typeof value === "string" ? requiredString(value) : null;
}

function requiredString(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 2_048
    ? value
    : null;
}

async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken(prefix) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${prefix}_${base64Url(bytes)}`;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function expiry(now, seconds) {
  return new Date(now.getTime() + seconds * 1_000).toISOString();
}

export class OAuthProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "OAuthProtocolError";
  }
}
