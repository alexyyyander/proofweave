import {
  createQueuedRun,
  markRunStarted,
  recordRunnerResult,
  requestRunCancellation,
} from "../../packages/domain/run.mjs";
import { canonicalJson, sha256Canonical } from "../../packages/protocol/canonical-json.mjs";
import {
  normalizeLeanRunnerResult,
  verifyLeanRunnerResultSignature,
} from "../../packages/protocol/lean-runner.mjs";

export class RunStoreConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "RunStoreConflictError";
  }
}

export class RunStoreNotFoundError extends Error {
  constructor(runId) {
    super(`Run ${runId} was not found.`);
    this.name = "RunStoreNotFoundError";
  }
}

export class RunStoreAuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = "RunStoreAuthenticationError";
  }
}

/**
 * Internal control-plane persistence only. Public routes must authenticate the
 * Person or runner channel before they call this store.
 */
export class D1RunStore {
  constructor(database) {
    this.database = database;
  }

  async queue(input) {
    const queued = createQueuedRun(input);
    const existing = await this.database
      .prepare("SELECT * FROM runs WHERE attempt_id = ? AND idempotency_key = ?")
      .bind(queued.attemptId, queued.idempotencyKey)
      .first();
    if (existing) {
      const run = toRun(existing);
      assertSameQueuedIdentity(run, queued);
      return { run, created: false };
    }

    const event = await createEvent({
      id: `run-event:${queued.id}:queued`,
      runId: queued.id,
      sequence: 1,
      eventType: "run_queued",
      state: queued.state,
      occurredAt: queued.queuedAt,
      payload: {
        artifactBundleHash: queued.artifactBundleHash,
        requestHash: queued.requestHash,
      },
    });
    await this.database.batch([
      this.database
        .prepare(
          `INSERT INTO runs (
            id, attempt_id, artifact_bundle_hash, request_hash, idempotency_key,
            state, queued_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          queued.id,
          queued.attemptId,
          queued.artifactBundleHash,
          queued.requestHash,
          queued.idempotencyKey,
          queued.state,
          queued.queuedAt,
          queued.queuedAt,
        ),
      insertEventStatement(this.database, event),
    ]);
    return { run: queued, created: true };
  }

  async find(runId) {
    const row = await this.database.prepare("SELECT * FROM runs WHERE id = ?").bind(runId).first();
    return row ? toRun(row) : null;
  }

  async listEvents(runId) {
    const rows = await this.database
      .prepare("SELECT * FROM run_events WHERE run_id = ? ORDER BY sequence ASC")
      .bind(runId)
      .all();
    return (rows.results ?? []).map((row) => ({
      id: row.id,
      sequence: Number(row.sequence),
      eventType: row.event_type,
      state: row.state,
      payloadHash: row.payload_hash,
      canonicalPayload: row.canonical_payload,
      occurredAt: row.occurred_at,
    }));
  }

  async start(runId, startedAt) {
    const current = await this.requireRun(runId);
    if (current.state === "running" && current.startedAt === startedAt) return current;
    const next = markRunStarted(current, startedAt);
    await this.writeProjection(current, next, startedAt);
    await this.appendEvent({
      id: `run-event:${runId}:started`,
      run: next,
      eventType: "run_started",
      occurredAt: startedAt,
      payload: { requestHash: next.requestHash },
    });
    return next;
  }

  async requestCancellation(runId, requestedAt) {
    const current = await this.requireRun(runId);
    if (
      ["cancel_requested", "cancelled"].includes(current.state) &&
      current.cancelRequestedAt === requestedAt
    ) {
      return current;
    }
    const next = requestRunCancellation(current, requestedAt);
    await this.writeProjection(current, next, requestedAt);
    await this.appendEvent({
      id: `run-event:${runId}:${next.state === "cancelled" ? "cancelled" : "cancellation-requested"}`,
      run: next,
      eventType: next.state === "cancelled" ? "run_cancelled" : "cancellation_requested",
      occurredAt: requestedAt,
      payload: { requestHash: next.requestHash },
    });
    return next;
  }

  async recordResult(runId, result, receivedAt) {
    requireUtcInstant(receivedAt, "receivedAt");
    const current = await this.requireRun(runId);
    const normalizedResult = normalizeLeanRunnerResult(result);
    await this.assertTrustedRunnerSignature(normalizedResult);
    const resultHash = await sha256Canonical(normalizedResult);
    const existing = await this.database
      .prepare("SELECT result_hash FROM run_results WHERE run_id = ?")
      .bind(runId)
      .first();
    if (existing && existing.result_hash !== resultHash) {
      throw new RunStoreConflictError("A Run already has different immutable runner evidence.");
    }
    if (existing && current.runnerResultHash === resultHash) return current;

    const next = recordRunnerResult(current, normalizedResult, resultHash);
    if (!existing) {
      await this.database
        .prepare(
          "INSERT INTO run_results (run_id, result_hash, canonical_result, received_at) VALUES (?, ?, ?, ?)",
        )
        .bind(runId, resultHash, canonicalJson(normalizedResult), receivedAt)
        .run();
    }
    await this.writeProjection(current, next, receivedAt);
    await this.appendEvent({
      id: `run-event:${runId}:runner-result`,
      run: next,
      eventType: "runner_result_recorded",
      occurredAt: receivedAt,
      payload: { requestHash: next.requestHash, resultHash },
    });
    return next;
  }

  async requireRun(runId) {
    const run = await this.find(runId);
    if (!run) throw new RunStoreNotFoundError(runId);
    return run;
  }

  async assertTrustedRunnerSignature(result) {
    const key = await this.database
      .prepare(
        "SELECT public_key FROM runner_keys WHERE id = ? AND status = 'active' AND revoked_at IS NULL",
      )
      .bind(result.runnerKeyId)
      .first();
    if (!key) {
      throw new RunStoreAuthenticationError("Runner result key is not an active allowlisted key.");
    }
    if (!await verifyLeanRunnerResultSignature({ result, runnerPublicKey: key.public_key })) {
      throw new RunStoreAuthenticationError("Runner result signature is invalid.");
    }
  }

  async writeProjection(current, next, updatedAt) {
    const changed = await this.database
      .prepare(
        `UPDATE runs
         SET state = ?, started_at = ?, cancel_requested_at = ?, finished_at = ?,
             runner_result_hash = ?, updated_at = ?
         WHERE id = ? AND state = ?`,
      )
      .bind(
        next.state,
        next.startedAt,
        next.cancelRequestedAt,
        next.finishedAt,
        next.runnerResultHash,
        updatedAt,
        current.id,
        current.state,
      )
      .run();
    if (changed.meta.changes !== 1) {
      throw new RunStoreConflictError("Run state changed before this transition could be persisted.");
    }
  }

  async appendEvent({ id, run, eventType, occurredAt, payload }) {
    const row = await this.database
      .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM run_events WHERE run_id = ?")
      .bind(run.id)
      .first();
    const event = await createEvent({
      id,
      runId: run.id,
      sequence: Number(row?.next_sequence ?? 1),
      eventType,
      state: run.state,
      occurredAt,
      payload,
    });
    await insertEventStatement(this.database, event).run();
  }
}

function toRun(row) {
  return Object.freeze({
    id: row.id,
    attemptId: row.attempt_id,
    artifactBundleHash: row.artifact_bundle_hash,
    requestHash: row.request_hash,
    idempotencyKey: row.idempotency_key,
    state: row.state,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    cancelRequestedAt: row.cancel_requested_at,
    finishedAt: row.finished_at,
    runnerResultHash: row.runner_result_hash,
  });
}

function assertSameQueuedIdentity(existing, requested) {
  if (
    existing.attemptId !== requested.attemptId ||
    existing.artifactBundleHash !== requested.artifactBundleHash ||
    existing.requestHash !== requested.requestHash ||
    existing.idempotencyKey !== requested.idempotencyKey
  ) {
    throw new RunStoreConflictError("A Run idempotency key cannot be reused for different evidence.");
  }
}

async function createEvent({ id, runId, sequence, eventType, state, occurredAt, payload }) {
  const eventPayload = {
    protocolVersion: "pw-run-event-v1",
    runId,
    sequence,
    eventType,
    state,
    occurredAt,
    ...payload,
  };
  return {
    id,
    runId,
    sequence,
    eventType,
    state,
    payloadHash: await sha256Canonical(eventPayload),
    canonicalPayload: canonicalJson(eventPayload),
    occurredAt,
  };
}

function insertEventStatement(database, event) {
  return database
    .prepare(
      `INSERT INTO run_events (
        id, run_id, sequence, event_type, state, payload_hash, canonical_payload, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      event.id,
      event.runId,
      event.sequence,
      event.eventType,
      event.state,
      event.payloadHash,
      event.canonicalPayload,
      event.occurredAt,
    );
}

function requireUtcInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO-8601 UTC instant.`);
  }
}
