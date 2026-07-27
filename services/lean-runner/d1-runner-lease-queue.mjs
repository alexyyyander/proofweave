import { canonicalJson, canonicalUtf8 } from "../../packages/protocol/canonical-json.mjs";
import {
  normalizeRunnerQueueMessage,
  RunnerQueueProtocolError,
} from "./queue.mjs";

export const durableRunnerQueueMaxMessageBytes = 128 * 1024;

export class D1RunnerLeaseQueueConfigurationError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "D1RunnerLeaseQueueConfigurationError";
  }
}

/**
 * Durable SQLite/libSQL queue with at-least-once delivery and fenced leases.
 *
 * The immutable signed queue message is stored once. Claim, renewal, retry,
 * acknowledgement, cancellation, and dead-lettering change only a delivery
 * projection and append a privacy-minimal event. Every mutating operation is
 * conditional on the active lease id, so a worker whose lease expired cannot
 * acknowledge or release a newer delivery.
 */
export class D1RunnerLeaseQueue {
  constructor({ database, createId = () => crypto.randomUUID(), claimRetries = 8 } = {}) {
    if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function") {
      throw new D1RunnerLeaseQueueConfigurationError("Durable Runner queue requires a D1-compatible database with prepare() and batch().");
    }
    if (typeof createId !== "function") {
      throw new D1RunnerLeaseQueueConfigurationError("Durable Runner queue requires an id generator.");
    }
    if (!Number.isSafeInteger(claimRetries) || claimRetries < 1 || claimRetries > 64) {
      throw new D1RunnerLeaseQueueConfigurationError("Durable Runner queue claimRetries must be between 1 and 64.");
    }
    this.database = database;
    this.createId = createId;
    this.claimRetries = claimRetries;
  }

  async enqueue(message) {
    const normalized = await normalizeRunnerQueueMessage(message);
    const canonicalMessage = canonicalJson(normalized);
    const enqueuedAt = canonicalInstant(normalized.enqueuedAt);
    if (canonicalUtf8(normalized).byteLength >= durableRunnerQueueMaxMessageBytes) {
      throw new RunnerQueueProtocolError("Signed RunnerQueue message exceeds the durable queue message limit.");
    }
    const [existingRun, existingIdempotency] = await Promise.all([
      this.rowByRunId(normalized.runId),
      this.rowByIdempotency(normalized.request.attemptId, normalized.request.idempotencyKey),
    ]);
    const existing = existingRun ?? existingIdempotency;
    if (existing) {
      assertSameEnqueuedMessage({ existingRun, existingIdempotency, canonicalMessage });
      await this.ensureEnqueuedEvent(normalized);
      const record = await hydrateRecord(existing);
      return Object.freeze({
        message: record.message,
        created: false,
        deliveryState: record.deliveryState,
      });
    }
    const eventId = this.newIdentifier("queue-event");
    const eventDeduplicationKey = `${normalized.runId}:enqueued`;
    const statements = [
      this.database.prepare(
        `INSERT INTO runner_queue_messages (
          run_id, attempt_id, idempotency_key, request_hash, canonical_message,
          delivery_state, available_at, delivery_attempts, enqueued_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'queued', ?, 0, ?, ?)`,
      ).bind(
        normalized.runId,
        normalized.request.attemptId,
        normalized.request.idempotencyKey,
        normalized.requestHash,
        canonicalMessage,
        enqueuedAt,
        enqueuedAt,
        enqueuedAt,
      ),
      this.database.prepare(
        `INSERT INTO runner_queue_events (
          id, deduplication_key, run_id, event_type, delivery_state,
          lease_id, delivery_attempt, error_code, occurred_at, event_sequence
        )
        SELECT ?, ?, run_id, 'enqueued', 'queued', NULL, 0, NULL, ?,
          MAX(
            COALESCE((
              SELECT MAX(events.event_sequence)
              FROM runner_queue_events AS events
              WHERE events.run_id = runner_queue_messages.run_id
            ), 0),
            (
              SELECT COUNT(*)
              FROM runner_queue_events AS events
              WHERE events.run_id = runner_queue_messages.run_id
            )
          ) + 1
        FROM runner_queue_messages
        WHERE run_id = ? AND canonical_message = ?`,
      ).bind(
        eventId,
        eventDeduplicationKey,
        enqueuedAt,
        normalized.runId,
        canonicalMessage,
      ),
    ];
    try {
      const results = await this.database.batch(statements);
      requireAtomicMutation(results, "enqueue");
    } catch (cause) {
      const [racedRun, racedIdempotency] = await Promise.all([
        this.rowByRunId(normalized.runId),
        this.rowByIdempotency(normalized.request.attemptId, normalized.request.idempotencyKey),
      ]);
      const raced = racedRun ?? racedIdempotency;
      if (!raced) {
        throw new D1RunnerLeaseQueueConfigurationError("Durable Runner queue did not atomically persist the enqueued message.", { cause });
      }
      assertSameEnqueuedMessage({
        existingRun: racedRun,
        existingIdempotency: racedIdempotency,
        canonicalMessage,
      });
      await this.ensureEnqueuedEvent(normalized);
      const record = await hydrateRecord(raced);
      return Object.freeze({
        message: record.message,
        created: false,
        deliveryState: record.deliveryState,
      });
    }
    const record = await hydrateRecord(await this.rowByRunId(normalized.runId));
    return Object.freeze({
      message: record.message,
      created: true,
      deliveryState: record.deliveryState,
    });
  }

  async claim({ consumerId, claimedAt, leaseDurationSeconds = 300 }) {
    requireIdentifier(consumerId, "consumerId");
    requireUtcInstant(claimedAt, "claimedAt");
    requireDuration(leaseDurationSeconds, "leaseDurationSeconds", 30, 3_600);
    const effectiveClaimedAt = canonicalInstant(claimedAt);
    const leaseExpiresAt = addSeconds(effectiveClaimedAt, leaseDurationSeconds);

    for (let attempt = 0; attempt < this.claimRetries; attempt += 1) {
      const candidate = await this.database.prepare(
        `SELECT * FROM runner_queue_messages
         WHERE (delivery_state = 'queued' AND available_at <= ?)
            OR (delivery_state = 'leased' AND lease_expires_at <= ?)
         ORDER BY
           CASE delivery_state WHEN 'queued' THEN available_at ELSE lease_expires_at END,
           enqueued_at,
           run_id
         LIMIT 1`,
      ).bind(effectiveClaimedAt, effectiveClaimedAt).first();
      if (!candidate) return null;

      const leaseId = this.newIdentifier("lease");
      const eventId = this.newIdentifier("queue-event");
      const nextDeliveryAttempt = integer(candidate.delivery_attempts, "delivery_attempts") + 1;
      const eventType = candidate.delivery_state === "leased" ? "lease_reclaimed" : "lease_claimed";
      const results = await this.database.batch([
        this.database.prepare(
          `UPDATE runner_queue_messages
           SET delivery_state = 'leased', lease_id = ?, lease_consumer_id = ?,
               lease_claimed_at = ?, lease_expires_at = ?,
               delivery_attempts = delivery_attempts + 1, last_error_code = NULL,
               acknowledged_at = NULL, cancelled_at = NULL, dead_lettered_at = NULL,
               updated_at = ?
           WHERE run_id = ? AND delivery_attempts = ? AND (
             (delivery_state = 'queued' AND available_at <= ?)
             OR (delivery_state = 'leased' AND lease_expires_at <= ?)
           )`,
        ).bind(
          leaseId,
          consumerId,
          effectiveClaimedAt,
          leaseExpiresAt,
          effectiveClaimedAt,
          candidate.run_id,
          candidate.delivery_attempts,
          effectiveClaimedAt,
          effectiveClaimedAt,
        ),
        this.eventInsert({
          eventId,
          deduplicationKey: `${leaseId}:${eventType}`,
          runId: candidate.run_id,
          eventType,
          deliveryState: "leased",
          leaseId,
          deliveryAttempt: nextDeliveryAttempt,
          errorCode: null,
          occurredAt: effectiveClaimedAt,
          requiredState: "leased",
          requiredLeaseId: leaseId,
        }),
      ]);
      if (changes(results[0]) !== 1) continue;
      requireAtomicMutation(results, "claim");
      const row = await this.rowByRunId(candidate.run_id);
      const record = await hydrateRecord(row);
      return Object.freeze({ message: record.message, lease: record.lease });
    }
    return null;
  }

  async renew({ runId, leaseId, renewedAt, leaseDurationSeconds = 300 }) {
    requireIdentifier(runId, "runId");
    requireIdentifier(leaseId, "leaseId");
    requireUtcInstant(renewedAt, "renewedAt");
    requireDuration(leaseDurationSeconds, "leaseDurationSeconds", 30, 3_600);
    const effectiveRenewedAt = canonicalInstant(renewedAt);
    const leaseExpiresAt = addSeconds(effectiveRenewedAt, leaseDurationSeconds);
    const row = await this.rowByRunId(runId);
    const deliveryAttempt = integer(row?.delivery_attempts, "delivery_attempts");
    const results = await this.database.batch([
      this.database.prepare(
        `UPDATE runner_queue_messages
         SET lease_expires_at = ?, updated_at = ?
         WHERE run_id = ? AND delivery_state = 'leased' AND lease_id = ?
           AND lease_claimed_at <= ? AND lease_expires_at > ?
           AND lease_expires_at < ?`,
      ).bind(
        leaseExpiresAt,
        effectiveRenewedAt,
        runId,
        leaseId,
        effectiveRenewedAt,
        effectiveRenewedAt,
        leaseExpiresAt,
      ),
      this.eventInsert({
        eventId: this.newIdentifier("queue-event"),
        deduplicationKey: `${leaseId}:renewed:${effectiveRenewedAt}`,
        runId,
        eventType: "lease_renewed",
        deliveryState: "leased",
        leaseId,
        deliveryAttempt,
        errorCode: null,
        occurredAt: effectiveRenewedAt,
        requiredState: "leased",
        requiredLeaseId: leaseId,
      }),
    ]);
    requireAtomicActiveLease(results);
    return (await hydrateRecord(await this.rowByRunId(runId))).lease;
  }

  async acknowledge({ runId, leaseId, acknowledgedAt }) {
    return this.finishLease({
      runId,
      leaseId,
      occurredAt: acknowledgedAt,
      eventType: "acknowledged",
      deliveryState: "acknowledged",
      timestampColumn: "acknowledged_at",
    });
  }

  async release({ runId, leaseId, releasedAt, availableAt = releasedAt, errorCode = null }) {
    requireIdentifier(runId, "runId");
    requireIdentifier(leaseId, "leaseId");
    requireUtcInstant(releasedAt, "releasedAt");
    requireUtcInstant(availableAt, "availableAt");
    const effectiveReleasedAt = canonicalInstant(releasedAt);
    const effectiveAvailableAt = canonicalInstant(availableAt);
    requireOptionalErrorCode(errorCode);
    if (Date.parse(effectiveAvailableAt) < Date.parse(effectiveReleasedAt)) {
      throw new RunnerQueueProtocolError("RunnerQueue retry availability cannot precede its release.");
    }
    const row = await this.rowByRunId(runId);
    const deliveryAttempt = integer(row?.delivery_attempts, "delivery_attempts");
    const results = await this.database.batch([
      this.database.prepare(
        `UPDATE runner_queue_messages
         SET delivery_state = 'queued', available_at = ?, lease_expires_at = NULL,
             last_error_code = ?, updated_at = ?
         WHERE run_id = ? AND delivery_state = 'leased' AND lease_id = ?
           AND lease_claimed_at <= ? AND lease_expires_at > ?`,
      ).bind(
        effectiveAvailableAt,
        errorCode,
        effectiveReleasedAt,
        runId,
        leaseId,
        effectiveReleasedAt,
        effectiveReleasedAt,
      ),
      this.eventInsert({
        eventId: this.newIdentifier("queue-event"),
        deduplicationKey: `${leaseId}:released`,
        runId,
        eventType: "released",
        deliveryState: "queued",
        leaseId,
        deliveryAttempt,
        errorCode,
        occurredAt: effectiveReleasedAt,
        requiredState: "queued",
        requiredLeaseId: leaseId,
      }),
    ]);
    requireAtomicActiveLease(results);
    return (await hydrateRecord(await this.rowByRunId(runId))).message;
  }

  async deadLetter({ runId, leaseId, deadLetteredAt, errorCode }) {
    requireOptionalErrorCode(errorCode, { required: true });
    return this.finishLease({
      runId,
      leaseId,
      occurredAt: deadLetteredAt,
      eventType: "dead_lettered",
      deliveryState: "dead_letter",
      timestampColumn: "dead_lettered_at",
      errorCode,
    });
  }

  /**
   * Re-open only the exact immutable message that exhausted delivery. The
   * signed envelope, Run identity, and prior queue events remain unchanged;
   * only the delivery projection receives a fresh bounded attempt budget.
   */
  async redrive({ runId, redrivenAt }) {
    requireIdentifier(runId, "runId");
    requireUtcInstant(redrivenAt, "redrivenAt");
    const effectiveRedrivenAt = canonicalInstant(redrivenAt);
    const current = await this.rowByRunId(runId);
    if (!current) return Object.freeze({ deliveryState: "not_found", redriven: false });
    if (current.delivery_state !== "dead_letter") {
      const record = await hydrateRecord(current);
      return Object.freeze({
        deliveryState: record.deliveryState,
        message: record.message,
        redriven: false,
      });
    }
    const results = await this.database.batch([
      this.database.prepare(
        `UPDATE runner_queue_messages
         SET delivery_state = 'queued', available_at = ?, delivery_attempts = 0,
             lease_id = NULL, lease_consumer_id = NULL, lease_claimed_at = NULL,
             lease_expires_at = NULL, last_error_code = NULL,
             acknowledged_at = NULL, cancelled_at = NULL, dead_lettered_at = NULL,
             updated_at = ?
         WHERE run_id = ? AND delivery_state = 'dead_letter'`,
      ).bind(effectiveRedrivenAt, effectiveRedrivenAt, runId),
      this.eventInsert({
        eventId: this.newIdentifier("queue-event"),
        deduplicationKey: `${runId}:redriven:${effectiveRedrivenAt}`,
        runId,
        // Re-enqueue the same signed envelope using the existing append-only
        // queue vocabulary. The distinct deduplication key and reset attempt
        // number preserve the redrive boundary without rewriting old events.
        eventType: "enqueued",
        deliveryState: "queued",
        leaseId: null,
        deliveryAttempt: 0,
        errorCode: null,
        occurredAt: effectiveRedrivenAt,
        requiredState: "queued",
        requiredLeaseId: null,
      }),
    ]);
    const record = await hydrateRecord(await this.rowByRunId(runId));
    if (changes(results[0]) === 1) {
      requireAtomicMutation(results, "redrive");
    }
    return Object.freeze({
      deliveryState: record.deliveryState,
      message: record.message,
      redriven: changes(results[0]) === 1,
    });
  }

  async cancelQueued({ runId, cancelledAt }) {
    requireIdentifier(runId, "runId");
    requireUtcInstant(cancelledAt, "cancelledAt");
    const effectiveCancelledAt = canonicalInstant(cancelledAt);
    const results = await this.database.batch([
      this.database.prepare(
        `UPDATE runner_queue_messages
         SET delivery_state = 'cancelled', cancelled_at = ?, updated_at = ?
         WHERE run_id = ? AND delivery_state = 'queued'`,
      ).bind(effectiveCancelledAt, effectiveCancelledAt, runId),
      this.eventInsert({
        eventId: this.newIdentifier("queue-event"),
        deduplicationKey: `${runId}:cancelled`,
        runId,
        eventType: "cancelled",
        deliveryState: "cancelled",
        leaseId: null,
        deliveryAttempt: null,
        errorCode: null,
        occurredAt: effectiveCancelledAt,
        requiredState: "cancelled",
        requiredLeaseId: null,
      }),
    ]);
    const row = await this.rowByRunId(runId);
    if (!row) return Object.freeze({ deliveryState: "not_found" });
    const record = await hydrateRecord(row);
    if (changes(results[0]) === 1) {
      requireAtomicMutation(results, "cancellation");
      return Object.freeze({ deliveryState: "cancelled", message: record.message });
    }
    return Object.freeze({ deliveryState: record.deliveryState, message: record.message });
  }

  async find(runId) {
    requireIdentifier(runId, "runId");
    const row = await this.rowByRunId(runId);
    return row ? hydrateRecord(row) : null;
  }

  async listEvents(runId) {
    requireIdentifier(runId, "runId");
    const rows = await this.database.prepare(
      `SELECT id, event_type, delivery_state, lease_id, delivery_attempt, error_code, occurred_at, event_sequence
       FROM runner_queue_events
       WHERE run_id = ?
       ORDER BY
         CASE WHEN event_sequence IS NULL THEN 0 ELSE 1 END,
         CASE WHEN event_sequence IS NULL THEN rowid END,
         event_sequence,
         occurred_at,
         id`,
    ).bind(runId).all();
    return Object.freeze((rows.results ?? []).map((row) => Object.freeze({
      id: row.id,
      eventType: row.event_type,
      deliveryState: row.delivery_state,
      leaseId: row.lease_id,
      deliveryAttempt: row.delivery_attempt,
      errorCode: row.error_code,
      occurredAt: row.occurred_at,
      eventSequence: nullableEventSequence(row.event_sequence),
    })));
  }

  async finishLease({
    runId,
    leaseId,
    occurredAt,
    eventType,
    deliveryState,
    timestampColumn,
    errorCode = null,
  }) {
    requireIdentifier(runId, "runId");
    requireIdentifier(leaseId, "leaseId");
    requireUtcInstant(occurredAt, `${eventType}At`);
    const effectiveOccurredAt = canonicalInstant(occurredAt);
    requireOptionalErrorCode(errorCode);
    const row = await this.rowByRunId(runId);
    const deliveryAttempt = integer(row?.delivery_attempts, "delivery_attempts");
    const allowedTimestampColumns = new Set(["acknowledged_at", "dead_lettered_at"]);
    if (!allowedTimestampColumns.has(timestampColumn)) {
      throw new D1RunnerLeaseQueueConfigurationError("Durable Runner queue received an unsupported terminal timestamp column.");
    }
    const results = await this.database.batch([
      this.database.prepare(
        `UPDATE runner_queue_messages
         SET delivery_state = ?, ${timestampColumn} = ?, lease_expires_at = NULL,
             last_error_code = ?, updated_at = ?
         WHERE run_id = ? AND delivery_state = 'leased' AND lease_id = ?
           AND lease_claimed_at <= ? AND lease_expires_at > ?`,
      ).bind(
        deliveryState,
        effectiveOccurredAt,
        errorCode,
        effectiveOccurredAt,
        runId,
        leaseId,
        effectiveOccurredAt,
        effectiveOccurredAt,
      ),
      this.eventInsert({
        eventId: this.newIdentifier("queue-event"),
        deduplicationKey: `${leaseId}:${eventType}`,
        runId,
        eventType,
        deliveryState,
        leaseId,
        deliveryAttempt,
        errorCode,
        occurredAt: effectiveOccurredAt,
        requiredState: deliveryState,
        requiredLeaseId: leaseId,
      }),
    ]);
    requireAtomicActiveLease(results);
    return (await hydrateRecord(await this.rowByRunId(runId))).message;
  }

  eventInsert({
    eventId,
    deduplicationKey,
    runId,
    eventType,
    deliveryState,
    leaseId,
    errorCode,
    occurredAt,
    requiredState,
    requiredLeaseId,
  }) {
    return this.database.prepare(
      `INSERT INTO runner_queue_events (
        id, deduplication_key, run_id, event_type, delivery_state,
        lease_id, delivery_attempt, error_code, occurred_at, event_sequence
      )
      SELECT ?, ?, run_id, ?, ?, ?, delivery_attempts, ?, ?,
        MAX(
          COALESCE((
            SELECT MAX(events.event_sequence)
            FROM runner_queue_events AS events
            WHERE events.run_id = runner_queue_messages.run_id
          ), 0),
          (
            SELECT COUNT(*)
            FROM runner_queue_events AS events
            WHERE events.run_id = runner_queue_messages.run_id
          )
        ) + 1
      FROM runner_queue_messages
      WHERE run_id = ? AND delivery_state = ?
        AND updated_at = ?
        AND (? IS NULL OR lease_id = ?)`,
    ).bind(
      eventId,
      deduplicationKey,
      eventType,
      deliveryState,
      leaseId,
      errorCode,
      occurredAt,
      runId,
      requiredState,
      occurredAt,
      requiredLeaseId,
      requiredLeaseId,
    );
  }

  rowByRunId(runId) {
    return this.database.prepare("SELECT * FROM runner_queue_messages WHERE run_id = ?").bind(runId).first();
  }

  rowByIdempotency(attemptId, idempotencyKey) {
    return this.database.prepare(
      "SELECT * FROM runner_queue_messages WHERE attempt_id = ? AND idempotency_key = ?",
    ).bind(attemptId, idempotencyKey).first();
  }

  async ensureEnqueuedEvent(message) {
    const deduplicationKey = `${message.runId}:enqueued`;
    const existing = await this.database.prepare(
      "SELECT * FROM runner_queue_events WHERE deduplication_key = ?",
    ).bind(deduplicationKey).first();
    if (existing) {
      assertSameEnqueuedEvent(existing, message);
      return;
    }
    const result = await this.database.prepare(
      `INSERT INTO runner_queue_events (
        id, deduplication_key, run_id, event_type, delivery_state,
        lease_id, delivery_attempt, error_code, occurred_at, event_sequence
      )
      SELECT ?, ?, run_id, 'enqueued', 'queued', NULL, 0, NULL, ?, 1
      FROM runner_queue_messages
      WHERE run_id = ? AND canonical_message = ?
        AND delivery_state = 'queued'
        AND delivery_attempts = 0
        AND lease_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM runner_queue_events
          WHERE runner_queue_events.run_id = runner_queue_messages.run_id
        )`,
    ).bind(
      this.newIdentifier("queue-event"),
      deduplicationKey,
      canonicalInstant(message.enqueuedAt),
      message.runId,
      canonicalJson(message),
    ).run();
    if (changes(result) !== 1) {
      throw new RunnerQueueProtocolError(
        "Durable RunnerQueue can repair a missing enqueue event only before any delivery or later immutable event.",
      );
    }
  }

  newIdentifier(prefix) {
    const value = `${prefix}:${this.createId()}`;
    requireIdentifier(value, `${prefix} id`);
    return value;
  }
}

