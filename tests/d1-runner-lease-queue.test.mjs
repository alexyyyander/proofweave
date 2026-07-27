import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createClient } from "@libsql/client";
import { canonicalJson } from "../packages/protocol/canonical-json.mjs";
import { LibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import {
  D1RunnerLeaseQueue,
} from "../services/lean-runner/d1-runner-lease-queue.mjs";
import {
  createRunnerQueueMessage,
  RunnerQueueProtocolError,
} from "../services/lean-runner/queue.mjs";

test("durable Runner queue fences concurrent and expired leases", async (t) => {
  const database = await queueDatabase();
  t.after(() => database.close());
  const queue = new D1RunnerLeaseQueue({ database });
  const { message } = await fixtureMessage();
  await seedRun(database, message.runId);

  assert.equal((await queue.enqueue(message)).created, true);
  assert.equal((await queue.enqueue({ ...message })).created, false);

  const claims = await Promise.all([
    queue.claim({ consumerId: "runner:one", claimedAt: "2026-07-13T00:00:01.500Z", leaseDurationSeconds: 30 }),
    queue.claim({ consumerId: "runner:two", claimedAt: "2026-07-13T00:00:01.500Z", leaseDurationSeconds: 30 }),
  ]);
  const claimed = claims.filter(Boolean);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].lease.deliveryAttempt, 1);
  assert.equal(claimed[0].lease.expiresAt, "2026-07-13T00:00:31.500Z");

  const reclaimed = await queue.claim({
    consumerId: "runner:recovery",
    claimedAt: "2026-07-13T00:00:32Z",
    leaseDurationSeconds: 30,
  });
  assert.equal(reclaimed.lease.deliveryAttempt, 2);
  await assert.rejects(
    queue.acknowledge({
      runId: message.runId,
      leaseId: claimed[0].lease.id,
      acknowledgedAt: "2026-07-13T00:00:33Z",
    }),
    RunnerQueueProtocolError,
  );

  const renewed = await queue.renew({
    runId: message.runId,
    leaseId: reclaimed.lease.id,
    renewedAt: "2026-07-13T00:00:40Z",
    leaseDurationSeconds: 60,
  });
  assert.equal(renewed.expiresAt, "2026-07-13T00:01:40.000Z");
  await queue.release({
    runId: message.runId,
    leaseId: reclaimed.lease.id,
    releasedAt: "2026-07-13T00:00:41Z",
    availableAt: "2026-07-13T00:00:51Z",
    errorCode: "execution_failed",
  });
  assert.equal(await queue.claim({
    consumerId: "runner:early",
    claimedAt: "2026-07-13T00:00:50Z",
    leaseDurationSeconds: 30,
  }), null);

  const finalClaim = await queue.claim({
    consumerId: "runner:final",
    claimedAt: "2026-07-13T00:00:51Z",
    leaseDurationSeconds: 30,
  });
  await queue.acknowledge({
    runId: message.runId,
    leaseId: finalClaim.lease.id,
    acknowledgedAt: "2026-07-13T00:00:52Z",
  });
  assert.equal((await queue.find(message.runId)).deliveryState, "acknowledged");
  assert.equal(await queue.claim({
    consumerId: "runner:none",
    claimedAt: "2026-07-13T00:01:30Z",
    leaseDurationSeconds: 30,
  }), null);

  assert.deepEqual((await queue.listEvents(message.runId)).map((event) => event.eventType), [
    "enqueued",
    "lease_claimed",
    "lease_reclaimed",
    "lease_renewed",
    "released",
    "lease_claimed",
    "acknowledged",
  ]);
});

