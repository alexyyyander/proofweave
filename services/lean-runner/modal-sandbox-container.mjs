import { ModalClient, Probe } from "modal";
import { assertPinnedRunnerImage } from "./cloudflare-container-policy.mjs";

const defaultPort = 8080;
const internalOrigin = "https://proofweave-runner.internal";
const runPath = /^\/v1\/runs\/([^/]+)\/workspace(?:\/artifacts\/(?:source-archive|source-patch|lake-manifest)|\/(?:finalize|execute|cancel|complete)|\/result\/(?:stdout|stderr))?$/;

export class ModalSandboxContainerError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ModalSandboxContainerError";
  }
}

/**
 * Provider adapter for the existing private Container fetch contract.
 *
 * A fresh Modal Sandbox is bound to exactly one Run. The Sandbox receives no
 * database, queue, OAuth, or signing credentials. The trusted runner process
 * keeps the short-lived Modal Connect Token and uses it only to forward the
 * existing private workspace protocol over authenticated HTTPS.
 */
export class ModalSandboxContainerFactory {
  constructor({
    client,
    appName,
    imageReference,
    resources,
    resourcePolicyReviewed,
    port = defaultPort,
    fetcher = globalThis.fetch,
  } = {}) {
    if (!client?.apps || !client?.images || !client?.sandboxes) {
      throw new ModalSandboxContainerError("Modal runner requires an initialized Modal client.");
    }
    this.appName = requireIdentifier(appName, "Modal app name", 120);
    this.imageReference = assertPinnedRunnerImage(imageReference);
    this.resources = normalizeResources(resources);
    if (resourcePolicyReviewed !== true) {
      throw new ModalSandboxContainerError("Modal runner stays disabled until its external CPU, memory, disk, process, and timeout policy is reviewed.");
    }
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new ModalSandboxContainerError("Modal runner port is invalid.");
    }
    if (typeof fetcher !== "function") {
      throw new ModalSandboxContainerError("Modal runner requires an HTTPS fetch implementation.");
    }
    this.client = client;
    this.port = port;
    this.fetcher = fetcher;
    this.active = new Map();
  }

  async get(runId) {
    const normalizedRunId = requireIdentifier(runId, "Run id", 240);
    const existing = this.active.get(normalizedRunId);
    if (existing) return existing;
    if (this.active.size >= 1) {
      throw new ModalSandboxContainerError("Closed-alpha Modal runner permits only one active Sandbox.");
    }
    const creating = this.create(normalizedRunId).catch((error) => {
      this.active.delete(normalizedRunId);
      if (error instanceof ModalSandboxContainerError) throw error;
      throw new ModalSandboxContainerError("Modal could not create the isolated Lean Sandbox.", { cause: error });
    });
    this.active.set(normalizedRunId, creating);
    return creating;
  }

  async terminate(runId) {
    const normalizedRunId = requireIdentifier(runId, "Run id", 240);
    const pending = this.active.get(normalizedRunId);
    if (!pending) return false;
    const container = await pending;
    await container.terminate();
    return true;
  }

  async close() {
    const containers = await Promise.allSettled([...this.active.values()]);
    await Promise.allSettled(containers
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value.terminate()));
  }

  async create(runId) {
    const app = await this.client.apps.fromName(this.appName, { createIfMissing: false });
    const image = this.client.images.fromRegistry(this.imageReference);
    const sandbox = await this.client.sandboxes.create(app, image, {
      command: ["node", "/opt/proofweave/services/lean-runner/container-http-server.mjs"],
      env: {
        PROOFWEAVE_NETWORK_ISOLATED: "true",
        PROOFWEAVE_RESOURCE_LIMITS_ENFORCED: "true",
        PROOFWEAVE_REQUEST_TIMEOUT_MS: String(this.resources.timeoutMs),
      },
      blockNetwork: true,
      cpu: this.resources.cpu,
      cpuLimit: this.resources.cpuLimit,
      memoryMiB: this.resources.memoryMiB,
      memoryLimitMiB: this.resources.memoryLimitMiB,
      timeoutMs: this.resources.timeoutMs + 60_000,
      idleTimeoutMs: this.resources.idleTimeoutMs,
      readinessProbe: Probe.withTcp(this.port),
      tags: { component: "proofweave-lean-runner", protocol: "pw-lean-runner-v1" },
    });
    try {
      await sandbox.waitUntilReady(Math.min(this.resources.timeoutMs, 60_000));
      const credential = await sandbox.createConnectToken({
        port: this.port,
        userMetadata: JSON.stringify({ protocolVersion: "pw-modal-connect-v1", runId }),
      });
      const container = new ModalSandboxContainer({
        sandbox,
        credential,
        runId,
        fetcher: this.fetcher,
        onTerminated: () => this.active.delete(runId),
      });
      this.active.set(runId, Promise.resolve(container));
      return container;
    } catch (error) {
      await sandbox.terminate().catch(() => {});
      throw error;
    }
  }
}

