import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { D1RunStore } from "../services/lean-runner/d1-run-store.mjs";
import { D1R2RunnerOutputStore } from "../services/lean-runner/d1-r2-runner-output-store.mjs";
import { runnerResultSigningPayload } from "../packages/protocol/lean-runner.mjs";
import { canonicalJson, sha256Canonical } from "../packages/protocol/canonical-json.mjs";
import { runnerKeyFingerprint } from "../packages/protocol/runner-key-registry.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
let miniflare;
let database;
let bucket;
let runnerKeyPair;
let runnerPublicKey;
let runnerStdout;
let runnerStderr;
let runnerStdoutHash;
let runnerStderrHash;

before(async () => {
  runnerKeyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  runnerPublicKey = base64Url(await crypto.subtle.exportKey("raw", runnerKeyPair.publicKey));
  miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
    r2Buckets: ["ARTIFACTS"],
  });
  database = await miniflare.getD1Database("DB");
  bucket = await miniflare.getR2Bucket("ARTIFACTS");
  runnerStdout = new TextEncoder().encode("Lean fixture output\n");
  runnerStderr = new Uint8Array();
  runnerStdoutHash = await sha256Bytes(runnerStdout);
  runnerStderrHash = await sha256Bytes(runnerStderr);
  await applyMigrations(database);
  await seedAttempt(database, runnerPublicKey);
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
  assert.equal(
    (await store.findByAttemptIdempotency("attempt:run-test", "run-idempotency-1"))?.id,
    "run:fixture-1",
  );

  const preparing = await store.prepare("run:fixture-1", "2026-07-13T00:00:01Z");
  const running = await store.start("run:fixture-1", "2026-07-13T00:00:02Z");
  const outputStore = new D1R2RunnerOutputStore({ database, bucket });
  const cancelling = await store.requestCancellation("run:fixture-1", "2026-07-13T00:00:03Z");
  const cancellationReplay = await store.requestCancellation("run:fixture-1", "2026-07-13T00:00:09Z");
  assert.equal(cancellationReplay.state, "cancel_requested");
  assert.equal(cancellationReplay.cancelRequestedAt, "2026-07-13T00:00:03Z");
  const invalidResult = await fixtureResult();
  invalidResult.runnerSignature = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  await assert.rejects(
    store.recordResult("run:fixture-1", invalidResult, "2026-07-13T00:00:04Z"),
    /Runner result signature is invalid/,
  );
  const result = await fixtureResult();
  await assert.rejects(
    store.recordResult("run:fixture-1", result, "2026-07-13T00:00:04Z"),
    /not backed by immutable Runner output artifacts/,
  );
  await database.prepare("UPDATE runner_keys SET fingerprint = ? WHERE id = ?").bind(sha("6"), "runner-key:run-test").run();
  await assert.rejects(
    store.recordResult("run:fixture-1", result, "2026-07-13T00:00:04Z"),
    /fingerprint does not match/,
  );
  await database.prepare("UPDATE runner_keys SET fingerprint = ? WHERE id = ?").bind(await runnerKeyFingerprint(runnerPublicKey), "runner-key:run-test").run();
  const unsignedResult = { ...result };
  delete unsignedResult.runnerKeyId;
  delete unsignedResult.runnerSignature;
  const persistedOutput = await outputStore.persist({
    run: cancelling,
    execution: { result: unsignedResult, stdout: runnerStdout, stderr: runnerStderr },
  });
  assert.equal(persistedOutput.stdout.created, true);
  assert.equal((await outputStore.persist({
    run: cancelling,
    execution: { result: unsignedResult, stdout: runnerStdout, stderr: runnerStderr },
  })).stdout.created, false);
  assert.equal((await bucket.get(persistedOutput.stdout.objectKey)).customMetadata.sha256, runnerStdoutHash);
  const cancelled = await store.recordResult(
    "run:fixture-1",
    result,
    "2026-07-13T00:00:04Z",
  );

  assert.equal(preparing.state, "preparing");
  assert.equal(running.state, "running");
  assert.equal(cancelling.state, "cancel_requested");
  assert.equal(cancelled.state, "cancelled");
  assert.match(cancelled.runnerResultHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal((await store.recordResult("run:fixture-1", result, "2026-07-13T00:00:04Z")).state, "cancelled");

  const events = await store.listEvents("run:fixture-1");
  assert.deepEqual(events.map((event) => event.eventType), [
    "run_queued",
    "workspace_preparation_started",
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
  await assert.rejects(
    database.prepare("UPDATE runner_output_artifacts SET content_hash = ? WHERE run_id = ? AND role = ?").bind(sha("0"), "run:fixture-1", "stdout").run(),
    /runner output artifacts are immutable/,
  );
});

test("D1 Run store atomically rolls back a projection when its immutable event conflicts", async () => {
  const store = new D1RunStore(database);
  const input = fixtureRun({ id: "run:atomic-conflict", idempotencyKey: "run-atomic-conflict" });
  await store.queue(input);
  await database.prepare(
    `INSERT INTO run_events (
      id, run_id, sequence, event_type, state, payload_hash, canonical_payload, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    `run-event:${input.id}:workspace-preparing`,
    input.id,
    2,
    "workspace_preparation_started",
    "preparing",
    sha("f"),
    "{}",
    "2026-07-13T00:01:00Z",
  ).run();

  await assert.rejects(
    store.prepare(input.id, "2026-07-13T00:01:00Z"),
    /different canonical evidence|state changed/,
  );
  assert.equal((await store.find(input.id)).state, "queued");
});

test("D1 Run store repairs a canonical event omitted by an older projection writer", async () => {
  const store = new D1RunStore(database);
  const input = fixtureRun({ id: "run:legacy-repair", idempotencyKey: "run-legacy-repair" });
  const preparingAt = "2026-07-13T00:02:00Z";
  await store.queue(input);
  await database.prepare(
    `UPDATE runs
     SET state = 'preparing', preparing_at = ?, updated_at = ?
     WHERE id = ? AND state = 'queued'`,
  ).bind(preparingAt, preparingAt, input.id).run();

  const repaired = await store.prepare(input.id, preparingAt);
  assert.equal(repaired.state, "preparing");
  assert.deepEqual((await store.listEvents(input.id)).map((event) => event.eventType), [
    "run_queued",
    "workspace_preparation_started",
  ]);
  assert.equal((await store.listEvents(input.id))[1].sequence, 2);
});

test("D1 Run store repairs a missing canonical queue event on idempotent retry", async () => {
  const store = new D1RunStore(database);
  const input = fixtureRun({ id: "run:legacy-queue-repair", idempotencyKey: "run-legacy-queue-repair" });
  await database.prepare(
    `INSERT INTO runs (
      id, attempt_id, artifact_bundle_hash, request_hash, idempotency_key,
      state, queued_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`,
  ).bind(
    input.id,
    input.attemptId,
    input.artifactBundleHash,
    input.requestHash,
    input.idempotencyKey,
    input.queuedAt,
    input.queuedAt,
  ).run();

  const retried = await store.queue(input);
  assert.equal(retried.created, false);
  assert.deepEqual((await store.listEvents(input.id)).map((event) => [event.eventType, event.sequence]), [
    ["run_queued", 1],
  ]);
});

test("D1 Run store refuses late run_queued repair for preparing, running, and terminal projections", async () => {
  const store = new D1RunStore(database);
  const cases = [
    {
      suffix: "preparing",
      state: "preparing",
      preparingAt: "2026-07-13T00:04:01Z",
      startedAt: null,
      finishedAt: null,
      resultHash: null,
    },
    {
      suffix: "running",
      state: "running",
      preparingAt: "2026-07-13T00:05:01Z",
      startedAt: "2026-07-13T00:05:02Z",
      finishedAt: null,
      resultHash: null,
    },
    {
      suffix: "terminal",
      state: "succeeded",
      preparingAt: "2026-07-13T00:06:01Z",
      startedAt: "2026-07-13T00:06:02Z",
      finishedAt: "2026-07-13T00:06:03Z",
      resultHash: sha("9"),
    },
  ];
  for (const current of cases) {
    const input = fixtureRun({
      id: `run:late-queue-${current.suffix}`,
      idempotencyKey: `run-late-queue-${current.suffix}`,
    });
    await database.prepare(
      `INSERT INTO runs (
        id, attempt_id, artifact_bundle_hash, request_hash, idempotency_key,
        state, queued_at, preparing_at, started_at, finished_at,
        runner_result_hash, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.id,
      input.attemptId,
      input.artifactBundleHash,
      input.requestHash,
      input.idempotencyKey,
      current.state,
      input.queuedAt,
      current.preparingAt,
      current.startedAt,
      current.finishedAt,
      current.resultHash,
      current.finishedAt ?? current.startedAt ?? current.preparingAt,
    ).run();

    await assert.rejects(
      store.queue(input),
      /only for a pristine queued Run with no later history/,
    );
    assert.equal((await store.listEvents(input.id)).length, 0);
  }
});

test("D1 Run store converges concurrent canonical retries to one immutable event", async () => {
  const store = new D1RunStore(database);
  const input = fixtureRun({ id: "run:concurrent-retry", idempotencyKey: "run-concurrent-retry" });
  const preparingAt = "2026-07-13T00:03:00Z";
  await store.queue(input);
  const transitions = await Promise.all([
    store.prepare(input.id, preparingAt),
    store.prepare(input.id, preparingAt),
  ]);

  assert.equal(transitions.every((run) => run.state === "preparing"), true);
  assert.deepEqual((await store.listEvents(input.id)).map((event) => event.eventType), [
    "run_queued",
    "workspace_preparation_started",
  ]);
});

test("D1 Run store repairs canonical result evidence from active and terminal legacy projections", async () => {
  const store = new D1RunStore(database);
  for (const [suffix, terminal] of [["active", false], ["terminal", true]]) {
    const runId = `run:result-repair-${suffix}`;
    const input = fixtureRun({ id: runId, idempotencyKey: `run-result-repair-${suffix}` });
    await store.queue(input);
    await store.prepare(runId, "2026-07-13T00:10:01Z");
    await store.start(runId, "2026-07-13T00:10:02Z");
    const result = await fixtureResult({
      runId,
      startedAt: "2026-07-13T00:10:02Z",
      finishedAt: "2026-07-13T00:10:03Z",
      status: "succeeded",
    });
    await persistOutput(store, runId, result);
    const resultHash = await sha256Canonical(result);
    const receivedAt = "2026-07-13T00:10:04Z";
    await database.prepare(
      "INSERT INTO run_results (run_id, result_hash, canonical_result, received_at) VALUES (?, ?, ?, ?)",
    ).bind(runId, resultHash, canonicalJson(result), receivedAt).run();
    if (terminal) {
      await database.prepare(
        `UPDATE runs
         SET state = 'succeeded', finished_at = ?, runner_result_hash = ?, updated_at = ?
         WHERE id = ? AND state = 'running'`,
      ).bind(result.finishedAt, resultHash, receivedAt, runId).run();
    }

    const repaired = await store.recordResult(runId, result, "2026-07-13T00:10:09Z");
    assert.equal(repaired.runnerResultHash, resultHash);
    assert.equal((await store.recordResult(runId, result, "2026-07-13T00:10:10Z")).runnerResultHash, resultHash);
    assert.equal((await database
      .prepare("SELECT updated_at FROM runs WHERE id = ?")
      .bind(runId)
      .first())?.updated_at, receivedAt);
    assert.deepEqual(
      (await store.listEvents(runId)).map((event) => [event.sequence, event.eventType, event.occurredAt]),
      [
        [1, "run_queued", "2026-07-13T00:00:00Z"],
        [2, "workspace_preparation_started", "2026-07-13T00:10:01Z"],
        [3, "run_started", "2026-07-13T00:10:02Z"],
        [4, "runner_result_recorded", receivedAt],
      ],
    );
    assert.equal(
      (await store.listEvents(runId)).filter((event) => event.eventType === "runner_result_recorded").length,
      1,
    );
  }
});

test("D1 Run store rejects unsafe immutable timing before legacy result repair", async () => {
  const store = new D1RunStore(database);

  const earlyRunId = "run:result-repair-early-received";
  await store.queue(fixtureRun({ id: earlyRunId, idempotencyKey: "run-result-repair-early-received" }));
  await store.prepare(earlyRunId, "2026-07-13T00:14:01Z");
  await store.start(earlyRunId, "2026-07-13T00:14:02Z");
  const earlyResult = await fixtureResult({
    runId: earlyRunId,
    startedAt: "2026-07-13T00:14:02Z",
    finishedAt: "2026-07-13T00:14:04Z",
    status: "succeeded",
  });
  await persistOutput(store, earlyRunId, earlyResult);
  const earlyResultHash = await sha256Canonical(earlyResult);
  await database.prepare(
    "INSERT INTO run_results (run_id, result_hash, canonical_result, received_at) VALUES (?, ?, ?, ?)",
  ).bind(
    earlyRunId,
    earlyResultHash,
    canonicalJson(earlyResult),
    "2026-07-13T00:14:03Z",
  ).run();
  const earlyProjectionBefore = await database.prepare("SELECT * FROM runs WHERE id = ?").bind(earlyRunId).first();
  const earlyEventsBefore = await store.listEvents(earlyRunId);

  await assert.rejects(
    store.recordResult(earlyRunId, earlyResult, "2026-07-13T00:14:06Z"),
    /Stored Runner result receivedAt precedes its signed finish time/,
  );
  assert.deepEqual(
    await database.prepare("SELECT * FROM runs WHERE id = ?").bind(earlyRunId).first(),
    earlyProjectionBefore,
  );
  assert.deepEqual(await store.listEvents(earlyRunId), earlyEventsBefore);

  const invalidRunId = "run:result-repair-invalid-received";
  await store.queue(fixtureRun({ id: invalidRunId, idempotencyKey: "run-result-repair-invalid-received" }));
  await store.prepare(invalidRunId, "2026-07-13T00:15:01Z");
  await store.start(invalidRunId, "2026-07-13T00:15:02Z");
  const invalidResult = await fixtureResult({
    runId: invalidRunId,
    startedAt: "2026-07-13T00:15:02Z",
    finishedAt: "2026-07-13T00:15:03Z",
    status: "succeeded",
  });
  await persistOutput(store, invalidRunId, invalidResult);
  const invalidResultHash = await sha256Canonical(invalidResult);
  const invalidReceivedAt = "not-an-instant";
  await database.prepare(
    "INSERT INTO run_results (run_id, result_hash, canonical_result, received_at) VALUES (?, ?, ?, ?)",
  ).bind(invalidRunId, invalidResultHash, canonicalJson(invalidResult), invalidReceivedAt).run();
  await database.prepare(
    `UPDATE runs
     SET state = 'succeeded', finished_at = ?, runner_result_hash = ?, updated_at = ?
     WHERE id = ? AND state = 'running'`,
  ).bind(invalidResult.finishedAt, invalidResultHash, invalidReceivedAt, invalidRunId).run();
  const invalidProjectionBefore = await database.prepare("SELECT * FROM runs WHERE id = ?").bind(invalidRunId).first();
  const invalidEventsBefore = await store.listEvents(invalidRunId);

  await assert.rejects(
    store.recordResult(invalidRunId, invalidResult, "2026-07-13T00:15:06Z"),
    /Stored Runner result receivedAt is not a valid ISO-8601 UTC instant/,
  );
  assert.deepEqual(
    await database.prepare("SELECT * FROM runs WHERE id = ?").bind(invalidRunId).first(),
    invalidProjectionBefore,
  );
  assert.deepEqual(await store.listEvents(invalidRunId), invalidEventsBefore);
});

test("D1 Run store refuses legacy result repair after a later cancellation transition", async () => {
  const store = new D1RunStore(database);
  const runId = "run:result-repair-after-cancellation";
  await store.queue(fixtureRun({ id: runId, idempotencyKey: "run-result-repair-after-cancellation" }));
  await store.prepare(runId, "2026-07-13T00:13:01Z");
  await store.start(runId, "2026-07-13T00:13:02Z");
  const result = await fixtureResult({
    runId,
    startedAt: "2026-07-13T00:13:02Z",
    finishedAt: "2026-07-13T00:13:03Z",
    status: "succeeded",
  });
  await persistOutput(store, runId, result);
  const resultHash = await sha256Canonical(result);
  const receivedAt = "2026-07-13T00:13:04Z";
  await database.prepare(
    "INSERT INTO run_results (run_id, result_hash, canonical_result, received_at) VALUES (?, ?, ?, ?)",
  ).bind(runId, resultHash, canonicalJson(result), receivedAt).run();

  await store.requestCancellation(runId, "2026-07-13T00:13:05Z");
  await assert.rejects(
    store.recordResult(runId, result, "2026-07-13T00:13:06Z"),
    /projection transition later than its immutable receivedAt/,
  );

  const projection = await database
    .prepare("SELECT state, runner_result_hash, updated_at FROM runs WHERE id = ?")
    .bind(runId)
    .first();
  assert.equal(projection?.state, "cancel_requested");
  assert.equal(projection?.runner_result_hash, null);
  assert.equal(projection?.updated_at, "2026-07-13T00:13:05Z");
  assert.deepEqual(
    (await store.listEvents(runId)).map((event) => [event.sequence, event.eventType, event.occurredAt]),
    [
      [1, "run_queued", "2026-07-13T00:00:00Z"],
      [2, "workspace_preparation_started", "2026-07-13T00:13:01Z"],
      [3, "run_started", "2026-07-13T00:13:02Z"],
      [4, "cancellation_requested", "2026-07-13T00:13:05Z"],
    ],
  );
});

test("D1 Run store rolls back result bytes when result event or projection ownership conflicts", async () => {
  const store = new D1RunStore(database);
  const conflictId = "run:result-event-conflict";
  await store.queue(fixtureRun({ id: conflictId, idempotencyKey: "run-result-event-conflict" }));
  await store.prepare(conflictId, "2026-07-13T00:11:01Z");
  await store.start(conflictId, "2026-07-13T00:11:02Z");
  const conflictResult = await fixtureResult({
    runId: conflictId,
    startedAt: "2026-07-13T00:11:02Z",
    finishedAt: "2026-07-13T00:11:03Z",
    status: "succeeded",
  });
  await persistOutput(store, conflictId, conflictResult);
  await database.prepare(
    `INSERT INTO run_events (
      id, run_id, sequence, event_type, state, payload_hash, canonical_payload, occurred_at
    ) VALUES (?, ?, 4, 'runner_result_recorded', 'succeeded', ?, '{}', ?)`,
  ).bind(
    `run-event:${conflictId}:runner-result`,
    conflictId,
    sha("e"),
    "2026-07-13T00:11:04Z",
  ).run();
  await assert.rejects(
    store.recordResult(conflictId, conflictResult, "2026-07-13T00:11:04Z"),
    /state changed|different canonical evidence/,
  );
  assert.equal((await store.find(conflictId)).state, "running");
  assert.equal(
    await database.prepare("SELECT result_hash FROM run_results WHERE run_id = ?").bind(conflictId).first(),
    null,
  );

  const raceId = "run:result-cancel-race";
  await store.queue(fixtureRun({ id: raceId, idempotencyKey: "run-result-cancel-race" }));
  await store.prepare(raceId, "2026-07-13T00:12:01Z");
  await store.start(raceId, "2026-07-13T00:12:02Z");
  const raceResult = await fixtureResult({
    runId: raceId,
    startedAt: "2026-07-13T00:12:02Z",
    finishedAt: "2026-07-13T00:12:03Z",
    status: "succeeded",
  });
  await persistOutput(store, raceId, raceResult);
  let cancellationInjected = false;
  const racingStore = new D1RunStore({
    prepare: (...args) => database.prepare(...args),
    batch: async (statements) => {
      if (!cancellationInjected) {
        cancellationInjected = true;
        await store.requestCancellation(raceId, "2026-07-13T00:12:03Z");
      }
      return database.batch(statements);
    },
  });
  await assert.rejects(
    racingStore.recordResult(raceId, raceResult, "2026-07-13T00:12:04Z"),
    /state changed/,
  );
  const projection = await store.find(raceId);
  const storedResult = await database
    .prepare("SELECT result_hash FROM run_results WHERE run_id = ?")
    .bind(raceId)
    .first();
  const resultEvents = (await store.listEvents(raceId))
    .filter((event) => event.eventType === "runner_result_recorded");
  assert.equal(cancellationInjected, true);
  assert.equal(projection.state, "cancel_requested");
  assert.equal(projection.runnerResultHash, null);
  assert.equal(storedResult, null);
  assert.equal(resultEvents.length, 0);
});

test("D1 Run store repairs cancellation events from queued, preparing, and running projections", async () => {
  const store = new D1RunStore(database);
  for (const [suffix, priorState, terminalState] of [
    ["queued", "queued", "cancelled"],
    ["preparing", "preparing", "cancelled"],
    ["running", "running", "cancel_requested"],
  ]) {
    const runId = `run:cancel-repair-${suffix}`;
    const input = fixtureRun({ id: runId, idempotencyKey: `run-cancel-repair-${suffix}` });
    const requestedAt = `2026-07-13T00:2${suffix === "queued" ? 0 : suffix === "preparing" ? 1 : 2}:03Z`;
    await store.queue(input);
    if (priorState !== "queued") await store.prepare(runId, "2026-07-13T00:20:01Z");
    if (priorState === "running") await store.start(runId, "2026-07-13T00:20:02Z");
    await database.prepare(
      `UPDATE runs
       SET state = ?, cancel_requested_at = ?, finished_at = ?, updated_at = ?
       WHERE id = ? AND state = ?`,
    ).bind(
      terminalState,
      requestedAt,
      terminalState === "cancelled" ? requestedAt : null,
      requestedAt,
      runId,
      priorState,
    ).run();

    const repaired = await store.requestCancellation(runId, "2026-07-13T00:29:59Z");
    assert.equal(repaired.state, terminalState);
    assert.equal(repaired.cancelRequestedAt, requestedAt);
    assert.equal(
      (await store.listEvents(runId)).filter((event) =>
        ["run_cancelled", "cancellation_requested"].includes(event.eventType)).length,
      1,
    );
  }
});

test("D1 Run store repairs a missing start event and rejects a conflicting one", async () => {
  const store = new D1RunStore(database);
  const repairId = "run:start-repair";
  const startedAt = "2026-07-13T00:30:02Z";
  await store.queue(fixtureRun({ id: repairId, idempotencyKey: "run-start-repair" }));
  await store.prepare(repairId, "2026-07-13T00:30:01Z");
  await database.prepare(
    "UPDATE runs SET state = 'running', started_at = ?, updated_at = ? WHERE id = ? AND state = 'preparing'",
  ).bind(startedAt, startedAt, repairId).run();
  assert.equal((await store.start(repairId, startedAt)).state, "running");
  assert.equal((await store.listEvents(repairId)).at(-1).eventType, "run_started");

  const conflictId = "run:start-conflict";
  await store.queue(fixtureRun({ id: conflictId, idempotencyKey: "run-start-conflict" }));
  await store.prepare(conflictId, "2026-07-13T00:31:01Z");
  await database.prepare(
    `INSERT INTO run_events (
      id, run_id, sequence, event_type, state, payload_hash, canonical_payload, occurred_at
    ) VALUES (?, ?, 3, 'run_started', 'running', ?, '{}', ?)`,
  ).bind(`run-event:${conflictId}:started`, conflictId, sha("d"), "2026-07-13T00:31:02Z").run();
  await assert.rejects(
    store.start(conflictId, "2026-07-13T00:31:02Z"),
    /state changed|different canonical evidence/,
  );
  assert.equal((await store.find(conflictId)).state, "preparing");
});

test("D1 Run store never appends a missing cancellation event after terminal result evidence", async () => {
  const store = new D1RunStore(database);
  const runId = "run:late-cancellation-after-result";
  await store.queue(fixtureRun({ id: runId, idempotencyKey: "run-late-cancellation-after-result" }));
  await store.prepare(runId, "2026-07-13T00:41:01Z");
  await store.start(runId, "2026-07-13T00:41:02Z");
  await database.prepare(
    `UPDATE runs
     SET state = 'cancel_requested', cancel_requested_at = ?, updated_at = ?
     WHERE id = ? AND state = 'running'`,
  ).bind("2026-07-13T00:41:03Z", "2026-07-13T00:41:03Z", runId).run();
  const result = await fixtureResult({
    runId,
    startedAt: "2026-07-13T00:41:02Z",
    finishedAt: "2026-07-13T00:41:03Z",
  });
  await persistOutput(store, runId, result);
  const terminal = await store.recordResult(runId, result, "2026-07-13T00:41:04Z");
  assert.equal(terminal.state, "cancelled");
  assert.equal(
    (await store.listEvents(runId)).some((event) => event.eventType === "cancellation_requested"),
    false,
  );

  await assert.rejects(
    store.requestCancellation(runId, "2026-07-13T00:41:09Z"),
    /cannot be appended after terminal runner evidence/,
  );
  assert.equal(
    (await store.listEvents(runId)).some((event) => event.eventType === "cancellation_requested"),
    false,
  );
});

function fixtureRun({
  id = "run:fixture-1",
  idempotencyKey = "run-idempotency-1",
} = {}) {
  return {
    id,
    attemptId: "attempt:run-test",
    idempotencyKey,
    requestHash: sha("a"),
    artifactBundleHash: sha("b"),
    queuedAt: "2026-07-13T00:00:00Z",
  };
}

async function fixtureResult({
  runId = "run:fixture-1",
  startedAt = "2026-07-13T00:00:02Z",
  finishedAt = "2026-07-13T00:00:03Z",
  status = "cancelled",
} = {}) {
  const succeeded = status === "succeeded";
  const result = {
    protocolVersion: "pw-lean-runner-v1",
    jobId: runId,
    attemptId: "attempt:run-test",
    requestHash: sha("a"),
    runnerKeyId: "runner-key:run-test",
    runnerSignature: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    status,
    exitCode: succeeded ? 0 : 137,
    startedAt,
    finishedAt,
    kernelStatus: succeeded ? "accepted" : "not_run",
    checks: succeeded
      ? { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" }
      : { network: "passed", noSorry: "not_run", allowedAxioms: "not_run", leanBuild: "not_run" },
    artifacts: { manifestHash: sha("b"), stdoutHash: runnerStdoutHash, stderrHash: runnerStderrHash },
  };
  result.runnerSignature = base64Url(
    await crypto.subtle.sign(
      "Ed25519",
      runnerKeyPair.privateKey,
      new TextEncoder().encode(canonicalJson(runnerResultSigningPayload(result))),
    ),
  );
  return result;
}

async function persistOutput(store, runId, result) {
  const unsignedResult = { ...result };
  delete unsignedResult.runnerKeyId;
  delete unsignedResult.runnerSignature;
  const outputStore = new D1R2RunnerOutputStore({ database, bucket });
  await outputStore.persist({
    run: await store.find(runId),
    execution: { result: unsignedResult, stdout: runnerStdout, stderr: runnerStderr },
  });
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}

function base64Url(buffer) {
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function seedAttempt(d1, publicKey) {
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
    [
      "INSERT INTO runner_keys (id, public_key, fingerprint) VALUES (?, ?, ?)",
      ["runner-key:run-test", publicKey, await runnerKeyFingerprint(publicKey)],
    ],
  ];

  for (const [statement, values] of statements) {
    await d1.prepare(statement).bind(...values).run();
  }
}

async function sha256Bytes(value) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
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
