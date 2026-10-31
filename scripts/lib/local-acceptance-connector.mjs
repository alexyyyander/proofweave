import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

/** A real stdio client used only against this run's loopback Worker. */
export function createAcceptanceConnector({ origin, configPath, callbackPort, caPath }) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/") {
    throw new Error("Acceptance Connector requires an explicit IPv4 loopback origin.");
  }
  const child = spawn(process.execPath, [fileURLToPath(new URL("../../plugins/proofweave-research/mcp/proofweave-local.mjs", import.meta.url))], {
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
      NODE_EXTRA_CA_CERTS: caPath, PROOFWEAVE_BASE_URL: origin, PROOFWEAVE_CONNECTOR_CONFIG: configPath,
      PROOFWEAVE_CALLBACK_PORT: String(callbackPort), PROOFWEAVE_DISABLE_BROWSER_OPEN: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let sequence = 0;
  let stopped = null;
  let closing = null;
  let resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const pending = new Map();
  const transcript = [];
  const lines = createInterface({ input: child.stdout });
  lines.on("line", line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  // Approval URLs and credentials must never become transcript/log content.
  child.stderr.resume();
  function failPending(error) {
    stopped ??= error;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(stopped); }
    pending.clear();
  }
  child.once("error", () => failPending(new Error("Local acceptance Connector could not start.")));
  child.stdin.on("error", () => failPending(new Error("Local acceptance Connector input closed.")));
  child.once("exit", code => failPending(new Error(`Connector exited (${code})`)));
  child.once("close", () => {
    failPending(new Error("Local acceptance Connector closed."));
    lines.close();
    resolveClosed();
  });
  function rpc(method, params = {}) {
    if (stopped) return Promise.reject(stopped);
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Connector request timed out: ${method}`)); }, 120_000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n", error => {
        if (error) failPending(new Error("Local acceptance Connector input closed."));
      });
    });
  }
  return {
    transcript,
    async initialize() {
      const initialized = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "proofweave-isolated-acceptance", version: "1" } });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      return initialized;
    },
    async call(name, args = {}) {
      const startedAt = new Date().toISOString();
      try {
        const response = await rpc("tools/call", { name, arguments: args });
        const text = response.content?.find(c => c.type === "text")?.text;
        let payload = response.structuredContent;
        if (!payload) { try { payload = JSON.parse(text); } catch { payload = { message: text }; } }
        if (response.isError) throw new Error(payload?.error?.message ?? payload?.message ?? "Connector tool failed");
        transcript.push({ name, startedAt, finishedAt: new Date().toISOString(), outcome: "returned" });
        return payload;
      } catch (error) {
        transcript.push({ name, startedAt, finishedAt: new Date().toISOString(), outcome: "failed" });
        throw error;
      }
    },
    close() {
      if (!closing) closing = (async () => {
        failPending(new Error("Local acceptance Connector is closing."));
        child.stdin.end();
        child.kill("SIGTERM");
        const escalation = setTimeout(() => child.kill("SIGKILL"), 1_000);
        let deadline;
        try {
          await Promise.race([
            closed,
            new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("Local acceptance Connector did not exit after termination.")), 5_000); }),
          ]);
        } finally {
          clearTimeout(escalation); clearTimeout(deadline);
          lines.close(); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
        }
      })();
      return closing;
    },
  };
}