export class ModalSandboxContainer {
  constructor({ sandbox, credential, runId, fetcher, onTerminated }) {
    if (!sandbox || typeof sandbox.terminate !== "function") {
      throw new ModalSandboxContainerError("Modal Sandbox handle is invalid.");
    }
    this.runId = requireIdentifier(runId, "Run id", 240);
    this.baseUrl = requireConnectUrl(credential?.url);
    this.token = requireConnectToken(credential?.token);
    this.sandbox = sandbox;
    this.fetcher = fetcher;
    this.onTerminated = onTerminated;
    this.terminated = false;
  }

  async fetch(request) {
    if (this.terminated) throw new ModalSandboxContainerError("Modal Sandbox is already terminated.");
    if (!(request instanceof Request)) throw new ModalSandboxContainerError("Modal Sandbox fetch requires a Request.");
    const source = new URL(request.url);
    if (source.origin !== internalOrigin) {
      throw new ModalSandboxContainerError("Modal Sandbox accepts only the private Runner origin.");
    }
    const runId = runIdFromPath(source.pathname);
    if (runId !== this.runId) {
      throw new ModalSandboxContainerError("Modal Sandbox request does not belong to its bound Run.");
    }
    const target = new URL(this.baseUrl);
    target.pathname = source.pathname;
    target.search = source.search;
    const headers = forwardedHeaders(request.headers);
    headers.set("authorization", `Bearer ${this.token}`);
    let response;
    try {
      response = await this.fetcher(target, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        duplex: ["GET", "HEAD"].includes(request.method) ? undefined : "half",
        redirect: "error",
        signal: request.signal,
      });
    } catch (cause) {
      throw new ModalSandboxContainerError("Authenticated Modal Sandbox request failed.", { cause });
    }
    if (!(response instanceof Response)) {
      throw new ModalSandboxContainerError("Modal Sandbox returned an invalid HTTP response.");
    }
    if (source.pathname.endsWith("/workspace/complete")) {
      const buffered = await bufferResponse(response);
      await this.terminate();
      return buffered;
    }
    return response;
  }

  async terminate() {
    if (this.terminated) return;
    this.terminated = true;
    this.token = "";
    try {
      await this.sandbox.terminate();
    } finally {
      this.onTerminated?.();
    }
  }
}