async function hydrateRecord(row) {
  if (!row) throw new RunnerQueueProtocolError("Durable RunnerQueue record was not found.");
  let decoded;
  try {
    decoded = JSON.parse(row.canonical_message);
  } catch (cause) {
    throw new RunnerQueueProtocolError("Durable RunnerQueue message is not valid JSON.", { cause });
  }
  const message = await normalizeRunnerQueueMessage(decoded);
  if (
    message.runId !== row.run_id ||
    message.request.attemptId !== row.attempt_id ||
    message.request.idempotencyKey !== row.idempotency_key ||
    message.requestHash !== row.request_hash ||
    canonicalJson(message) !== row.canonical_message
  ) {
    throw new RunnerQueueProtocolError("Durable RunnerQueue columns do not match the signed canonical message.");
  }
  const deliveryAttempt = integer(row.delivery_attempts, "delivery_attempts");
  let lease = null;
  if (row.delivery_state === "leased") {
    requireIdentifier(row.lease_id, "stored leaseId");
    requireIdentifier(row.lease_consumer_id, "stored lease consumerId");
    requireUtcInstant(row.lease_claimed_at, "stored lease claimedAt");
    requireUtcInstant(row.lease_expires_at, "stored lease expiresAt");
    lease = Object.freeze({
      id: row.lease_id,
      consumerId: row.lease_consumer_id,
      claimedAt: row.lease_claimed_at,
      expiresAt: row.lease_expires_at,
      deliveryAttempt,
    });
  }
  return Object.freeze({
    message,
    deliveryState: row.delivery_state,
    availableAt: row.available_at,
    lease,
    deliveryAttempts: deliveryAttempt,
    lastErrorCode: row.last_error_code,
  });
}

