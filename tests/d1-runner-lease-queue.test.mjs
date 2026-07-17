import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createClient } from "@libsql/client";
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

async function queueDatabase() {
  const database = new LibsqlD1Database(createClient({ url: "file::memory:" }));
  await database.prepare("CREATE TABLE runs (id TEXT PRIMARY KEY NOT NULL)").run();
  const source = await readFile(new URL("../drizzle/0032_add_runner_queue_leases.sql", import.meta.url), "utf8");
  for (const statement of source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    await database.prepare(statement).run();
  }
  return database;
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
