const requestIdPattern = /^pw-[a-f0-9]{32}$/;
const componentPattern = /^[a-z][a-z0-9_]{2,63}$/;

/**
 * Privacy-minimal observability primitives for deployable Worker boundaries.
 *
 * Records deliberately exclude request headers, query strings, bearer tokens,
 * MCP arguments, artifact bytes, identities, and exception messages. A log
 * sink receives a frozen object so a deployment can serialize it to its own
 * structured logging backend without changing control-plane behavior.
 */
export function createStructuredHttpAudit({ component, emit, now = () => new Date(), monotonicNow = () => Date.now(), createRequestId = randomRequestId }) {
  requireComponent(component);
  requireEmitter(emit);
  if (typeof now !== "function" || typeof monotonicNow !== "function" || typeof createRequestId !== "function") {
    throw new TypeError("Structured HTTP audit requires clock and request-id functions.");
  }

  return Object.freeze({
    async handle(request, handler) {
      if (!(request instanceof Request)) throw new TypeError("Structured HTTP audit requires a Fetch Request.");
      if (typeof handler !== "function") throw new TypeError("Structured HTTP audit requires a response handler.");
      // Do not ingest an arbitrary client correlation header: it can carry
      // identity or other user-controlled data into a log stream. The Worker
      // creates a new opaque ID and returns it to the caller instead.
      const requestId = createSafeRequestId(createRequestId());
      const startedAt = toTimestamp(now());
      const startedMonotonic = finiteTimestamp(monotonicNow());
      const requestMetadata = Object.freeze({
        requestId,
        method: request.method,
        path: auditPathDimension(new URL(request.url).pathname),
      });
      try {
        const response = await handler(Object.freeze({ requestId }));
        if (!(response instanceof Response)) throw new TypeError("Structured HTTP audit handler must return a Fetch Response.");
        const durationMs = elapsedMilliseconds(startedMonotonic, monotonicNow());
        safeEmit(emit, freezeRecord({
          schemaVersion: "pw-audit-v1",
          kind: "http_request_completed",
          component,
          ...requestMetadata,
          startedAt,
          durationMs,
          status: response.status,
          outcome: response.status >= 500 ? "server_error" : "completed",
        }));
        return responseWithRequestId(response, requestId);
      } catch (cause) {
        const durationMs = elapsedMilliseconds(startedMonotonic, monotonicNow());
        safeEmit(emit, freezeRecord({
          schemaVersion: "pw-audit-v1",
          kind: "http_request_failed",
          component,
          ...requestMetadata,
          startedAt,
          durationMs,
          status: 500,
          outcome: "unhandled_error",
        }));
        throw cause;
      }
    },
  });
}

/** Aggregate a private Queue batch without logging any signed Run identity. */
export function createStructuredQueueAudit({ component, emit, now = () => new Date(), monotonicNow = () => Date.now() }) {
  requireComponent(component);
  requireEmitter(emit);
  if (typeof now !== "function" || typeof monotonicNow !== "function") {
    throw new TypeError("Structured Queue audit requires clock functions.");
  }
  return Object.freeze({
    async handle({ delivered, handler }) {
      if (!Number.isInteger(delivered) || delivered < 0 || delivered > 1_000) {
        throw new TypeError("Structured Queue audit requires a bounded delivered count.");
      }
      if (typeof handler !== "function") throw new TypeError("Structured Queue audit requires a batch handler.");
      const startedAt = toTimestamp(now());
      const startedMonotonic = finiteTimestamp(monotonicNow());
      try {
        const result = await handler();
        const acknowledged = result?.acknowledged;
        const retried = result?.retried;
        if (!Number.isInteger(acknowledged) || !Number.isInteger(retried) || acknowledged < 0 || retried < 0 || acknowledged + retried !== delivered) {
          throw new TypeError("Structured Queue audit handler returned invalid delivery totals.");
        }
        safeEmit(emit, freezeRecord({
          schemaVersion: "pw-audit-v1",
          kind: "queue_batch_completed",
          component,
          startedAt,
          durationMs: elapsedMilliseconds(startedMonotonic, monotonicNow()),
          delivered,
          acknowledged,
          retried,
          outcome: retried > 0 ? "partial_retry" : "completed",
        }));
        return result;
      } catch (cause) {
        safeEmit(emit, freezeRecord({
          schemaVersion: "pw-audit-v1",
          kind: "queue_batch_failed",
          component,
          startedAt,
          durationMs: elapsedMilliseconds(startedMonotonic, monotonicNow()),
          delivered,
          acknowledged: 0,
          retried: 0,
          outcome: "unhandled_error",
        }));
        throw cause;
      }
    },
  });
}

/** Cloudflare console is a structured-log transport, never a source of secrets. */
export function emitStructuredConsole(record) {
  console.log(JSON.stringify(record));
}

/**
 * Observability is never allowed to change the outcome of a request or a
 * durable Queue delivery. Sink failures are intentionally ignored here; a
 * deployment can monitor its logging transport independently.
 */
function safeEmit(emit, record) {
  try {
    const pending = emit(record);
    if (pending && typeof pending.then === "function") {
      Promise.resolve(pending).catch(() => {});
    }
  } catch {
    // Keep the execution boundary independent of its optional log transport.
  }
}

function responseWithRequestId(response, requestId) {
  const headers = new Headers(response.headers);
  headers.set("x-proofweave-request-id", requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function freezeRecord(record) {
  return Object.freeze({ ...record });
}

function createSafeRequestId(value) {
  if (typeof value !== "string" || !requestIdPattern.test(value)) {
    throw new TypeError("Structured HTTP audit request-id generator returned an invalid identifier.");
  }
  return value;
}

function randomRequestId() {
  const random = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replaceAll("-", "")
    : Math.random().toString(36).slice(2).padEnd(16, "0");
  return `pw-${random}`;
}

function auditPathDimension(path) {
  // The remote resource has two static public paths. Unknown paths are grouped
  // instead of recording an arbitrary URL segment supplied by a client.
  if (path === "/mcp" || path === "/.well-known/oauth-protected-resource") return path;
  return "/other";
}

function elapsedMilliseconds(started, now) {
  const duration = finiteTimestamp(now) - started;
  return Math.max(0, Math.min(Math.round(duration), 86_400_000));
}

function finiteTimestamp(value) {
  if (!Number.isFinite(value)) throw new TypeError("Structured audit clock returned an invalid timestamp.");
  return value;
}

function toTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("Structured audit clock returned an invalid instant.");
  return date.toISOString();
}

function requireComponent(value) {
  if (typeof value !== "string" || !componentPattern.test(value)) {
    throw new TypeError("Structured audit component must be a lower-case bounded identifier.");
  }
}

function requireEmitter(value) {
  if (typeof value !== "function") throw new TypeError("Structured audit requires an event emitter.");
}
