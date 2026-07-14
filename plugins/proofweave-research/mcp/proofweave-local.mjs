#!/usr/bin/env node
/**
 * A dependency-free, local STDIO MCP bridge for the closed Proofweave beta.
 *
 * It creates an Ed25519 Agent key on this computer, completes OAuth 2.1 PKCE
 * through the user's browser, and stores the resulting refresh token in a
 * mode-0600 local file. It never reads a Codex workspace or copies a ChatGPT
 * session, API key, or Proofweave token into a prompt.
 */
import { createServer } from "node:http";
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";

const baseUrl = normalizeBaseUrl(process.env.PROOFWEAVE_BASE_URL ?? "https://proofweave-research.yualex031821.chatgpt.site");
const callbackHost = "127.0.0.1";
const callbackPort = 44765;
const callbackPath = "/callback";
const redirectUri = `http://${callbackHost}:${callbackPort}${callbackPath}`;
const configPath = process.env.PROOFWEAVE_CONNECTOR_CONFIG ?? join(homedir(), ".proofweave", "codex-connector.json");
const toolDefinitions = [
  tool("connect_proofweave", "Connect this local Codex to Proofweave with a one-time browser approval. It generates an Agent key on this computer; no key needs to be pasted.", { type: "object", additionalProperties: false, properties: {} }),
  tool("connection_status", "Show whether this local Connector has a revocable Proofweave connection. It does not contact Proofweave.", { type: "object", additionalProperties: false, properties: {} }),
  tool("list_frontier_problems", "List Proofweave frontier problems available to this connected Agent.", { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100 } } }),
  tool("inspect_problem", "Read a source-pinned Proofweave frontier problem before starting local work.", { type: "object", additionalProperties: false, properties: { slug: { type: "string", minLength: 1, maxLength: 160 } }, required: ["slug"] }),
  tool("create_attempt", "Create a bounded Proofweave Attempt for the connected Agent. Use an idempotency key so retried work does not create duplicate attempts.", { type: "object", additionalProperties: false, properties: { problemSlug: { type: "string", minLength: 1, maxLength: 160 }, delegationScope: { type: "string", enum: ["formalize", "prove"] }, idempotencyKey: { type: "string", minLength: 1, maxLength: 160 } }, required: ["problemSlug", "delegationScope", "idempotencyKey"] }),
  tool("report_progress", "Record a concise provisional progress update for one of this Agent's Attempts. This is not Lean verification or a contribution receipt.", { type: "object", additionalProperties: false, properties: { attemptId: { type: "string", minLength: 1, maxLength: 240 }, message: { type: "string", minLength: 1, maxLength: 4000 }, progressPercent: { type: "integer", minimum: 0, maximum: 100 }, idempotencyKey: { type: "string", minLength: 1, maxLength: 160 } }, required: ["attemptId", "message", "progressPercent", "idempotencyKey"] }),
  tool("list_attempts", "List bounded Attempts attributed to this exact local Agent.", { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100 } } }),
  tool("get_attempt", "Read one Attempt attributed to this exact local Agent.", { type: "object", additionalProperties: false, properties: { attemptId: { type: "string", minLength: 1, maxLength: 240 } }, required: ["attemptId"] }),
];

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => { void handleLine(line); });