function requireAtomicActiveLease(results) {
  if (changes(results[0]) !== 1) {
    throw new RunnerQueueProtocolError("RunnerQueue operation requires an unexpired active lease for this run.");
  }
  requireAtomicMutation(results, "lease transition");
}

function requireAtomicMutation(results, operation) {
  if (!Array.isArray(results) || results.length < 2 || changes(results[0]) !== 1 || changes(results[1]) !== 1) {
    throw new D1RunnerLeaseQueueConfigurationError(
      `Durable RunnerQueue ${operation} did not persist its projection and immutable event together.`,
    );
  }
}

function assertSameEnqueuedMessage({ existingRun, existingIdempotency, canonicalMessage }) {
  if (
    (existingRun && existingRun.canonical_message !== canonicalMessage) ||
    (existingIdempotency && existingIdempotency.canonical_message !== canonicalMessage)
  ) {
    throw new RunnerQueueProtocolError("A durable RunnerQueue identity cannot be reused for a different request.");
  }
}

function assertSameEnqueuedEvent(row, message) {
  if (
    row.run_id !== message.runId ||
    row.event_type !== "enqueued" ||
    row.delivery_state !== "queued" ||
    row.lease_id !== null ||
    integer(row.delivery_attempt, "event delivery_attempt") !== 0 ||
    row.error_code !== null ||
    row.occurred_at !== canonicalInstant(message.enqueuedAt) ||
    (row.event_sequence !== null && nullableEventSequence(row.event_sequence) !== 1)
  ) {
    throw new RunnerQueueProtocolError("A durable RunnerQueue enqueue event contains different immutable evidence.");
  }
}

