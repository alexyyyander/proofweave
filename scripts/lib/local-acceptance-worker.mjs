import assert from "node:assert/strict";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { createServer } from "node:https";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Agent } from "undici";
import { Miniflare } from "miniflare";
import { canonicalJson } from "../../packages/protocol/canonical-json.mjs";
import { delegationSigningPayload } from "../../packages/domain/delegation.mjs";
import { personKeyProofChallengeSigningPayload } from "../../packages/protocol/person-key-proof.mjs";

export async function acceptanceKey(id) {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  // Workerd accepts standard EdDSA JWKs; Node 24 exports a newer alg label.
  delete privateKeyJwk.alg;
  return { id, ...pair, publicKey: Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url"), privateKeyJwk };
}

export async function createAcceptanceWorker({ root, keys, actors, imageDigest, leanToolchain, mathlibRevision }) {
  let worker, server, dispatcher;
  let closing;
  function close() {
    if (!closing) closing = (async () => {
      const results = await Promise.allSettled([
        Promise.resolve().then(() => worker?.dispose()),
        Promise.resolve().then(() => dispatcher?.destroy()),
        new Promise((resolve, reject) => {
          if (!server) return resolve();
          server.close(error => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
          server.closeAllConnections();
        }),
      ]);
      if (results.some(result => result.status === "rejected")) throw new Error("Local acceptance resources could not all close cleanly.");
    })();
    return closing;
  }
  try {
    const caPath = join(root, "loopback-ca.pem");
    const tlsKeyPath = join(root, "loopback-key.pem");
    await promisify(execFile)("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", tlsKeyPath, "-out", caPath, "-days", "1", "-subj", "/CN=Proofweave local acceptance", "-addext", "subjectAltName=IP:127.0.0.1"]);
    const ca = await readFile(caPath);
    dispatcher = new Agent({ connect: { ca } });
    server = createServer({ key: await readFile(tlsKeyPath), cert: ca }, async (incoming, outgoing) => {
      try {
        if (!worker) { outgoing.writeHead(503).end(); return; }
        const chunks = []; let bytes = 0;
        for await (const chunk of incoming) { bytes += chunk.length; if (bytes > 5_000_000) throw new Error("Local request too large"); chunks.push(chunk); }
        const response = await worker.dispatchFetch(`${origin}${incoming.url}`, {
          method: incoming.method, headers: incoming.headers,
          ...(["GET", "HEAD"].includes(incoming.method) ? {} : { body: Buffer.concat(chunks) }),
        });
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch { outgoing.writeHead(500, { "content-type": "application/json" }).end('{"error":"isolated_worker_request_failed"}'); }
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = `https://127.0.0.1:${server.address().port}`;
    const workerRoot = new URL("../../dist/server/", import.meta.url);
    const entrypoint = fileURLToPath(new URL("index.js", workerRoot));
    const modules = await listJavaScriptModules(workerRoot);
    const allowlist = JSON.stringify({ schemaVersion: "pw-research-write-allowlist-v1", persons: actors.map(a => a.personId), agents: actors.map(a => a.agentId), attempts: [], allowNewAttempts: true });
    const workerOptions = {
      modules: [{ type: "ESModule", path: entrypoint }, ...modules.filter(path => path !== entrypoint).map(path => ({ type: "ESModule", path }))],
      modulesRoot: fileURLToPath(workerRoot), compatibilityDate: "2026-07-16", compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      bindings: {
        PROOFWEAVE_CONTROL_PLANE_MODE: "read_write", PROOFWEAVE_PARTICIPANT_CONTROL_PLANE_MODE: "read_write", PROOFWEAVE_MCP_CONTROL_PLANE_MODE: "read_write",
        PROOFWEAVE_ACCOUNT_AUTH_MODE: "read_write", PROOFWEAVE_OAUTH_CONTROL_PLANE_MODE: "read_write", PROOFWEAVE_CONNECTION_CONTROL_PLANE_MODE: "read_write",
        PROOFWEAVE_PARTICIPANT_RESEARCH_WRITE_ALLOWLIST_JSON: allowlist, PROOFWEAVE_MCP_RESEARCH_WRITE_ALLOWLIST_JSON: allowlist,
        PROOFWEAVE_HOSTING_PLATFORM: "cloudflare", PROOFWEAVE_DEPLOYMENT_STAGE: "validation",
        OAUTH_ISSUER_URL: origin, MCP_RESOURCE_URL: `${origin}/api/mcp`,
        RUNNER_QUEUE_MODE: "d1", RUNNER_APPROVED_IMAGES_JSON: JSON.stringify([{ imageDigest, leanToolchain, mathlibRevision }]),
        RUNNER_CONTROL_PLANE_KEY_ID: keys.controlPlane.id, RUNNER_CONTROL_PLANE_PRIVATE_KEY_JWK: JSON.stringify(keys.controlPlane.privateKeyJwk),
        RUNNER_DEFAULT_LIMITS_JSON: JSON.stringify({ cpuSeconds: 120, wallSeconds: 240, memoryMiB: 2048, diskMiB: 256, outputBytes: 1_000_000 }),
        RECEIPT_ISSUER_KEY_ID: keys.issuer.id, RECEIPT_ISSUER_PUBLIC_KEY: keys.issuer.publicKey,
        RECEIPT_ISSUER_PRIVATE_KEY_JWK: JSON.stringify(keys.issuer.privateKeyJwk), RECEIPT_ISSUER_ACTIVATED_AT: new Date(Date.now() - 60_000).toISOString(),
      },
      serviceBindings: { ASSETS: () => new Response("Not found", { status: 404 }) },
    };
    worker = new Miniflare(workerOptions);
    let database = await worker.getD1Database("DB");
    const migrations = new URL("../../drizzle/", import.meta.url);
    for (const name of (await readdir(migrations)).filter(n => n.endsWith(".sql")).sort()) {
      for (const sql of (await readFile(new URL(name, migrations), "utf8")).split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean)) await database.prepare(sql).run();
    }
    for (const actor of actors) {
      const now = new Date().toISOString();
      actor.sessionToken = randomBytes(32).toString("base64url");
      const identityId = `identity:${randomUUID()}`;
      await database.prepare("INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)").bind(actor.personId, "google", actor.personId, actor.label, now).run();
      await database.prepare("INSERT INTO person_identities (id, person_id, provider, provider_subject, email, email_normalized, display_name, email_verified_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(identityId, actor.personId, "google", actor.personId, `${actor.role}@example.test`, `${actor.role}@example.test`, actor.label, now, now).run();
      await database.prepare("INSERT INTO app_sessions (id, person_id, identity_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(`session:${randomUUID()}`, actor.personId, identityId, createHash("sha256").update(actor.sessionToken).digest("hex"), new Date(Date.now()+3_600_000).toISOString(), now).run();
      actor.configPath = join(root, `${actor.role}-connector.json`);
      await writeFile(actor.configPath, JSON.stringify({ version: 3, baseUrl: origin, agentId: actor.agentId, agentLabel: actor.label, agentPublicKey: actor.agentKey.publicKey, privateKeyJwk: actor.agentKey.privateKeyJwk, connectionMode: actor.role }), { mode: 0o600 });
    }
    await database.prepare("INSERT INTO runner_keys (id, public_key, fingerprint) VALUES (?, ?, ?)").bind(keys.runner.id, keys.runner.publicKey, `sha256:${createHash("sha256").update(Buffer.from(keys.runner.publicKey,"base64url")).digest("hex")}`).run();
    async function personRequest(path, { method = "GET", body, personId } = {}) {
      const actor = actors.find(a => a.personId === personId);
      assert.ok(path.startsWith("/") && !path.startsWith("//"), "Only local API paths are allowed");
      const response = await fetch(`${origin}${path}`, { method, dispatcher, redirect: "manual", headers: { ...(actor ? { cookie: `__Host-pw_session=${actor.sessionToken}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await response.text();
      let result; try { result = JSON.parse(text); } catch { result = { nonJson: true }; }
      return { status: response.status, body: result };
    }
    return { origin, caPath, get database() { return database; }, personRequest, async setWindowAttempts(attempts) {
      assert.ok(attempts.every(id => typeof id === "string" && id.startsWith("attempt:")), "Only actual local Attempt identifiers may enter the window");
      const updated = JSON.stringify({ ...JSON.parse(allowlist), attempts, allowNewAttempts: false });
      workerOptions.bindings.PROOFWEAVE_PARTICIPANT_RESEARCH_WRITE_ALLOWLIST_JSON = updated;
      workerOptions.bindings.PROOFWEAVE_MCP_RESEARCH_WRITE_ALLOWLIST_JSON = updated;
      await worker.setOptions(workerOptions);
      database = await worker.getD1Database("DB");
    }, close };
  } catch (error) {
    // Preserve the setup failure, but attempt every cleanup even if one fails.
    await close().catch(() => {});
    throw error;
  }
}

/** Simulates only the two explicitly synthetic Persons; executes real HTTP key proofs, consent and OAuth. */
export async function approveSyntheticPairing({ actor, pending, origin, personRequest }) {
  const approvalUrl = new URL(pending.approvalUrl ?? pending.connectionUrl);
  assert.equal(approvalUrl.origin, origin);
  assert.equal(approvalUrl.pathname, "/connect/codex");
  const pairingId = approvalUrl.searchParams.get("pairing"); const secret = approvalUrl.searchParams.get("secret");
  async function post(path, body) {
    const res = await personRequest(path, { method: "POST", body, personId: actor.personId });
    assert.ok(res.status >= 200 && res.status < 300, `${path}: ${JSON.stringify(res)}`); return res.body;
  }
  const personKey = (await post("/api/me/keys", { publicKey: actor.personKey.publicKey })).key;
  const challenge = (await post(`/api/me/keys/${encodeURIComponent(personKey.id)}/proof-challenge`)).challenge;
  await post(`/api/me/keys/${encodeURIComponent(personKey.id)}/proof`, { challengeId: challenge.id, personSignature: await signCanonical(actor.personKey.privateKey, personKeyProofChallengeSigningPayload(challenge)) });
  await post("/api/me/agents", { agentId: actor.agentId, label: actor.label, publicKey: actor.agentKey.publicKey });
  const certificate = { id: `pw:delegation:${randomUUID()}`, ownerPersonId: actor.personId, agentId: actor.agentId, agentPublicKey: actor.agentKey.publicKey, scopes: actor.role === "research" ? ["formalize", "prove"] : ["review"], validFrom: new Date(Date.now()-60_000).toISOString(), validUntil: new Date(Date.now()+3_600_000).toISOString(), attributionPolicy: { beneficiaryPersonId: actor.personId, mode: "agent_delegated" } };
  await post("/api/me/delegations", { personKeyId: personKey.id, certificate, personSignature: await signCanonical(actor.personKey.privateKey, delegationSigningPayload(certificate)) });
  actor.delegationCertificateId = certificate.id;
  const approval = await post(`/api/connect/sessions/${encodeURIComponent(pairingId)}/approve`, { secret, delegationCertificateId: certificate.id });
  const callback = new URL(approval.redirectUrl);
  assert.equal(callback.origin, `http://127.0.0.1:${actor.callbackPort}`); assert.equal(callback.pathname, "/callback");
  const response = await fetch(callback, { redirect: "error" });
  assert.equal(response.status, 200, `Real Connector must exchange its PKCE code: ${response.status === 200 ? "ok" : JSON.stringify(await actor.client.call("connection_status"))}`);
  return { pairingId, installationId: approval.installationId, delegationCertificateId: certificate.id };
}

async function signCanonical(key, payload) { return Buffer.from(await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(canonicalJson(payload)))).toString("base64url"); }
async function listJavaScriptModules(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) files.push(...await listJavaScriptModules(url));
    else if (entry.name.endsWith(".js")) files.push(fileURLToPath(url));
  }
  return files;
}