test("durable Runner queue preserves idempotency, cancellation, and dead letters", async (t) => {
  const database = await queueDatabase();
  t.after(() => database.close());
  const queue = new D1RunnerLeaseQueue({ database });
  const { message } = await fixtureMessage();
  await seedRun(database, message.runId);
  await queue.enqueue(message);

  const conflicting = await fixtureMessage({ idempotencyKey: "queue-conflict" });
  await assert.rejects(queue.enqueue(conflicting.message), /identity cannot be reused/);
  assert.equal((await queue.cancelQueued({
    runId: message.runId,
    cancelledAt: "2026-07-13T00:00:01Z",
  })).deliveryState, "cancelled");

  const dead = await fixtureMessage({ runId: "run:queue-dead-1", idempotencyKey: "queue-dead-1" });
  await seedRun(database, dead.message.runId);
  await queue.enqueue(dead.message);
  const claimed = await queue.claim({
    consumerId: "runner:dead-letter",
    claimedAt: "2026-07-13T00:00:02Z",
    leaseDurationSeconds: 30,
  });
  await queue.deadLetter({
    runId: dead.message.runId,
    leaseId: claimed.lease.id,
    deadLetteredAt: "2026-07-13T00:00:03Z",
    errorCode: "authentication_failed",
  });
  assert.equal((await queue.find(dead.message.runId)).deliveryState, "dead_letter");
  const redriven = await queue.redrive({
    runId: dead.message.runId,
    redrivenAt: "2026-07-13T00:00:04Z",
  });
  assert.equal(redriven.redriven, true);
  assert.equal(redriven.deliveryState, "queued");
  assert.equal((await queue.find(dead.message.runId)).deliveryAttempts, 0);
  const redrivenClaim = await queue.claim({
    consumerId: "runner:redriven",
    claimedAt: "2026-07-13T00:00:04Z",
    leaseDurationSeconds: 30,
  });
  assert.equal(redrivenClaim.lease.deliveryAttempt, 1);
  assert.deepEqual((await queue.listEvents(dead.message.runId)).map((event) => event.eventType), [
    "enqueued",
    "lease_claimed",
    "dead_lettered",
    "enqueued",
    "lease_claimed",
  ]);

  await assert.rejects(
    database.prepare("UPDATE runner_queue_messages SET request_hash = ? WHERE run_id = ?")
      .bind(sha("0"), dead.message.runId).run(),
    /identity is immutable/,
  );
  await assert.rejects(
    database.prepare("DELETE FROM runner_queue_events WHERE run_id = ?").bind(dead.message.runId).run(),
    /events cannot be deleted/,
  );
});

test("durable Runner queue persists lifecycle order when redrive and claim share an instant", async (t) => {
  const database = await queueDatabase();
  t.after(() => database.close());
  const identifiers = [
    "initial-event",
    "initial-lease",
    "initial-claim-event",
    "dead-letter-event",
    "z-redrive-event",
    "redriven-lease",
    "a-redriven-claim-event",
  ];
  const queue = new D1RunnerLeaseQueue({
    database,
    createId: () => identifiers.shift(),
  });
  const { message } = await fixtureMessage({
    runId: "run:queue-sequence-1",
    idempotencyKey: "queue-sequence-1",
  });
  await seedRun(database, message.runId);
  await queue.enqueue(message);
  const claimed = await queue.claim({
    consumerId: "runner:sequence-initial",
    claimedAt: "2026-07-13T00:00:01Z",
    leaseDurationSeconds: 30,
  });
  await queue.deadLetter({
    runId: message.runId,
    leaseId: claimed.lease.id,
    deadLetteredAt: "2026-07-13T00:00:02Z",
    errorCode: "execution_failed",
  });
  await queue.redrive({
    runId: message.runId,
    redrivenAt: "2026-07-13T00:00:03Z",
  });
  await queue.claim({
    consumerId: "runner:sequence-redriven",
    claimedAt: "2026-07-13T00:00:03Z",
    leaseDurationSeconds: 30,
  });

  assert.equal(identifiers.length, 0);
  assert.deepEqual((await queue.listEvents(message.runId)).map((event) => event.eventType), [
    "enqueued",
    "lease_claimed",
    "dead_lettered",
    "enqueued",
    "lease_claimed",
  ]);
  const persisted = (await database.prepare(
    `SELECT event_type, event_sequence
     FROM runner_queue_events
     WHERE run_id = ?
     ORDER BY event_sequence`,
  ).bind(message.runId).all()).results;
  assert.deepEqual(persisted.map((event) => [event.event_type, event.event_sequence]), [
    ["enqueued", 1],
    ["lease_claimed", 2],
    ["dead_lettered", 3],
    ["enqueued", 4],
    ["lease_claimed", 5],
  ]);
});

