import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { createClient } from "@libsql/client";
import {
  artifactBundleSigningPayload,
  artifactBundleSigningPayloadHash,
} from "../packages/protocol/artifact-bundle.mjs";
import { canonicalJson } from "../packages/protocol/canonical-json.mjs";
import { leanRunnerRequestHash } from "../packages/protocol/lean-runner.mjs";
import { runnerKeyFingerprint } from "../packages/protocol/runner-key-registry.mjs";
import { D1InlineArtifactStore } from "../services/artifacts/d1-inline-artifact-store.mjs";
import { LibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import {
  HostedTrustedRunnerService,
} from "../services/lean-runner/hosted-trusted-runner.mjs";
import { HostedRunnerWakeClient } from "../services/lean-runner/hosted-runner-wake-client.mjs";
import { D1RunnerLeaseQueue } from "../services/lean-runner/d1-runner-lease-queue.mjs";
import { D1RunStore } from "../services/lean-runner/d1-run-store.mjs";
import { PinnedRunnerImageRegistry } from "../services/lean-runner/runner-image-policy.mjs";
import {
  createTrustedRunnerContainerFactoryFromEnvironment,
  createTrustedRunnerRuntime,
} from "../services/lean-runner/trusted-runner-process.mjs";
import { D1RemoteMcpRunnerDispatcher } from "../services/proofweave-mcp-gateway/runner-dispatch.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
const wakeToken = "wake-token-0123456789abcdef-0123456789abcdef";
const imageReference = `registry.example/proofweave/lean-runner@sha256:${"a".repeat(64)}`;
const templateId = "template_proofweave_lean_v1";
const templateTag = "reviewed_runtime_contract";
const templateReference = `${templateId}:${templateTag}`;
const templateBuildId = "9420e83e-3c6d-48b8-94fe-a73807af5797";
const runnerKeyId = "runner-key:github-independent";
const controlPlaneKeyId = "control-plane:github-independent";
const stdout = new TextEncoder().encode("mock E2B transport reached the bounded result boundary\n");
const stderr = new Uint8Array();

test("Render wake drives the durable E2B path with every GitHub environment input absent", async (t) => {
  assert.deepEqual(
    Object.keys(process.env).filter((key) => key.startsWith("GITHUB_")),
    [],
    "the executable contract must run with all GitHub environment inputs removed",
  );
  assert.equal(process.env.PROOFWEAVE_GITHUB_RECOVERY_ENABLED, "false");

  const fixture = await createFixture({ resultMode: "valid" });
  t.after(() => fixture.close());
  const dispatched = await fixture.dispatch();

  assert.equal(dispatched.run.state, "queued");
  assert.deepEqual(dispatched.runnerWake, { state: "wake_accepted" });
  const terminal = await waitForRun(fixture.runStore, dispatched.run.id, "succeeded");
  assert.equal(fixture.provider.createCalls, 1);
  assert.equal(fixture.provider.createOptions.apiKey, fixture.environment.E2B_API_KEY);
  assert.equal(fixture.provider.createOptions.allowInternetAccess, false);
  assert.equal(fixture.provider.createOptions.network.allowPublicTraffic, false);
  assert.equal(JSON.stringify(fixture.provider.createOptions).includes("GITHUB_"), false);

  assert.equal(terminal.artifactBundleHash, fixture.manifestHash);
  assert.equal((await fixture.queue.find(terminal.id)).deliveryState, "acknowledged");
  assert.equal(
    await fixture.database.prepare("SELECT COUNT(*) AS count FROM run_results WHERE run_id = ?")
      .bind(terminal.id).first("count"),
    1,
  );
  const outputs = (await fixture.database.prepare(
    "SELECT role, byte_length FROM runner_output_artifacts WHERE run_id = ? ORDER BY role",
  ).bind(terminal.id).all()).results;
  assert.deepEqual(outputs.map((row) => [row.role, Number(row.byte_length)]), [
    ["stderr", stderr.byteLength],
    ["stdout", stdout.byteLength],
  ]);
  assert.equal(outputs.every((row) => Number(row.byte_length) <= 1_000_000), true);
  assert.equal(fixture.service.lastWakeAt !== null, true);
});

test("invalid E2B result evidence is retried without a signed or terminal projection", async (t) => {
  const fixture = await createFixture({ resultMode: "mismatched" });
  t.after(() => fixture.close());
  const dispatched = await fixture.dispatch();
  assert.deepEqual(dispatched.runnerWake, { state: "wake_accepted" });

  await waitFor(async () => {
    const delivery = await fixture.queue.find(dispatched.run.id);
    return delivery?.deliveryState === "queued" &&
      delivery.lastErrorCode === "runner_container_execute_response_error";
  });
  const run = await fixture.runStore.find(dispatched.run.id);
  assert.equal(run.state, "running");
  assert.equal(run.runnerResultHash, null);
  assert.equal(
    await fixture.database.prepare("SELECT COUNT(*) AS count FROM run_results WHERE run_id = ?")
      .bind(run.id).first("count"),
    0,
  );
  assert.equal(
    await fixture.database.prepare("SELECT COUNT(*) AS count FROM runner_output_artifacts WHERE run_id = ?")
      .bind(run.id).first("count"),
    0,
  );
  assert.equal(fixture.provider.killed, 1);
});

async function createFixture({ resultMode }) {
  const database = new LibsqlD1Database(createClient({ url: "file::memory:" }));
  await applyMigrations(database);
  const [agentKeys, controlPlaneKeys, runnerKeys] = await Promise.all(
    Array.from({ length: 3 }, () => crypto.subtle.generateKey(
      { name: "Ed25519" },
      true,
      ["sign", "verify"],
    )),
  );
  const agentPublicKey = base64Url(await crypto.subtle.exportKey("raw", agentKeys.publicKey));
  const controlPlanePublicKey = base64Url(await crypto.subtle.exportKey("raw", controlPlaneKeys.publicKey));
  const runnerPublicKey = base64Url(await crypto.subtle.exportKey("raw", runnerKeys.publicKey));
  await seedAttempt(database, agentPublicKey);
  await database.prepare(
    "INSERT INTO runner_keys (id, public_key, fingerprint) VALUES (?, ?, ?)",
  ).bind(runnerKeyId, runnerPublicKey, await runnerKeyFingerprint(runnerPublicKey)).run();

  const artifactStore = new D1InlineArtifactStore({ database });
  const archive = await artifactStore.putObject({
    bytes: "bounded source archive fixture",
    filename: "source.tar.zst",
    contentType: "application/zstd",
  });
  const patch = await artifactStore.putObject({
    bytes: "diff --git a/Proofweave/Runtime.lean b/Proofweave/Runtime.lean\n",
    filename: "normalized.patch",
    contentType: "text/x-diff",
  });
  const lakeManifest = await artifactStore.putObject({
    bytes: '{"packages":[]}',
    filename: "lake-manifest.json",
    contentType: "application/json",
  });
  const bundle = await signedBundle({ agentKeys, agentPublicKey, archive, patch, lakeManifest });
  const staged = await artifactStore.stageBundle(bundle);

  const environment = githubFreeEnvironment({
    RUNNER_EXECUTION_ENABLED: "true",
    PROOFWEAVE_RUNNER_PROVIDER: "e2b",
    PROOFWEAVE_RUNNER_WAKE_TOKEN: wakeToken,
    PROOFWEAVE_RUNNER_REVISION: "github-independent-contract",
    RUNNER_CONSUMER_ID: "runner:github-independent",
    RUNNER_POLL_MILLISECONDS: "60000",
    RUNNER_LEASE_SECONDS: "60",
    RUNNER_LEASE_HEARTBEAT_SECONDS: "20",
    RUNNER_RETRY_DELAY_SECONDS: "30",
    RUNNER_MAX_DELIVERY_ATTEMPTS: "2",
    RUNNER_EXECUTION_POLL_MILLISECONDS: "10",
    RUNNER_APPROVED_IMAGES_JSON: JSON.stringify([{
      imageDigest: imageReference,
      leanToolchain: bundle.environment.leanToolchain,
      mathlibRevision: bundle.environment.mathlibRevision,
    }]),
    RUNNER_CONTROL_PLANE_ISSUER_KEYS_JSON: JSON.stringify([{
      id: controlPlaneKeyId,
      publicKey: controlPlanePublicKey,
    }]),
    RUNNER_RESULT_KEY_ID: runnerKeyId,
    RUNNER_RESULT_PRIVATE_KEY_JWK: JSON.stringify(
      await crypto.subtle.exportKey("jwk", runnerKeys.privateKey),
    ),
    E2B_API_KEY: "e2b_runtime_contract_api_key",
    PROOFWEAVE_E2B_TEMPLATE_ID: templateReference,
    PROOFWEAVE_E2B_TEMPLATE_BUILD_ID: templateBuildId,
    PROOFWEAVE_E2B_RUNNER_IMAGE: imageReference,
    PROOFWEAVE_E2B_RESOURCE_POLICY_REVIEWED: "true",
    PROOFWEAVE_E2B_CPU: "2",
    PROOFWEAVE_E2B_MEMORY_MB: "2048",
    PROOFWEAVE_E2B_TIMEOUT_MS: "120000",
    PROOFWEAVE_E2B_STARTUP_TIMEOUT_MS: "5000",
  });
  let clockMilliseconds = Date.parse("2026-07-27T00:00:00.000Z");
  const now = () => new Date(clockMilliseconds += 1_000);
  const provider = fakeE2BProvider();
  const e2bFetcher = createE2BFetcher({
    resultMode,
    now: () => {
      const startedAt = now().toISOString();
      const finishedAt = now().toISOString();
      return { startedAt, finishedAt };
    },
  });
  const containerFactory = createTrustedRunnerContainerFactoryFromEnvironment({
    environment,
    e2bSandboxApi: provider.api,
    e2bTemplateApi: provider.templateApi,
    fetcher: e2bFetcher,
  });
  const runtime = await createTrustedRunnerRuntime({
    database,
    containerFactory,
    environment,
    now,
    emit: () => {},
  });
  const service = new HostedTrustedRunnerService({
    environment: { ...environment, PORT: "0", HOST: "127.0.0.1" },
    runtimeFactory: async () => runtime,
    now,
    emit: () => {},
  });
  await service.start();
  await waitFor(() => service.state === "ready");
  const origin = `http://127.0.0.1:${service.port}`;
  const runnerWake = new HostedRunnerWakeClient({
    url: "https://render-runner.example/v1/wake",
    wakeToken,
    timeoutMilliseconds: 5_000,
    fetcher: (_url, options) => fetch(`${origin}/v1/wake`, options),
  });
  const queue = new D1RunnerLeaseQueue({ database });
  const runStore = new D1RunStore(database);
  const dispatcher = new D1RemoteMcpRunnerDispatcher({
    database,
    artifactStore,
    runnerQueue: queue,
    approvedImages: new PinnedRunnerImageRegistry({
      images: JSON.parse(environment.RUNNER_APPROVED_IMAGES_JSON),
    }),
    controlPlaneKeyId,
    controlPlanePrivateKeyJwk: await crypto.subtle.exportKey("jwk", controlPlaneKeys.privateKey),
    defaultLimits: {
      cpuSeconds: 60,
      wallSeconds: 120,
      memoryMiB: 2_048,
      diskMiB: 1_024,
      outputBytes: 1_000_000,
    },
    runnerWake,
    now,
  });
  return {
    database,
    environment,
    manifestHash: staged.bundle.manifestHash,
    provider,
    queue,
    runStore,
    service,
    async dispatch() {
      return dispatcher.queueBundle({
        attempt: { id: bundle.attemptId, problemRevisionId: bundle.problemRevisionId },
        artifactBundleHash: staged.bundle.manifestHash,
        idempotencyKey: `github-independent-${resultMode}`,
        runId: `run:github-independent-${resultMode}`,
      });
    },
    async close() {
      await service.close();
      database.close();
    },
  };
}

function createE2BFetcher({ resultMode, now }) {
  return async (url, options) => {
    const path = new URL(url).pathname;
    if (path === "/ready") return new Response(null, { status: 204 });
    if (
      path.endsWith("/workspace") ||
      path.includes("/workspace/artifacts/") ||
      path.endsWith("/workspace/finalize") ||
      path.endsWith("/workspace/complete")
    ) {
      return new Response(null, { status: 204 });
    }
    if (path.endsWith("/workspace/execute")) {
      const request = JSON.parse(await new Response(options.body).text());
      const requestHash = await leanRunnerRequestHash(request);
      const { startedAt, finishedAt } = now();
      return jsonResponse({
        result: {
          protocolVersion: "pw-lean-runner-v1",
          jobId: request.jobId,
          attemptId: request.attemptId,
          requestHash: resultMode === "valid" ? requestHash : sha("f"),
          status: "succeeded",
          exitCode: 0,
          startedAt,
          finishedAt,
          kernelStatus: "accepted",
          checks: {
            network: "passed",
            noSorry: "passed",
            allowedAxioms: "passed",
            leanBuild: "passed",
          },
          artifacts: {
            manifestHash: request.bundle.manifestHash,
            stdoutHash: await sha256(stdout),
            stderrHash: await sha256(stderr),
          },
        },
        outputTruncated: false,
        workspaceTreeHash: sha("b"),
      });
    }
    if (path.endsWith("/workspace/result/stdout")) return outputResponse(stdout);
    if (path.endsWith("/workspace/result/stderr")) return outputResponse(stderr);
    return new Response(null, { status: 404 });
  };
}

function fakeE2BProvider() {
  const state = {
    createCalls: 0,
    createOptions: null,
    killed: 0,
  };
  state.templateApi = {
    async getTags(requestedTemplateId) {
      assert.equal(requestedTemplateId, templateId);
      return [{ tag: templateTag, buildId: templateBuildId }];
    },
  };
  state.api = {
    async create(requestedTemplate, options) {
      state.createCalls += 1;
      state.createOptions = options;
      assert.equal(requestedTemplate, templateReference);
      return {
        trafficAccessToken: "e2b-private-traffic-token",
        commands: { async run() { return { pid: 17 }; } },
        getHost(port) { return `${port}-sandbox.e2b.test`; },
        async getInfo() {
          return {
            templateId,
            allowInternetAccess: false,
            cpuCount: 2,
            memoryMB: 2_048,
            network: { allowPublicTraffic: false },
          };
        },
        async kill() {
          state.killed += 1;
          return true;
        },
      };
    },
  };
  return state;
}

async function signedBundle({ agentKeys, agentPublicKey, archive, patch, lakeManifest }) {
  const bundle = {
    protocolVersion: "pw-artifact-bundle-v2",
    id: "bundle:github-independent",
    attemptId: "attempt:github-independent",
    problemRevisionId: "revision:github-independent",
    target: {
      declaration: "Proofweave.GitHubIndependent.target",
      statementHash: sha("1"),
    },
    workspace: {
      archive: {
        objectKey: archive.objectKey,
        contentHash: archive.contentHash,
        format: "tar.zst",
        maxExpandedBytes: 64 * 1024 * 1024,
        maxFileCount: 10_000,
        symlinkPolicy: "forbidden",
      },
      patch: {
        objectKey: patch.objectKey,
        contentHash: patch.contentHash,
        format: "unified-diff",
        strip: 1,
        allowFuzz: false,
      },
      tree: {
        hash: sha("2"),
        algorithm: "pw-tree-v1",
        state: "after_patch_and_lake_manifest",
      },
      lakeManifest: {
        objectKey: lakeManifest.objectKey,
        contentHash: lakeManifest.contentHash,
        destination: "lake-manifest.json",
      },
    },
    environment: {
      leanToolchain: "leanprover/lean4:v4.27.0",
      mathlibRevision: "runtime-contract-mathlib",
    },
    entryCommand: ["lake", "env", "lean", "Proofweave/Runtime.lean"],
    dependencyReceipts: [],
    agentEvent: {
      eventId: "agent-event:github-independent",
      occurredAt: "2026-07-27T00:00:00Z",
      payloadHash: sha("0"),
      agentPublicKey,
      signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    },
    policy: { requireNoSorry: true, allowedAxioms: [] },
  };
  bundle.agentEvent.payloadHash = await artifactBundleSigningPayloadHash(bundle);
  bundle.agentEvent.signature = base64Url(await crypto.subtle.sign(
    "Ed25519",
    agentKeys.privateKey,
    new TextEncoder().encode(canonicalJson(artifactBundleSigningPayload(bundle))),
  ));
  return bundle;
}

async function seedAttempt(database, agentPublicKey) {
  const statements = [
    [
      "INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)",
      ["person:github-independent", "proofweave", "github-independent", "Runtime Contract", "2026-07-27T00:00:00Z"],
    ],
    [
      `INSERT INTO source_snapshots (
        id, upstream_name, source_url, revision_tag, revision_commit, retrieved_at,
        content_hash, manifest_hash, source_license, lean_toolchain, mathlib_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["snapshot:github-independent", "fixture", "https://example.test/source", "v1", "abc123", "2026-07-27T00:00:00Z", sha("3"), sha("4"), "MIT", "leanprover/lean4:v4.27.0", "runtime-contract-mathlib"],
    ],
    [
      "INSERT INTO projects (id, slug, kind, title, summary) VALUES (?, ?, ?, ?, ?)",
      ["project:github-independent", "github-independent", "frontier", "Runtime Contract", "Fixture project"],
    ],
    [
      `INSERT INTO problem_revisions (
        id, project_id, source_snapshot_id, target_key, slug, revision_number,
        title, domain, research_status, informal_statement, lean_statement
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["revision:github-independent", "project:github-independent", "snapshot:github-independent", "runtime-target", "runtime-target", 1, "Runtime target", "logic", "research_open", "fixture", "theorem fixture : True := by trivial"],
    ],
    [
      "INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)",
      ["person-key:github-independent", "person:github-independent", "person-key", sha("5")],
    ],
    [
      "INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)",
      ["agent:github-independent", "person:github-independent", "Runtime Agent", agentPublicKey, sha("6")],
    ],
    [
      `INSERT INTO delegation_certificates (
        id, owner_person_id, agent_id, person_key_id, agent_public_key,
        scopes_json, valid_from, valid_until, beneficiary_person_id,
        protocol_version, payload_hash, canonical_payload, person_signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["delegation:github-independent", "person:github-independent", "agent:github-independent", "person-key:github-independent", agentPublicKey, '["prove"]', "2026-07-01T00:00:00Z", "2027-07-01T00:00:00Z", "person:github-independent", "pw-delegation-v1", sha("7"), "{}", "signature"],
    ],
    [
      `INSERT INTO agent_attempts (
        id, person_id, problem_revision_id, agent_id, delegation_certificate_id,
        delegation_scope, agent_label, idempotency_key, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["attempt:github-independent", "person:github-independent", "revision:github-independent", "agent:github-independent", "delegation:github-independent", "prove", "Runtime Agent", "attempt-github-independent", "2026-07-27T00:00:00Z"],
    ],
  ];
  for (const [statement, values] of statements) {
    await database.prepare(statement).bind(...values).run();
  }
}

async function applyMigrations(database) {
  const filenames = (await readdir(migrationsRoot)).filter((filename) => filename.endsWith(".sql")).sort();
  for (const filename of filenames) {
    const source = await readFile(new URL(filename, migrationsRoot), "utf8");
    for (const statement of source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await database.prepare(statement).run();
    }
  }
}

function githubFreeEnvironment(overrides) {
  const environment = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (!key.startsWith("GITHUB_")) environment[key] = value;
  }
  environment.PROOFWEAVE_GITHUB_RECOVERY_ENABLED = "false";
  return environment;
}

async function waitForRun(store, runId, state) {
  let result;
  await waitFor(async () => {
    result = await store.find(runId);
    return result?.state === state;
  });
  return result;
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("GitHub-independent runtime condition was not reached.");
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function outputResponse(bytes) {
  return new Response(bytes, {
    status: 200,
    headers: { "x-proofweave-content-sha256": await sha256(bytes) },
  });
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}

function base64Url(buffer) {
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
