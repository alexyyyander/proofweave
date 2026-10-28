#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const profilePath = process.argv[2];
assert.ok(profilePath, "Pass client-profiles.json from a still-running isolated acceptance driver.");
const profile = JSON.parse(await readFile(profilePath, "utf8"));
const origin = new URL(profile.origin);
assert.equal(origin.protocol, "https:");
assert.equal(origin.hostname, "127.0.0.1");
assert.equal(origin.pathname + origin.search + origin.hash, "/");
const reviewer = profile.clients.find(client => client.role === "review");
assert.ok(reviewer && profile.caPath);
const connector = fileURLToPath(new URL("../plugins/proofweave-research/mcp/proofweave-local.mjs", import.meta.url));
const env = {
  PROOFWEAVE_BASE_URL: profile.origin,
  PROOFWEAVE_CONNECTOR_CONFIG: reviewer.configPath,
  PROOFWEAVE_CALLBACK_PORT: String(reviewer.callbackPort),
  PROOFWEAVE_DISABLE_BROWSER_OPEN: "1",
  NODE_EXTRA_CA_CERTS: profile.caPath,
};
const quoted = value => JSON.stringify(value);
const config = `mcp_servers.proofweave_acceptance={command=${quoted(process.execPath)},args=[${quoted(connector)}],required=true,enabled_tools=["connection_status","get_connection_authority","list_review_assignments"],env={${Object.entries(env).map(([key,value]) => `${key}=${quoted(value)}`).join(",")}}}`;
const outputDirectory = dirname(profilePath);
const acceptance = JSON.parse(await readFile(join(outputDirectory,"acceptance-report.json"), "utf8"));
assert.equal(acceptance.origin, profile.origin);
assert.equal(acceptance.productionAcceptance, false);
assert.equal(acceptance.syntheticIdentities, true);
const prompt = "Validate the explicitly synthetic local Proofweave acceptance MCP connection. Use ONLY the proofweave_acceptance MCP server. First call connection_status, then get_connection_authority, then list_review_assignments. Do not connect again, change identities, read local files, run shell commands, or use other MCP servers. Do not publish or submit anything. Report whether connected, the review role, and the returned assignment states. This is a local synthetic integration witness; it is not independent human review or production acceptance.";
const events = [];
let pending = "";
const child = spawn("codex", ["exec", "--ignore-user-config", "--ephemeral", "--json", "--sandbox", "read-only", "--skip-git-repo-check", "-C", outputDirectory, "-c", config, prompt], { stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
const diagnostics = [];
child.stderr.on("data", chunk => diagnostics.push(chunk));
child.stdout.on("data", chunk => {
  pending += chunk;
  while (pending.includes("\n")) {
    const index = pending.indexOf("\n");
    const line = pending.slice(0,index); pending = pending.slice(index+1);
    try { events.push(JSON.parse(line)); } catch { /* CLI progress is not evidence. */ }
  }
});
function stop(signal) { try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch (error) { if (error.code !== "ESRCH") throw error; } }
let killTimer;
const timer = setTimeout(() => { stop("SIGTERM"); killTimer = setTimeout(() => stop("SIGKILL"), 5000); }, 180_000);
const exitCode = await new Promise((resolve,reject) => { child.once("error",reject); child.once("close",resolve); }).finally(() => { clearTimeout(timer); clearTimeout(killTimer); });
await writeFile(join(outputDirectory,"codex-witness-events.json"), JSON.stringify(events,null,2), { mode: 0o600 });
await writeFile(join(outputDirectory,"codex-witness-diagnostics.txt"), Buffer.concat(diagnostics), { mode: 0o600 });
assert.equal(exitCode, 0, "The extra Codex process did not finish successfully; inspect private diagnostics.");
const calls = events.filter(event => event.type === "item.completed" && event.item?.type === "mcp_tool_call").map(event => event.item);
for (const tool of ["connection_status","get_connection_authority","list_review_assignments"]) {
  assert.ok(calls.some(call => call.server === "proofweave_acceptance" && call.tool === tool && call.status === "completed" && !call.error && !call.result?.isError), `Extra Codex did not successfully call ${tool}`);
}
const allowed = ["connection_status","get_connection_authority","list_review_assignments"];
assert.ok(calls.every(call => call.server === "proofweave_acceptance" && allowed.includes(call.tool)), "Unexpected MCP call invalidates this witness");
assert.ok(!events.some(event => ["command_execution","file_change","web_search"].includes(event.item?.type)), "Unexpected non-MCP action invalidates this witness");
function payload(tool) {
  const call = calls.find(call => call.tool === tool);
  return call.result.structuredContent ?? JSON.parse(call.result.content.find(item => item.type === "text").text);
}
const status = payload("connection_status");
assert.equal(status.connected, true); assert.equal(status.liveConnection.state, "ready");
assert.equal(status.connectionMode, "review"); assert.equal(status.baseUrl, profile.origin);
const authority = payload("get_connection_authority");
assert.equal(authority.personId, acceptance.review.reviewerPersonId);
assert.equal(authority.agentId, acceptance.review.reviewerAgentId);
assert.ok(authority.oauthScopes.includes("verification:replay"));
const assignments = payload("list_review_assignments").assignments;
for (const claim of acceptance.review.claims) {
  const assignment = assignments.find(item => item.id === claim.assignmentId);
  assert.equal(assignment?.status, "completed");
  assert.equal(assignment.claimType, claim.claimType);
}
const report = { schemaVersion: "pw-local-codex-witness-v1", productionAcceptance: false, independentHumanReview: false, completedAt: new Date().toISOString(), origin: profile.origin, exitCode, connected: true, role: "review", completedAssignments: acceptance.review.claims.map(claim => claim.assignmentId), tools: calls.map(({server,tool,status}) => ({server,tool,status})) };
await writeFile(join(outputDirectory,"codex-witness-report.json"), JSON.stringify(report,null,2), { mode: 0o600 });
console.log(JSON.stringify(report));
