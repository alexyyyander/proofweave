#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { acceptanceKey, createAcceptanceWorker, approveSyntheticPairing } from "./lib/local-acceptance-worker.mjs";
import { createAcceptanceConnector } from "./lib/local-acceptance-connector.mjs";
import { seedLocalAcceptanceCatalog, runLocalReviewCreditAcceptance } from "./lib/local-review-credit-acceptance.mjs";
import { createLocalAcceptanceRunner } from "./lib/local-acceptance-runner.mjs";

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
assert.ok(args.includes("--isolated-test"), "Explicit --isolated-test acknowledgement is required. This driver cannot target production.");
const imageDigest = option("--image-digest");
assert.ok(imageDigest, "Supply the exact local acceptance image digest; no production default is allowed.");
const dockerImageId = option("--docker-image-id");
assert.match(dockerImageId ?? "", /^sha256:[a-f0-9]{64}$/, "Full-chain acceptance requires an immutable real Docker image ID.");
assert.equal(imageDigest, `local/proofweave-acceptance@${dockerImageId}`, "Protocol image digest must bind this exact local image.");
const leanToolchain = option("--lean-toolchain") ?? "leanprover/lean4:v4.35.0";
const root = await mkdtemp(join(tmpdir(), "proofweave-mcp-acceptance-"));
const startedAt = new Date().toISOString();
const sourceRevision = (await execFileAsync("git", ["rev-parse", "HEAD"])).stdout.trim();
const sourceDirty = Boolean((await execFileAsync("git", ["status", "--porcelain"])).stdout.trim());
const events = [];
const clients = [];
let runtime, runner;
const onStage = event => { events.push({ ...event, at: new Date().toISOString() }); console.log(JSON.stringify(event)); };
console.log(JSON.stringify({ mode: "isolated_test", syntheticIdentities: true, productionAcceptance: false, root }));
try {
  const keys = Object.fromEntries(await Promise.all(["controlPlane", "runner", "issuer"].map(async name => [name, await acceptanceKey(`${name}:${randomUUID()}`)])));
  const actors = await Promise.all(["research", "review"].map(async role => ({ role, personId: `person:${randomUUID()}`, agentId: `urn:pw:agent:${randomUUID()}`, label: `Synthetic acceptance ${role}`, agentKey: await acceptanceKey(`agent:${randomUUID()}`), personKey: await acceptanceKey(`person-key:${randomUUID()}`), callbackPort: await unusedPort() })));
  assert.notEqual(actors[0].callbackPort, actors[1].callbackPort);
  runtime = await createAcceptanceWorker({ root, keys, actors, imageDigest, leanToolchain, mathlibRevision: "none" });
  const workspace = join(root, "lean-workspace"); await mkdir(workspace);
  const entryFile = "ProofweaveAcceptance.lean";
  const source = "namespace ProofweaveAcceptance\ntheorem identity (n : Nat) : n = n := rfl\nend ProofweaveAcceptance\n";
  await writeFile(join(workspace, entryFile), source.replace(":= rfl", ":= by sorry"));
  await writeFile(join(workspace, "lean-toolchain"), leanToolchain + "\n");
  await writeFile(join(workspace, "lakefile.toml"), 'name = "proofweaveAcceptance"\nversion = "0.1.0"\n[[lean_lib]]\nname = "ProofweaveAcceptance"\n');
  await writeFile(join(workspace, "lake-manifest.json"), '{"version":"1.1.0","packagesDir":".lake/packages","packages":[],"name":"proofweaveAcceptance","lakeDir":".lake"}\n');
  for (const command of [["init", "--quiet"], ["add", "."], ["-c", "user.name=Local acceptance", "-c", "user.email=acceptance@example.test", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Controlled Lean starting point"]]) await execFileAsync("git", command, { cwd: workspace });
  const fixtureRevision = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: workspace })).stdout.trim();
  await writeFile(join(workspace, entryFile), source);
  const uuid = randomUUID();
  const ids = { projectId: `project:${uuid}`, problemId: `problem:${uuid}`, revisionId: `revision:${uuid}`, snapshotId: `snapshot:${uuid}`, poolId: `pool:${uuid}`, slug: `acceptance-${uuid}` };
  const leanStatement = "theorem identity (n : Nat) : n = n := rfl";
  await seedLocalAcceptanceCatalog({ database: runtime.database, ids, environment: "isolated_test", target: { declaration: "ProofweaveAcceptance.identity", leanStatement, leanToolchain, mathlibRevision: "none", statementHash: sha256(leanStatement), sourceUrl: `https://example.test/acceptance/${uuid}`, sourceRevision: fixtureRevision, sourcePath: entryFile } });
  for (const actor of actors) {
    const client = createAcceptanceConnector({ origin: runtime.origin, caPath: runtime.caPath, configPath: actor.configPath, callbackPort: actor.callbackPort });
    clients.push(client); actor.client = client;
    await client.initialize();
    const pending = await client.call("connect_proofweave", { role: actor.role });
    assert.equal(pending.connected, false, "New synthetic installation must require consent");
    const pairing = await approveSyntheticPairing({ actor, pending, origin: runtime.origin, personRequest: runtime.personRequest });
    const status = await client.call("connection_status"); assert.equal(status.connected, true);
    const authority = await client.call("get_connection_authority");
    onStage({ stage: "oauth_connected", role: actor.role, personId: actor.personId, agentId: actor.agentId, pairingId: pairing.pairingId });
    actor.authority = authority;
  }
  const [owner, reviewer] = actors;
  const research = await owner.client.call("begin_research", { targetSlug: ids.slug, intent: "formalize" });
  const attemptId = research.attempt?.id ?? research.attemptId;
  assert.ok(attemptId, "MCP begin_research must return an actual Attempt");
  const repeated = await owner.client.call("begin_research", { targetSlug: ids.slug, intent: "formalize" });
  assert.equal(repeated.attempt?.id ?? repeated.attemptId, attemptId);
  await runtime.setWindowAttempts([attemptId]);
  const checkpoint = await owner.client.call("prepare_research_checkpoint", { attemptId, kind: "proof_patch", summary: "Controlled local acceptance: replace a placeholder with the reflexivity proof of n = n; generated fixture only, not a new mathematical discovery.", parentNodeIds: [] });
  await writeFile(join(root, "checkpoint-draft.json"), JSON.stringify(checkpoint,null,2), { mode: 0o600 });
  // Synthetic fixture approval is scoped to this local run and is not a human publication approval.
  const published = await owner.client.call("publish_prepared_research_checkpoint", { ...checkpoint.publishInput, checkpoint: checkpoint.checkpoint, expectedCheckpointHash: checkpoint.checkpointHash, ownerConfirmation: "I_CONFIRM_PUBLISH_CHECKPOINT" });
  assert.equal(published.published, true);
  assert.equal(published.verificationState, "shared_research_only");
  const graph = await owner.client.call("inspect_research_graph", { slug: ids.slug });
  const recordedCheckpoint = graph.graph.nodes.find(node => node.id === checkpoint.checkpoint.id);
  assert.equal(recordedCheckpoint?.checkpointHash, checkpoint.checkpointHash);
  assert.equal(recordedCheckpoint.attemptId, attemptId);
  onStage({ stage: "checkpoint_published", verificationState: published.verificationState ?? published.state });
  const draft = await owner.client.call("prepare_workspace_bundle_v2", { attemptId, workspaceRoot: workspace, entryFile, allowedAxioms: [], ownerConfirmation: "I_CONFIRM_PREPARE_WORKSPACE_BUNDLE" });
  await writeFile(join(root, "bundle-draft.json"), JSON.stringify(draft,null,2), { mode: 0o600 });
  const artifactHashes = Object.fromEntries(["sourceArchive", "patch", "lakeManifest"].map((name,index) => [name, draft.artifacts[index].sha256]));
  const submission = await owner.client.call("submit_prepared_research_submission", { bundle: draft.bundle, artifacts: draft.stageInput.artifacts, expectedArtifactSha256: artifactHashes, expectedBundleHash: draft.manifestHash, runIdempotencyKey: randomUUID(), ownerConfirmation: "I_CONFIRM_STAGE_AND_RUN" });
  assert.equal(submission.submissionState, "bundle_staged_run_requested", JSON.stringify(submission));
  runner = await createLocalAcceptanceRunner({ database: runtime.database, keys, root: join(root,"runner"), imageDigest, dockerImageId, leanToolchain, mathlibRevision: "none", approvedBundleHashes: [draft.manifestHash] });
  const primaryExecution = await runner.executeNext({ runId: submission.run.id });
  const primary = await owner.client.call("get_runner_run", { attemptId, runId: submission.run.id });
  assert.equal(primary.run?.state, "succeeded", JSON.stringify(primary));
  assert.equal(primary.run.attemptId, attemptId);
  assert.equal(primary.run.artifactBundleHash, draft.manifestHash);
  assert.equal(primary.verificationState, "runner_evidence_recorded");
  assert.equal(primaryExecution.runId, submission.run.id);
  assert.equal(primaryExecution.isolationVerified, true);
  onStage({ stage: "primary_run_completed", runId: submission.run.id, state: primary.run?.state });
  await writeFile(join(root,"primary.json"), JSON.stringify({ primary, execution: primaryExecution },null,2), { mode: 0o600 });
  const publishReview = await runtime.personRequest(`/api/me/evidence/bundles/${encodeURIComponent(draft.manifestHash)}/submit-review`, { method: "POST", body: {}, personId: owner.personId });
  assert.equal(publishReview.status, 200, JSON.stringify(publishReview));
  assert.equal(publishReview.body.reviewMarket.published, true);
  const market = await runtime.personRequest("/api/review-jobs");
  assert.equal(market.status, 200);
  const reviewJobs = market.body.jobs.filter(job => job.artifactBundleManifestHash === draft.manifestHash);
  onStage({ stage: "review_published", jobs: reviewJobs.length });
  const projectEvidencePath = join(root, "synthetic-project-acceptance.txt");
  await writeFile(projectEvidencePath, `Synthetic local acceptance of ${draft.manifestHash}\nPinned target: ProofweaveAcceptance.identity\n${source}`, { mode: 0o600 });
  const preview = await owner.client.call("preview_local_evidence", { attemptId, paths: [projectEvidencePath] });
  await owner.client.call("submit_local_evidence", { attemptId, paths: [projectEvidencePath], expectedSha256: [preview.files[0].sha256], ownerConfirmation: "I_CONFIRM_SUBMIT" });
  const reviewResult = await runLocalReviewCreditAcceptance({ origin: runtime.origin, syntheticOwner: true, database: runtime.database, ownerPersonId: owner.personId, reviewerPersonId: reviewer.personId, bundleHash: draft.manifestHash, reviewJobs, projectEvidenceHash: preview.files[0].sha256, callReviewerTool: (name,input) => reviewer.client.call(name,input), personRequest: runtime.personRequest, executeReplay: async ({ queued }) => { assert.ok(queued.run?.id); const result = await runner.executeNext({ runId: queued.run.id }); assert.equal(result.runId, queued.run.id); assert.equal(result.isolationVerified, primaryExecution.isolationVerified); return result; }, confirmPreparedAttestation: async prepared => { assert.equal(prepared.attestation.artifactBundleHash, draft.manifestHash); return true; }, onStage });
  await runtime.setWindowAttempts([]);
  const closedPublish = await runtime.personRequest(`/api/me/evidence/bundles/${encodeURIComponent(draft.manifestHash)}/submit-review`, { method: "POST", body: {}, personId: owner.personId });
  assert.equal(closedPublish.status, 403);
  assert.equal(closedPublish.body.error.code, "research_write_not_allowed");
  await assert.rejects(owner.client.call("publish_prepared_research_checkpoint", { ...checkpoint.publishInput, ownerConfirmation: "I_CONFIRM_PUBLISH_CHECKPOINT" }), /not in the current research write window/);
  onStage({ stage: "window_closed_writes_rejected", participantHttpStatus: 403, mcpRejected: true });
  const report = { schemaVersion: "pw-local-mcp-acceptance-v1", mode: "isolated_test", storageMode: "d1_inline", closedWindowWritesRejected: true, syntheticIdentities: true, independentHumanReview: false, productionAcceptance: false, sourceRevision, sourceDirty, startedAt, completedAt: new Date().toISOString(), origin: runtime.origin, leanToolchain, imageDigest, checkpoint: { id: recordedCheckpoint.id, hash: recordedCheckpoint.checkpointHash, persisted: true }, attemptId, bundleHash: draft.manifestHash, primary: { runId: submission.run.id, execution: primaryExecution }, review: reviewResult, events, transcripts: actors.map(actor => ({ role: actor.role, tools: actor.client.transcript })) };
  await writeFile(join(root, "acceptance-report.json"), JSON.stringify(report,null,2)+"\n", { mode: 0o600 });
  await writeFile(join(root, "client-profiles.json"), JSON.stringify({ origin: runtime.origin, caPath: runtime.caPath, clients: actors.map(({ role,configPath,callbackPort }) => ({ role,configPath,callbackPort })) },null,2), { mode: 0o600 });
  console.log(JSON.stringify({ stage: "acceptance_passed", report: join(root,"acceptance-report.json"), root, origin: runtime.origin, syntheticIdentities: true, productionAcceptance: false }));
  if (args.includes("--keep-open")) await new Promise(resolve => { process.once("SIGINT",resolve); process.once("SIGTERM",resolve); });
} catch (error) {
  console.error(error.stack); process.exitCode = 1;
  if (runtime) {
    const diagnostic = {};
    for (const table of ["verification_assignments", "verification_assignment_events", "verification_attestations", "verification_replays", "verification_replay_evidence"]) {
      try { diagnostic[table] = (await runtime.database.prepare(`SELECT * FROM ${table}`).all()).results; } catch { diagnostic[table] = { unavailable: true }; }
    }
    await writeFile(join(root,"failure-review-evidence.json"), JSON.stringify(diagnostic,null,2), { mode: 0o600 }).catch(() => console.error("Could not persist failure evidence."));
  }
  await writeFile(join(root,"failure.json"), JSON.stringify({ message: error.message, stack: error.stack, events, transcripts: clients.map(client => client.transcript) },null,2), { mode: 0o600 }).catch(() => console.error("Could not persist failure summary."));
} finally {
  const cleanup = await Promise.allSettled([...clients.map(client => client.close()), runner?.close(), runtime?.close()]);
  if (cleanup.some(result => result.status === "rejected")) {
    console.error("Some isolated acceptance resources could not close; inspect this run before retrying.");
    process.exitCode = 1;
  }
}
function option(name) { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; }
function sha256(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
async function unusedPort() { const server=createServer(); await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve)); const port=server.address().port; await new Promise(resolve=>server.close(resolve)); return port; }
