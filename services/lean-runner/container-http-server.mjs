import { createServer } from "node:http";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ContainerLeanExecutor } from "./container-lean-executor.mjs";
import { createContainerWorkspaceHttpHandler } from "./container-workspace-runtime.mjs";

const defaultPort = 8080;
const maximumRequestMilliseconds = 1_260_000;
const headerTimeoutMilliseconds = 30_000;

/**
 * The Node process that belongs inside the no-egress Lean Container image.
 * This module intentionally has no D1, R2, Queue, browser, signing-key, or
 * public HTTP dependency. Cloudflare's Container binding is its only caller.
 */
export function createLeanRunnerContainerProcess({ environment = process.env } = {}) {
  const options = readRuntimeOptions(environment);
  const executor = new ContainerLeanExecutor({
    networkIsolated: options.networkIsolated,
    resourceLimitsEnforced: options.resourceLimitsEnforced,
    executablePath: options.leanExecutablePath,
  });
  const handler = createContainerWorkspaceHttpHandler({
    stagingRoot: options.stagingRoot,
    workspaceRoot: options.workspaceRoot,
    executor,
  });
  return createPrivateContainerHttpServer({ handler, requestTimeoutMilliseconds: options.requestTimeoutMilliseconds });
}

/**
 * Adapt the Fetch-native private ingress to the actual Node HTTP listener in
 * the Container image. It deliberately serves only an unauthenticated local
 * readiness probe in addition to the handler's private `/v1/runs/...` API.
 */
export function createPrivateContainerHttpServer({ handler, requestTimeoutMilliseconds = maximumRequestMilliseconds }) {
  if (typeof handler !== "function") {
    throw new TypeError("Private Container HTTP server requires a Fetch request handler.");
  }
  if (!Number.isInteger(requestTimeoutMilliseconds) || requestTimeoutMilliseconds < 1_000 || requestTimeoutMilliseconds > maximumRequestMilliseconds) {
    throw new TypeError("Private Container HTTP server request timeout is outside the allowed range.");
  }

  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/ready") {
        response.writeHead(204);
        response.end();
        return;
      }
      const fetchRequest = nodeRequestToFetch(request);
      const fetchResponse = await handler(fetchRequest);
      await writeFetchResponse(response, fetchResponse);
    } catch {
      if (response.headersSent) {
        // Never append an error document to a partially streamed evidence
        // object: the Worker must observe a transport failure and retry.
        response.destroy();
        return;
      }
      response.writeHead(502, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "container_request_failed" }));
    }
  });
  server.headersTimeout = headerTimeoutMilliseconds;
  server.requestTimeout = requestTimeoutMilliseconds;
  server.keepAliveTimeout = 5_000;
  server.on("clientError", (_error, socket) => socket.destroy());

  return Object.freeze({
    server,
    handler,
    async listen({ host = "0.0.0.0", port = defaultPort } = {}) {
      assertHost(host);
      assertPort(port, { allowEphemeral: true });
      await new Promise((resolveListen, rejectListen) => {
        const onError = (error) => {
          server.off("listening", onListening);
          rejectListen(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolveListen();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen({ host, port });
      });
      return server.address();
    },
    async close() {
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      }).catch((error) => {
        if (error?.code !== "ERR_SERVER_NOT_RUNNING") throw error;
      });
      if (typeof handler.cleanup === "function") await handler.cleanup();
    },
  });
}