function changes(result) {
  const value = result?.meta?.changes ?? 0;
  return Number.isSafeInteger(value) ? value : Number(value);
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RunnerQueueProtocolError(`Durable RunnerQueue ${label} is invalid.`);
  }
  return value;
}

function nullableEventSequence(value) {
  if (value === null || value === undefined) return null;
  const sequence = integer(value, "event_sequence");
  if (sequence < 1) {
    throw new RunnerQueueProtocolError("Durable RunnerQueue event_sequence is invalid.");
  }
  return sequence;
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{2,191}$/.test(value)) {
    throw new RunnerQueueProtocolError(`${label} must be a bounded identifier.`);
  }
}

function requireOptionalErrorCode(value, { required = false } = {}) {
  if (value === null && !required) return;
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{2,63}$/.test(value)) {
    throw new RunnerQueueProtocolError("RunnerQueue errorCode must be a bounded privacy-safe code.");
  }
}

function requireUtcInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new RunnerQueueProtocolError(`${label} must be an ISO-8601 UTC instant.`);
  }
}

function requireDuration(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RunnerQueueProtocolError(`${label} must be between ${minimum} and ${maximum} seconds.`);
  }
}

function addSeconds(value, seconds) {
  return new Date(Date.parse(value) + seconds * 1_000).toISOString();
}

function canonicalInstant(value) {
  return new Date(value).toISOString();
}
