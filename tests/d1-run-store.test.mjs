import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { D1RunStore } from "../services/lean-runner/d1-run-store.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
let miniflare;
let database;

before(async () => {
  miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
  });
  database = await miniflare.getD1Database("DB");
  await applyMigrations(database);
  await seedAttempt(database);
});

after(async () => {
  await miniflare?.dispose();
});

test("D1 Run store persists an idempotent lifecycle with immutable evidence", async () => {
  const store = new D1RunStore(database);
  const queued = await store.queue(fixtureRun());
  const retried = await store.queue({ ...fixtureRun(), id: "run:ignored-on-retry" });
  assert.equal(queued.created, true);
  assert.equal(retried.created, false);
  assert.equal(retried.run.id, "run:fixture-1");

  const running = await store.start("run:fixture-1", "2026-07-13T00:00:01Z");
  const cancelling = await store.requestCancellation("run:fixture-1", "2026-07-13T00:00:02Z");
  assert.equal((await store.requestCancellation("run:fixture-1", "2026-07-13T00:00:02Z")).state, "cancel_requested");
  const cancelled = await store.recordResult(
    "run:fixture-1",
    fixtureResult(),
    "2026-07-13T00:00:04Z",
  );

  assert.equal(running.state, "running");
  assert.equal(cancelling.state, "cancel_requested");
  assert.equal(cancelled.state, "cancelled");
  assert.match(cancelled.runnerResultHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal((await store.recordResult("run:fixture-1", fixtureResult(), "2026-07-13T00:00:04Z")).state, "cancelled");

  const events = await store.listEvents("run:fixture-1");
  assert.deepEqual(events.map((event) => event.eventType), [
    "run_queued",
    "run_started",
    "cancellation_requested",
    "runner_result_recorded",
  ]);
  assert.equal(events.every((event) => /^sha256:[a-f0-9]{64}$/.test(event.payloadHash)), true);

  await assert.rejects(
    database.prepare("UPDATE runs SET request_hash = ? WHERE id = ?").bind(sha("0"), "run:fixture-1").run(),
    /run identity is immutable/,
  );
  await assert.rejects(
    database.prepare("UPDATE run_events SET state = ? WHERE run_id = ?").bind("failed", "run:fixture-1").run(),
    /run events are immutable/,
  );
  await assert.rejects(
    database.prepare("UPDATE run_results SET received_at = ? WHERE run_id = ?").bind("2026-07-14T00:00:00Z", "run:fixture-1").run(),
    /run results are immutable/,
  );
});

function fixtureRun() {
  return {
    id: "run:fixture-1",
    attemptId: "attempt:run-test",
    idempotencyKey: "run-idempotency-1",
    requestHash: sha("a"),
    artifactBundleHash: sha("b"),
    queuedAt: "2026-07-13T00:00:00Z",
  };
}

function fixtureResult() {
  return {
    protocolVersion: "pw-lean-runner-v1",
    jobId: "run:fixture-1",
    attemptId: "attempt:run-test",
    requestHash: sha("a"),
    status: "cancelled",
    exitCode: 137,
    startedAt: "2026-07-13T00:00:01Z",
    finishedAt: "2026-07-13T00:00:03Z",
    kernelStatus: "not_run",
    checks: { network: "passed", noSorry: "not_run", allowedAxioms: "not_run", leanBuild: "not_run" },
    artifacts: { manifestHash: sha("b"), stdoutHash: sha("c"), stderrHash: sha("d") },
  };
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}

async function seedAttempt(d1) {
  const statements = [
    [
      `INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      ["person:run-test", "proofweave", "run-test", "Run Test", "2026-07-13T00:00:00Z"],
    ],
    [
      `INSERT INTO source_snapshots (
        id, upstream_name, source_url, revision_tag, revision_commit, retrieved_at,
        content_hash, manifest_hash, source_license, lean_toolchain, mathlib_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "snapshot:run-test", "fixture", "https://example.test/source", "v1", "abc123",
        "2026-07-13T00:00:00Z", sha("1"), sha("2"), "MIT", "leanprover/lean4:v4.27.0", "abc123",
      ],
    ],
    [
      "INSERT INTO projects (id, slug, kind, title, summary) VALUES (?, ?, ?, ?, ?)",
      ["project:run-test", "run-test", "frontier", "Run Test", "Fixture project"],
    ],
    [
      `INSERT INTO problem_revisions (
        id, project_id, source_snapshot_id, target_key, slug, revision_number,
        title, domain, research_status, informal_statement, lean_statement
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "revision:run-test", "project:run-test", "snapshot:run-test", "run-test-target", "run-test-target", 1,
        "Run target", "logic", "research_open", "fixture", "theorem fixture : True := by trivial",
      ],
    ],
    [
      `INSERT INTO agent_attempts (
        id, person_id, problem_revision_id, agent_label, idempotency_key, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      ["attempt:run-test", "person:run-test", "revision:run-test", "Run Agent", "attempt-run-test", "2026-07-13T00:00:00Z"],
    ],
  ];

  for (const [statement, values] of statements) {
    await d1.prepare(statement).bind(...values).run();
  }
}

async function applyMigrations(d1) {
  const filenames = (await readdir(migrationsRoot))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  for (const filename of filenames) {
    const source = await readFile(new URL(filename, migrationsRoot), "utf8");
    for (const statement of source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await d1.prepare(statement).run();
    }
  }
}