async function handleLine(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    respond({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") return;
  if (request.method.startsWith("notifications/")) return;
  try {
    const result = await handleRequest(request.method, request.params ?? {});
    respond({ jsonrpc: "2.0", id: request.id ?? null, result });
  } catch (error) {
    respond({ jsonrpc: "2.0", id: request.id ?? null, error: { code: -32000, message: messageFor(error) } });
  }
}

async function handleRequest(method, params) {
  if (method === "initialize") {
    return {
      protocolVersion: params.protocolVersion ?? "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "proofweave-local", version: "0.2.0" },
      instructions: "Use connect_proofweave before requesting Proofweave data. Local work remains on this computer unless a selected tool records a bounded event.",
    };
  }
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: toolDefinitions };
  if (method !== "tools/call") throw new Error(`Unsupported MCP method: ${method}`);
  const name = typeof params.name === "string" ? params.name : "";
  const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments : {};
  if (name === "connect_proofweave") return connectionResult(await connect());
  if (name === "connection_status") return connectionResult(await connectionStatus());
  if (!toolDefinitions.some((item) => item.name === name)) return toolError(`Unknown Proofweave tool: ${name}`);
  const result = await callRemoteTool(name, args);
  return result;
}

async function connect() {
  const existing = await readConfig();
  if (existing?.refreshToken && existing.baseUrl === baseUrl) {
    return { connected: true, message: `Already connected as ${existing.agentLabel}. Revoke this connection in Proofweave Settings before reconnecting.` };
  }
  const identity = existing?.privateKeyJwk && existing?.agentId && existing?.agentPublicKey
    ? existing
    : createLocalIdentity();
  const state = randomToken(24);
  const verifier = randomToken(48);
  const codeChallenge = base64url(createHash("sha256").update(verifier).digest());
  const session = await startPairing({
    agentId: identity.agentId,
    agentLabel: identity.agentLabel,
    agentPublicKey: identity.agentPublicKey,
    oauthState: state,
    codeChallenge,
  });
  const tokens = await waitForCallback({ connectionUrl: session.connectionUrl, state, verifier, clientId: session.clientId });
  const next = {
    version: 1,
    baseUrl,
    agentId: identity.agentId,
    agentLabel: identity.agentLabel,
    agentPublicKey: identity.agentPublicKey,
    privateKeyJwk: identity.privateKeyJwk,
    clientId: session.clientId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in) * 1_000).toISOString(),
  };
  await writeConfig(next);
  return { connected: true, message: `Connected as ${next.agentLabel}. You can revoke this installation in Proofweave Settings.` };
}

async function connectionStatus() {
  const config = await readConfig();
  if (!config?.refreshToken) return { connected: false, message: "Not connected. Use connect_proofweave to approve this local Codex." };
  return {
    connected: true,
    agentId: config.agentId,
    agentLabel: config.agentLabel,
    baseUrl: config.baseUrl,
    message: "Connected locally. The refresh token and Agent private key are stored only on this computer.",
  };
}