function readRuntimeOptions(environment) {
  if (environment.PROOFWEAVE_NETWORK_ISOLATED !== "true") {
    throw new Error("Lean Runner Container refuses to start without a deployment assertion of disabled network access.");
  }
  if (environment.PROOFWEAVE_RESOURCE_LIMITS_ENFORCED !== "true") {
    throw new Error("Lean Runner Container refuses to start without deployment-enforced CPU, memory, disk, and process limits.");
  }
  const port = environment.PORT === undefined ? defaultPort : parsePort(environment.PORT, "PORT");
  const requestTimeoutMilliseconds = environment.PROOFWEAVE_REQUEST_TIMEOUT_MS === undefined
    ? maximumRequestMilliseconds
    : parseTimeout(environment.PROOFWEAVE_REQUEST_TIMEOUT_MS);
  return Object.freeze({
    networkIsolated: true,
    resourceLimitsEnforced: true,
    port,
    requestTimeoutMilliseconds,
    leanExecutablePath: environment.PROOFWEAVE_LEAN_EXECUTABLE_PATH === undefined
      ? "lake"
      : absolutePath(environment.PROOFWEAVE_LEAN_EXECUTABLE_PATH, "PROOFWEAVE_LEAN_EXECUTABLE_PATH"),
    stagingRoot: absolutePath(environment.PROOFWEAVE_STAGING_ROOT ?? "/tmp/proofweave/staging", "PROOFWEAVE_STAGING_ROOT"),
    workspaceRoot: absolutePath(environment.PROOFWEAVE_WORKSPACE_ROOT ?? "/tmp/proofweave/workspaces", "PROOFWEAVE_WORKSPACE_ROOT"),
  });
}

function nodeRequestToFetch(request) {
  const controller = new AbortController();
  request.once("aborted", () => controller.abort());
  const hasBody = !["GET", "HEAD"].includes(request.method ?? "GET");
  const body = hasBody ? Readable.toWeb(request) : undefined;
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else if (typeof value === "string") {
      headers.set(name, value);
    }
  }
  return new Request(`http://proofweave-runner.local${request.url ?? "/"}`, {
    method: request.method,
    headers,
    body,
    duplex: hasBody ? "half" : undefined,
    signal: controller.signal,
  });
}

async function writeFetchResponse(response, fetchResponse) {
  if (!(fetchResponse instanceof Response)) {
    throw new TypeError("Private Container handler did not return a Fetch Response.");
  }
  const headers = {};
  fetchResponse.headers.forEach((value, name) => { headers[name] = value; });
  response.writeHead(fetchResponse.status, headers);
  if (!fetchResponse.body) {
    response.end();
    return;
  }
  await new Promise((resolvePipe, rejectPipe) => {
    const stream = Readable.fromWeb(fetchResponse.body);
    stream.once("error", rejectPipe);
    response.once("error", rejectPipe);
    response.once("finish", resolvePipe);
    stream.pipe(response);
  });
}

function assertHost(host) {
  if (typeof host !== "string" || !/^(?:0\.0\.0\.0|127\.0\.0\.1|::)$/.test(host)) {
    throw new TypeError("Private Container HTTP server host is invalid.");
  }
}

function assertPort(port, { allowEphemeral = false } = {}) {
  if (!Number.isInteger(port) || port < (allowEphemeral ? 0 : 1) || port > 65_535) {
    throw new TypeError("Private Container HTTP server port is invalid.");
  }
}

function parsePort(value, label) {
  if (!/^\d+$/.test(String(value))) throw new Error(`${label} must be an integer port.`);
  const port = Number(value);
  assertPort(port);
  return port;
}

function parseTimeout(value) {
  if (!/^\d+$/.test(String(value))) throw new Error("PROOFWEAVE_REQUEST_TIMEOUT_MS must be an integer.");
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > maximumRequestMilliseconds) {
    throw new Error("PROOFWEAVE_REQUEST_TIMEOUT_MS is outside the allowed range.");
  }
  return timeout;
}

function absolutePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || !value.startsWith("/") || resolve(value) !== value) {
    throw new Error(`${label} must be a normalized absolute path.`);
  }
  return value;
}

async function main() {
  process.umask(0o077);
  const processServer = createLeanRunnerContainerProcess();
  const options = readRuntimeOptions(process.env);
  await processServer.listen({ port: options.port });
  const shutdown = async () => {
    await processServer.close();
    process.exitCode = 0;
  };
  process.once("SIGTERM", () => { void shutdown(); });
  process.once("SIGINT", () => { void shutdown(); });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("Proofweave Lean Runner Container failed to start.");
    console.error(error instanceof Error ? error.message : "Unknown startup error.");
    process.exitCode = 1;
  });
}