export function createModalSandboxContainerFactoryFromEnvironment({
  environment = process.env,
  client = new ModalClient(),
  fetcher = globalThis.fetch,
} = {}) {
  return new ModalSandboxContainerFactory({
    client,
    appName: environment.PROOFWEAVE_MODAL_APP,
    imageReference: environment.PROOFWEAVE_MODAL_RUNNER_IMAGE,
    resourcePolicyReviewed: environment.PROOFWEAVE_MODAL_RESOURCE_POLICY_REVIEWED === "true",
    resources: {
      cpu: numberFromEnvironment(environment.PROOFWEAVE_MODAL_CPU, "PROOFWEAVE_MODAL_CPU"),
      cpuLimit: numberFromEnvironment(environment.PROOFWEAVE_MODAL_CPU_LIMIT, "PROOFWEAVE_MODAL_CPU_LIMIT"),
      memoryMiB: integerFromEnvironment(environment.PROOFWEAVE_MODAL_MEMORY_MIB, "PROOFWEAVE_MODAL_MEMORY_MIB"),
      memoryLimitMiB: integerFromEnvironment(environment.PROOFWEAVE_MODAL_MEMORY_LIMIT_MIB, "PROOFWEAVE_MODAL_MEMORY_LIMIT_MIB"),
      timeoutMs: integerFromEnvironment(environment.PROOFWEAVE_MODAL_TIMEOUT_MS, "PROOFWEAVE_MODAL_TIMEOUT_MS"),
      idleTimeoutMs: integerFromEnvironment(environment.PROOFWEAVE_MODAL_IDLE_TIMEOUT_MS, "PROOFWEAVE_MODAL_IDLE_TIMEOUT_MS"),
    },
    fetcher,
  });
}

function normalizeResources(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ModalSandboxContainerError("Modal runner resources must be configured.");
  }
  const cpu = finiteRange(value.cpu, "Modal CPU reservation", 0.125, 16);
  const cpuLimit = finiteRange(value.cpuLimit, "Modal CPU limit", cpu, 16);
  const memoryMiB = integerRange(value.memoryMiB, "Modal memory reservation", 128, 65_536);
  const memoryLimitMiB = integerRange(value.memoryLimitMiB, "Modal memory limit", memoryMiB, 65_536);
  const timeoutMs = integerRange(value.timeoutMs, "Modal execution timeout", 1_000, 1_260_000);
  const idleTimeoutMs = integerRange(value.idleTimeoutMs, "Modal idle timeout", 1_000, timeoutMs + 60_000);
  return Object.freeze({ cpu, cpuLimit, memoryMiB, memoryLimitMiB, timeoutMs, idleTimeoutMs });
}

function forwardedHeaders(source) {
  const headers = new Headers();
  const blocked = /^(?:authorization|cookie|host|connection|proxy-authorization|x-forwarded-.+|x-modal-.+)$/i;
  source.forEach((value, name) => {
    if (!blocked.test(name)) headers.append(name, value);
  });
  return headers;
}

async function bufferResponse(response) {
  const headers = new Headers(response.headers);
  const body = await response.arrayBuffer();
  const responseBody = [204, 205, 304].includes(response.status) ? null : body;
  return new Response(responseBody, { status: response.status, statusText: response.statusText, headers });
}

function runIdFromPath(pathname) {
  const match = runPath.exec(pathname);
  if (!match) return null;
  try {
    const runId = decodeURIComponent(match[1]);
    return runId && !runId.includes("/") ? runId : null;
  } catch {
    return null;
  }
}

function requireConnectUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    throw new ModalSandboxContainerError("Modal Connect URL is invalid.");
  }
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new ModalSandboxContainerError("Modal Connect URL must be credential-free HTTPS.");
  }
  return url.toString();
}

function requireConnectToken(value) {
  if (typeof value !== "string" || value.length < 16 || value.length > 16_384 || /[\r\n]/.test(value)) {
    throw new ModalSandboxContainerError("Modal Connect Token is invalid.");
  }
  return value;
}

function requireIdentifier(value, label, maximum) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\0\r\n]/.test(value)) {
    throw new ModalSandboxContainerError(`${label} must be a bounded identifier.`);
  }
  return value;
}

function numberFromEnvironment(value, label) {
  if (typeof value !== "string" || !/^(?:\d+|\d+\.\d+)$/.test(value)) {
    throw new ModalSandboxContainerError(`${label} must be a number.`);
  }
  return Number(value);
}

function integerFromEnvironment(value, label) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new ModalSandboxContainerError(`${label} must be an integer.`);
  }
  return Number(value);
}

function finiteRange(value, label, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ModalSandboxContainerError(`${label} is outside the allowed range.`);
  }
  return value;
}

function integerRange(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ModalSandboxContainerError(`${label} is outside the allowed range.`);
  }
  return value;
}