async function startPairing(payload) {
  const response = await fetch(`${baseUrl}/api/connect/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.connectionUrl || !result?.clientId) {
    throw new Error(result?.error?.message ?? "Proofweave could not start the local connection.");
  }
  return result;
}

async function waitForCallback({ connectionUrl, state, verifier, clientId }) {
  const server = createServer();
  const callback = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close();
      handler(value);
    };
    const timeout = setTimeout(() => finish(reject, new Error("Browser approval timed out after 10 minutes. Run connect_proofweave again.")), 10 * 60 * 1_000);
    server.once("error", (error) => finish(reject, error.code === "EADDRINUSE"
      ? new Error(`Local callback port ${callbackPort} is already in use. Close the other Proofweave Connector and try again.`)
      : error));
    server.on("request", (request, response) => {
      void (async () => {
        try {
          const url = new URL(request.url ?? "/", redirectUri);
          if (url.pathname !== callbackPath) {
            response.writeHead(404).end("Not found");
            return;
          }
          const error = url.searchParams.get("error");
          const code = url.searchParams.get("code");
          const returnedState = url.searchParams.get("state");
          if (error || !code || returnedState !== state) {
            response.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end("<h1>Proofweave connection was not approved.</h1><p>You can close this tab and return to Codex.</p>");
            finish(reject, new Error(error ? `Proofweave authorization failed: ${error}` : "The browser approval did not match this local connection."));
            return;
          }
          const tokens = await exchangeCode({ code, verifier, clientId });
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<h1>Proofweave is connected.</h1><p>You can close this tab and return to Codex.</p>");
          finish(resolve, tokens);
        } catch (cause) {
          response.writeHead(500, { "content-type": "text/html; charset=utf-8" }).end("<h1>Proofweave connection could not finish.</h1><p>Return to Codex and try again.</p>");
          finish(reject, cause);
        }
      })();
    });
  });
  await new Promise((resolve, reject) => server.listen(callbackPort, callbackHost, (error) => error ? reject(error) : resolve()));
  const opened = openBrowser(connectionUrl);
  if (!opened) process.stderr.write(`Open this Proofweave approval link in your browser: ${connectionUrl}\n`);
  return callback;
}

async function exchangeCode({ code, verifier, clientId }) {
  return postForm(`${baseUrl}/token`, {
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
}

async function callRemoteTool(name, args) {
  let config = await requireConfig();
  config = await refreshIfNeeded(config);
  let response = await postMcp(config.accessToken, name, args);
  if (response.status === 401) {
    config = await refreshAccessToken(config);
    response = await postMcp(config.accessToken, name, args);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? payload?.error_description ?? `Proofweave MCP returned ${response.status}.`);
  }
  if (payload?.error) throw new Error(payload.error.message ?? "Proofweave MCP rejected this request.");
  if (!payload?.result) throw new Error("Proofweave MCP returned an invalid response.");
  return payload.result;
}

async function postMcp(accessToken, name, args) {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json, text/event-stream",
      "authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } }),
  });
}

async function refreshIfNeeded(config) {
  const expires = Date.parse(config.accessTokenExpiresAt ?? "");
  if (config.accessToken && Number.isFinite(expires) && expires > Date.now() + 60_000) return config;
  return refreshAccessToken(config);
}

async function refreshAccessToken(config) {
  const tokens = await postForm(`${baseUrl}/token`, {
    grant_type: "refresh_token",
    refresh_token: config.refreshToken,
    client_id: config.clientId,
  });
  const next = {
    ...config,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in) * 1_000).toISOString(),
  };
  await writeConfig(next);
  return next;
}

async function postForm(url, data) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "accept": "application/json" },
    body: new URLSearchParams(data),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.access_token || !result?.refresh_token) {
    throw new Error(result?.error_description ?? "Proofweave could not exchange the browser approval.");
  }
  return result;
}

function createLocalIdentity() {
  const pair = generateKeyPairSync("ed25519");
  const publicKeyJwk = pair.publicKey.export({ format: "jwk" });
  const privateKeyJwk = pair.privateKey.export({ format: "jwk" });
  if (!publicKeyJwk.x || publicKeyJwk.kty !== "OKP" || publicKeyJwk.crv !== "Ed25519") {
    throw new Error("Node could not generate an Ed25519 Agent key.");
  }
  return {
    agentId: `urn:pw:agent:codex-${randomUUID()}`,
    agentLabel: "Codex on this computer",
    agentPublicKey: publicKeyJwk.x,
    privateKeyJwk,
  };
}

async function requireConfig() {
  const config = await readConfig();
  if (!config?.refreshToken || !config?.clientId || !config?.agentId) {
    throw new Error("This local Codex is not connected. Use connect_proofweave first.");
  }
  if (config.baseUrl !== baseUrl) throw new Error("This local connection belongs to a different Proofweave site. Reconnect before continuing.");
  return config;
}

async function readConfig() {
  try {
    const raw = await readFile(configPath, "utf8");
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error("The local Proofweave Connector configuration could not be read.");
  }
}

async function writeConfig(value) {
  const folder = dirname(configPath);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  try { await chmod(folder, 0o700); } catch { /* Windows does not expose POSIX modes. */ }
  const temporary = `${configPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  try { await chmod(temporary, 0o600); } catch { /* Windows does not expose POSIX modes. */ }
  await rename(temporary, configPath);
}

function openBrowser(url) {
  const target = platform() === "darwin" ? ["open", [url]] : platform() === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    const child = spawn(target[0], target[1], { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function normalizeBaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("PROOFWEAVE_BASE_URL must be an absolute URL."); }
  if (!/^https:$/.test(url.protocol) && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("PROOFWEAVE_BASE_URL must use HTTPS outside local development.");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function randomToken(bytes) { return base64url(randomBytes(bytes)); }
function base64url(value) { return Buffer.from(value).toString("base64url"); }
function tool(name, description, inputSchema) { return { name, description, inputSchema }; }
function connectionResult(value) { return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] }; }
function toolError(message) { return { content: [{ type: "text", text: message }], isError: true }; }
function respond(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function messageFor(error) { return error instanceof Error ? error.message : "Proofweave local Connector failed."; }
