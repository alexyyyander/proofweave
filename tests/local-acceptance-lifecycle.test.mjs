import assert from "node:assert/strict";
import childProcess, { execFile } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { promisify } from "node:util";
import { test } from "node:test";
import { createAcceptanceConnector } from "../scripts/lib/local-acceptance-connector.mjs";

const execFileAsync = promisify(execFile);
const connectorOptions = { origin: "https://127.0.0.1:44764", configPath: "/tmp/unused-acceptance-config.json", callbackPort: 44765 };

function replaceSpawn(t, replacement) {
  const original = childProcess.spawn;
  childProcess.spawn = replacement;
  syncBuiltinESMExports();
  t.after(() => { childProcess.spawn = original; syncBuiltinESMExports(); });
  return original;
}

test("acceptance Connector reports spawn errors without an unhandled error or lingering RPC", async t => {
  const actualSpawn = childProcess.spawn;
  replaceSpawn(t, () => actualSpawn("/nonexistent-proofweave-acceptance-executable", [], { stdio: ["pipe", "pipe", "pipe"] }));
  const client = createAcceptanceConnector(connectorOptions);
  await assert.rejects(client.initialize(), /Connector (could not start|input closed|exited|closed)/);
  await client.close();
  await assert.rejects(client.call("connection_status"), /Connector/);
});

test("acceptance Connector close awaits exit and escalates an unresponsive child", async t => {
  const actualSpawn = childProcess.spawn;
  let child;
  let ready;
  replaceSpawn(t, () => {
    child = actualSpawn(process.execPath, ["-e", 'process.on("SIGTERM",()=>{}); process.stdout.write("ready\\n"); setInterval(()=>{},1000);'], { stdio: ["pipe", "pipe", "pipe"] });
    ready = new Promise(resolve => child.stdout.once("data", resolve));
    return child;
  });
  const client = createAcceptanceConnector(connectorOptions);
  t.after(() => child?.kill("SIGKILL"));
  await ready;
  const pending = assert.rejects(client.initialize(), /Connector is closing/);
  await Promise.all([client.close(), client.close()]);
  await pending;
  assert.equal(child.signalCode, "SIGKILL");
  assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
});

for (const stage of ["before_worker", "after_worker"]) test(`acceptance Worker releases its listener on setup failure: ${stage}`, { timeout: 20_000 }, async () => {
  const workerModule = new URL("../scripts/lib/local-acceptance-worker.mjs", import.meta.url).href;
  // A separate process must exit naturally. An unreclaimed HTTPS listener or
  // Miniflare runtime would keep it alive until execFile's timeout fails this test.
  const source = `
    import assert from "node:assert/strict";
    import { mkdtemp, rm } from "node:fs/promises";
    import { tmpdir } from "node:os";
    import { join } from "node:path";
    import { Miniflare } from "miniflare";
    import { createAcceptanceWorker } from ${JSON.stringify(workerModule)};
    const root = await mkdtemp(join(tmpdir(), "proofweave-lifecycle-"));
    const keys = {};
    Object.defineProperty(keys, "controlPlane", { get() {
      ${stage === "before_worker" ? 'throw new Error("injected_before_worker");' : 'return { id: "control", privateKeyJwk: {} };'}
    }});
    keys.issuer = { id: "issuer", publicKey: "fixture", privateKeyJwk: {} };
    let disposed = false;
    const dispose = Miniflare.prototype.dispose;
    if (${JSON.stringify(stage)} === "after_worker") {
      Miniflare.prototype.getD1Database = async () => { throw new Error("injected_after_worker"); };
      Miniflare.prototype.dispose = async function() { disposed = true; await dispose.call(this); throw new Error("injected_dispose_failure"); };
    }
    try {
      await assert.rejects(createAcceptanceWorker({ root, keys, actors: [], imageDigest: "fixture", leanToolchain: "fixture", mathlibRevision: "none" }), /injected_${stage}/);
      if (${JSON.stringify(stage)} === "after_worker") assert.equal(disposed, true);
    } finally { await rm(root, { recursive: true, force: true }); }
  `;
  await execFileAsync(process.execPath, ["--input-type=module", "-e", source], { cwd: new URL("../", import.meta.url), timeout: 15_000, maxBuffer: 100_000 });
});