test("durable Runner queue reads immutable pre-sequence events in insertion order", async (t) => {
  const database = new LibsqlD1Database(createClient({ url: "file::memory:" }));
  t.after(() => database.close());
  await database.prepare("CREATE TABLE runs (id TEXT PRIMARY KEY NOT NULL)").run();
  await applyMigration(database, "0032_add_runner_queue_leases.sql");
  const runId = "run:queue-legacy-order-1";
  const { message } = await fixtureMessage({
    runId,
    idempotencyKey: "queue-legacy-order-1",
  });
  await seedRun(database, runId);
  await database.prepare(
    `INSERT INTO runner_queue_messages (
      run_id, attempt_id, idempotency_key, request_hash, canonical_message,
      delivery_state, available_at, delivery_attempts, enqueued_at,
      dead_lettered_at, last_error_code, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'dead_letter', ?, 1, ?, ?, 'execution_failed', ?)`,
  ).bind(
    runId,
    message.request.attemptId,
    message.request.idempotencyKey,
    message.requestHash,
    canonicalJson(message),
    "2026-07-13T00:00:00.000Z",
    "2026-07-13T00:00:00.000Z",
    "2026-07-13T00:00:02.000Z",
    "2026-07-13T00:00:02.000Z",
  ).run();
  await database.prepare(
    `INSERT INTO runner_queue_events (
      id, deduplication_key, run_id, event_type, delivery_state,
      lease_id, delivery_attempt, error_code, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).bind(
    "queue-event:z-legacy-enqueued",
    `${runId}:enqueued`,
    runId,
    "enqueued",
    "queued",
    null,
    0,
    "2026-07-13T00:00:00.000Z",
  ).run();
  await database.prepare(
    `INSERT INTO runner_queue_events (
      id, deduplication_key, run_id, event_type, delivery_state,
      lease_id, delivery_attempt, error_code, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).bind(
    "queue-event:a-legacy-claimed",
    "lease:legacy:dead_lettered",
    runId,
    "dead_lettered",
    "dead_letter",
    "lease:legacy",
    1,
    "2026-07-13T00:00:02.000Z",
  ).run();
  await applyMigration(database, "0043_add_runner_queue_event_sequence.sql");

  const identifiers = [
    "legacy-redrive-event",
    "legacy-redriven-lease",
    "legacy-redriven-claim-event",
  ];
  const queue = new D1RunnerLeaseQueue({
    database,
    createId: () => identifiers.shift(),
  });
  await queue.redrive({
    runId,
    redrivenAt: "2026-07-13T00:00:03Z",
  });
  await queue.claim({
    consumerId: "runner:legacy-redriven",
    claimedAt: "2026-07-13T00:00:03Z",
    leaseDurationSeconds: 30,
  });
  assert.equal(identifiers.length, 0);
  assert.deepEqual((await queue.listEvents(runId)).map((event) => event.eventType), [
    "enqueued",
    "dead_lettered",
    "enqueued",
    "lease_claimed",
  ]);
  const persisted = (await database.prepare(
    "SELECT event_sequence FROM runner_queue_events WHERE run_id = ? ORDER BY rowid",
  ).bind(runId).all()).results;
  assert.deepEqual(persisted.map((event) => event.event_sequence), [null, null, 3, 4]);
});

async function queueDatabase() {
  const database = new LibsqlD1Database(createClient({ url: "file::memory:" }));
  await database.prepare("CREATE TABLE runs (id TEXT PRIMARY KEY NOT NULL)").run();
  await applyMigration(database, "0032_add_runner_queue_leases.sql");
  await applyMigration(database, "0043_add_runner_queue_event_sequence.sql");
  return database;
}

async function applyMigration(database, filename) {
  const source = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
  for (const statement of source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    await database.prepare(statement).run();
  }
}

function seedRun(database, runId) {
  return database.prepare("INSERT INTO runs (id) VALUES (?)").bind(runId).run();
}

async function fixtureMessage({ runId = "run:queue-fixture-1", idempotencyKey = "queue-fixture-1" } = {}) {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const message = await createRunnerQueueMessage({
    runId,
    enqueuedAt: "2026-07-13T00:00:00Z",
    controlPlaneKeyId: "control-plane:closed-alpha",
    controlPlanePrivateKey: pair.privateKey,
    request: {
      protocolVersion: "pw-lean-runner-v1",
      jobId: runId,
      idempotencyKey,
      attemptId: "attempt:queue-fixture-1",
      bundle: {
        objectKey: `bundles/sha256/${"a".repeat(64)}/bundle.json`,
        contentHash: sha("a"),
        manifestHash: sha("a"),
        entryCommand: ["lake", "env", "lean", "ProofweaveFixture.lean"],
      },
      environment: {
        imageDigest: `ghcr.io/proofweave/lean-runner@sha256:${"c".repeat(64)}`,
        leanToolchain: "leanprover/lean4:v4.30.0",
        mathlibRevision: "fixture-no-mathlib",
        network: "disabled",
      },
      limits: { cpuSeconds: 60, wallSeconds: 120, memoryMiB: 2_048, diskMiB: 2_048, outputBytes: 1_000_000 },
      policy: { requireNoSorry: true, allowedAxioms: [] },
    },
  });
  return { message };
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}
