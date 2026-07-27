import {
  createQueuedRun,
  markRunPreparing,
  markRunStarted,
  recordRunnerResult,
  requestRunCancellation,
} from "../../packages/domain/run.mjs";
import { canonicalJson, sha256Canonical } from "../../packages/protocol/canonical-json.mjs";
import {
  normalizeLeanRunnerResult,
  verifyLeanRunnerResultSignature,
} from "../../packages/protocol/lean-runner.mjs";
import { runnerKeyFingerprint } from "../../packages/protocol/runner-key-registry.mjs";

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
      await this.ensureQueuedEvent(run);
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
    let results;
    try {
      results = await this.database.batch([
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
    } catch (cause) {
      const raced = await this.database
        .prepare("SELECT * FROM runs WHERE attempt_id = ? AND idempotency_key = ?")
        .bind(queued.attemptId, queued.idempotencyKey)
        .first();
      if (!raced) throw cause;
      const run = toRun(raced);
      assertSameQueuedIdentity(run, queued);
      await this.ensureQueuedEvent(run);
      return { run, created: false };
    }
    if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
      throw new RunStoreConflictError("Run queueing did not persist its projection and immutable evidence together.");
    }
    return { run: queued, created: true };
  }

  async find(runId) {
    const row = await this.database.prepare("SELECT * FROM runs WHERE id = ?").bind(runId).first();
    return row ? toRun(row) : null;
  }

  async findByAttemptIdempotency(attemptId, idempotencyKey) {
    const row = await this.database
      .prepare("SELECT * FROM runs WHERE attempt_id = ? AND idempotency_key = ?")
      .bind(attemptId, idempotencyKey)
      .first();
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
    const eventInput = {
      id: `run-event:${runId}:started`,
      eventType: "run_started",
      occurredAt: startedAt,
      payload: { requestHash: current.requestHash },
    };
    if (current.state === "running" && current.startedAt === startedAt) {
      await this.ensureCanonicalEvent({ run: current, ...eventInput });
      return current;
    }
    const next = markRunStarted(current, startedAt);
    return this.persistTransition({ current, next, updatedAt: startedAt, eventInput });
  }

  async prepare(runId, preparingAt) {
    const current = await this.requireRun(runId);
    const eventInput = {
      id: `run-event:${runId}:workspace-preparing`,
      eventType: "workspace_preparation_started",
      occurredAt: preparingAt,
      payload: { requestHash: current.requestHash, artifactBundleHash: current.artifactBundleHash },
    };
    if (current.state === "preparing" && current.preparingAt === preparingAt) {
      await this.ensureCanonicalEvent({ run: current, ...eventInput });
      return current;
    }
    const next = markRunPreparing(current, preparingAt);
    return this.persistTransition({ current, next, updatedAt: preparingAt, eventInput });
  }

  async requestCancellation(runId, requestedAt) {
    const current = await this.requireRun(runId);
    // A caller may retry after losing the first response and cannot know the
    // original server time. Returning the immutable projection avoids a second
    // cancellation event while preserving the first recorded instant.
    if (["cancel_requested", "cancelled"].includes(current.state)) {
      if (current.cancelRequestedAt === null) {
        throw new RunStoreConflictError("Run cancellation projection is missing its immutable request time.");
      }
      await this.ensureCancellationEvent(current);
      return current;
    }
    const next = requestRunCancellation(current, requestedAt);
    return this.persistTransition({
      current,
      next,
      updatedAt: requestedAt,
      eventInput: {
        id: `run-event:${runId}:${next.state === "cancelled" ? "cancelled" : "cancellation-requested"}`,
        eventType: next.state === "cancelled" ? "run_cancelled" : "cancellation_requested",
        occurredAt: requestedAt,
        payload: { requestHash: next.requestHash },
      },
    });
  }

  async recordResult(runId, result, receivedAt) {
    requireUtcInstant(receivedAt, "receivedAt");
    const currentRow = await this.database.prepare("SELECT * FROM runs WHERE id = ?").bind(runId).first();
    if (!currentRow) throw new RunStoreNotFoundError(runId);
    const current = toRun(currentRow);
    const normalizedResult = normalizeLeanRunnerResult(result);
    await this.assertTrustedRunnerSignature(normalizedResult);
    await this.assertStoredOutputArtifacts(runId, normalizedResult);
    if (Date.parse(receivedAt) < Date.parse(currentRow.updated_at)) {
      throw new RunStoreConflictError("Runner result receivedAt cannot precede the current Run projection.");
    }
    if (Date.parse(receivedAt) < Date.parse(normalizedResult.finishedAt)) {
      throw new RunStoreConflictError("Runner result receivedAt cannot precede the signed Runner finish time.");
    }
    const resultHash = await sha256Canonical(normalizedResult);
    const canonicalResult = canonicalJson(normalizedResult);
    const existing = await this.database
      .prepare("SELECT result_hash, canonical_result, received_at FROM run_results WHERE run_id = ?")
      .bind(runId)
      .first();
    if (
      existing &&
      (existing.result_hash !== resultHash || existing.canonical_result !== canonicalResult)
    ) {
      throw new RunStoreConflictError("A Run already has different immutable runner evidence.");
    }
    if (existing) {
      assertStoredResultReceivedAt(existing.received_at, normalizedResult.finishedAt);
    }
    if (existing && current.runnerResultHash === resultHash) {
      await this.assertTerminalResultProjection({
        run: current,
        result: normalizedResult,
        resultHash,
        receivedAt: existing.received_at,
        projectionUpdatedAt: currentRow.updated_at,
      });
      await this.ensureCanonicalResultEvent({ run: current, resultHash, receivedAt: existing.received_at });
      return current;
    }

    const next = recordRunnerResult(current, normalizedResult, resultHash);
    let exactPriorEventSequence = null;
    let expectedCurrentUpdatedAt = null;
    let strictResultRepair = null;
    if (existing) {
      exactPriorEventSequence = await this.assertCanonicalPreResultHistory({
        run: current,
        receivedAt: existing.received_at,
        projectionUpdatedAt: currentRow.updated_at,
      });
      expectedCurrentUpdatedAt = currentRow.updated_at;
      strictResultRepair = { resultHash, receivedAt: existing.received_at };
    }
    const beforeStatements = existing
      ? []
      : [this.database
        .prepare(
          "INSERT INTO run_results (run_id, result_hash, canonical_result, received_at) VALUES (?, ?, ?, ?)",
        )
        .bind(runId, resultHash, canonicalResult, receivedAt)];
    return this.persistTransition({
      current,
      next,
      updatedAt: existing?.received_at ?? receivedAt,
      beforeStatements,
      expectedCurrentUpdatedAt,
      exactPriorEventSequence,
      strictResultRepair,
      eventInput: {
        id: `run-event:${runId}:runner-result`,
        eventType: "runner_result_recorded",
        occurredAt: existing?.received_at ?? receivedAt,
        payload: { requestHash: next.requestHash, resultHash },
      },
    });
  }

  async requireRun(runId) {
    const run = await this.find(runId);
    if (!run) throw new RunStoreNotFoundError(runId);
    return run;
  }

  async assertTrustedRunnerSignature(result) {
    const key = await this.database
      .prepare(
        "SELECT public_key, fingerprint FROM runner_keys WHERE id = ? AND status = 'active' AND revoked_at IS NULL",
      )
      .bind(result.runnerKeyId)
      .first();
    if (!key) {
      throw new RunStoreAuthenticationError("Runner result key is not an active allowlisted key.");
    }
    let expectedFingerprint;
    try {
      expectedFingerprint = await runnerKeyFingerprint(key.public_key);
    } catch {
      throw new RunStoreAuthenticationError("Runner result key record contains an invalid public key.");
    }
    if (key.fingerprint !== expectedFingerprint) {
      throw new RunStoreAuthenticationError("Runner result key fingerprint does not match its public key.");
    }
    if (!await verifyLeanRunnerResultSignature({ result, runnerPublicKey: key.public_key })) {
      throw new RunStoreAuthenticationError("Runner result signature is invalid.");
    }
  }

  async assertStoredOutputArtifacts(runId, result) {
    const rows = await this.database
      .prepare("SELECT role, content_hash FROM runner_output_artifacts WHERE run_id = ?")
      .bind(runId)
      .all();
    const hashes = new Map((rows.results ?? []).map((row) => [row.role, row.content_hash]));
    if (
      hashes.get("stdout") !== result.artifacts.stdoutHash ||
      hashes.get("stderr") !== result.artifacts.stderrHash ||
      hashes.size !== 2
    ) {
      throw new RunStoreConflictError("Runner result output hashes are not backed by immutable Runner output artifacts.");
    }
  }

  projectionStatement(current, next, updatedAt, expectedCurrentUpdatedAt = null) {
    return this.database
      .prepare(
        `UPDATE runs
         SET state = ?, preparing_at = ?, started_at = ?, cancel_requested_at = ?, finished_at = ?,
             runner_result_hash = ?, updated_at = ?
         WHERE id = ? AND state = ?
           AND (? IS NULL OR updated_at = ?)`,
      )
      .bind(
        next.state,
        next.preparingAt,
        next.startedAt,
        next.cancelRequestedAt,
        next.finishedAt,
        next.runnerResultHash,
        updatedAt,
        current.id,
        current.state,
        expectedCurrentUpdatedAt,
        expectedCurrentUpdatedAt,
      );
  }

  async persistTransition({
    current,
    next,
    updatedAt,
    eventInput,
    beforeStatements = [],
    expectedCurrentUpdatedAt = null,
    exactPriorEventSequence = null,
    strictResultRepair = null,
  }) {
    const event = exactPriorEventSequence === null
      ? await this.nextEvent({ run: next, ...eventInput })
      : await createEvent({
        ...eventInput,
        runId: next.id,
        sequence: exactPriorEventSequence + 1,
        state: next.state,
      });
    let results;
    try {
      results = await this.database.batch([
        ...beforeStatements,
        this.projectionStatement(current, next, updatedAt, expectedCurrentUpdatedAt),
        insertGuardedEventStatement(this.database, event, updatedAt, exactPriorEventSequence),
      ]);
    } catch (cause) {
      const latestRow = await this.database.prepare("SELECT * FROM runs WHERE id = ?").bind(current.id).first();
      if (!latestRow) throw new RunStoreNotFoundError(current.id);
      const latest = toRun(latestRow);
      if (sameProjection(latest, next)) {
        if (strictResultRepair) {
          if (latestRow.updated_at !== strictResultRepair.receivedAt) {
            throw new RunStoreConflictError(
              "Canonical Runner result retry found a non-canonical terminal projection time.",
              { cause },
            );
          }
          await this.ensureCanonicalResultEvent({
            run: latest,
            resultHash: strictResultRepair.resultHash,
            receivedAt: strictResultRepair.receivedAt,
          });
        } else {
          await this.ensureCanonicalEvent({ run: latest, ...eventInput });
        }
        return latest;
      }
      throw new RunStoreConflictError("Run state changed before this transition could be persisted.", { cause });
    }
    const projectionIndex = beforeStatements.length;
    if (
      beforeStatements.some((_, index) => changes(results[index]) !== 1) ||
      changes(results[projectionIndex]) !== 1 ||
      changes(results[projectionIndex + 1]) !== 1
    ) {
      throw new RunStoreConflictError("Run transition did not persist its complete projection and immutable evidence.");
    }
    return next;
  }

  async assertCanonicalPreResultHistory({ run, receivedAt, projectionUpdatedAt }) {
    if (!["running", "cancel_requested"].includes(run.state) || run.runnerResultHash !== null) {
      throw new RunStoreConflictError("Legacy Runner result repair requires an active pre-result Run projection.");
    }
    const expectedProjectionTime = run.cancelRequestedAt ?? run.startedAt;
    if (
      projectionUpdatedAt !== expectedProjectionTime ||
      Date.parse(projectionUpdatedAt) > Date.parse(receivedAt)
    ) {
      throw new RunStoreConflictError(
        "Legacy Runner result repair found a projection transition later than its immutable receivedAt.",
      );
    }
    const expected = await this.canonicalPreResultEvents(run);
    if (expected.some((event) => Date.parse(event.occurredAt) > Date.parse(receivedAt))) {
      throw new RunStoreConflictError(
        "Legacy Runner result repair found immutable Run history later than its receivedAt.",
      );
    }
    const rows = await this.database
      .prepare("SELECT * FROM run_events WHERE run_id = ? ORDER BY sequence ASC")
      .bind(run.id)
      .all();
    assertExactEventHistory(rows.results ?? [], expected, "Legacy Runner result repair");
    return expected.length;
  }

  async assertTerminalResultProjection({
    run,
    result,
    resultHash,
    receivedAt,
    projectionUpdatedAt,
  }) {
    if (
      run.runnerResultHash !== resultHash ||
      run.state !== result.status ||
      run.finishedAt !== result.finishedAt ||
      projectionUpdatedAt !== receivedAt
    ) {
      throw new RunStoreConflictError("Stored terminal Run projection does not exactly match its immutable Runner result.");
    }
    if (Date.parse(result.finishedAt) > Date.parse(receivedAt)) {
      throw new RunStoreConflictError("Stored Runner result receivedAt precedes its signed finish time.");
    }
  }

  async canonicalPreResultEvents(run) {
    if (!run.preparingAt || !run.startedAt) {
      throw new RunStoreConflictError("Runner result history requires canonical preparation and start transitions.");
    }
    const expected = [
      await createEvent({
        id: `run-event:${run.id}:queued`,
        runId: run.id,
        sequence: 1,
        eventType: "run_queued",
        state: "queued",
        occurredAt: run.queuedAt,
        payload: {
          artifactBundleHash: run.artifactBundleHash,
          requestHash: run.requestHash,
        },
      }),
      await createEvent({
        id: `run-event:${run.id}:workspace-preparing`,
        runId: run.id,
        sequence: 2,
        eventType: "workspace_preparation_started",
        state: "preparing",
        occurredAt: run.preparingAt,
        payload: {
          requestHash: run.requestHash,
          artifactBundleHash: run.artifactBundleHash,
        },
      }),
      await createEvent({
        id: `run-event:${run.id}:started`,
        runId: run.id,
        sequence: 3,
        eventType: "run_started",
        state: "running",
        occurredAt: run.startedAt,
        payload: { requestHash: run.requestHash },
      }),
    ];
    if (run.cancelRequestedAt !== null) {
      expected.push(await createEvent({
        id: `run-event:${run.id}:cancellation-requested`,
        runId: run.id,
        sequence: 4,
        eventType: "cancellation_requested",
        state: "cancel_requested",
        occurredAt: run.cancelRequestedAt,
        payload: { requestHash: run.requestHash },
      }));
    }
    return expected;
  }

  async ensureCanonicalResultEvent({ run, resultHash, receivedAt }) {
    const prefix = await this.canonicalPreResultEvents(run);
    if (prefix.some((event) => Date.parse(event.occurredAt) > Date.parse(receivedAt))) {
      throw new RunStoreConflictError(
        "Canonical Runner result retry found immutable history later than its receivedAt.",
      );
    }
    const expected = await createEvent({
      id: `run-event:${run.id}:runner-result`,
      runId: run.id,
      sequence: prefix.length + 1,
      eventType: "runner_result_recorded",
      state: run.state,
      occurredAt: receivedAt,
      payload: { requestHash: run.requestHash, resultHash },
    });
    const rows = await this.database
      .prepare("SELECT * FROM run_events WHERE run_id = ? ORDER BY sequence ASC")
      .bind(run.id)
      .all();
    const history = rows.results ?? [];
    if (history.length === prefix.length + 1) {
      assertExactEventHistory(history, [...prefix, expected], "Canonical Runner result retry");
      return;
    }
    assertExactEventHistory(history, prefix, "Canonical Runner result repair");
    try {
      const inserted = await insertEventStatement(this.database, expected).run();
      if (changes(inserted) !== 1) {
        throw new RunStoreConflictError("Canonical Runner result repair did not append immutable evidence.");
      }
    } catch (cause) {
      const raced = await this.database
        .prepare("SELECT * FROM run_events WHERE id = ?")
        .bind(expected.id)
        .first();
      if (!raced) {
        throw new RunStoreConflictError("Canonical Runner result repair conflicted with later history.", { cause });
      }
      assertSameEvent(raced, expected);
      const after = await this.database
        .prepare("SELECT * FROM run_events WHERE run_id = ? ORDER BY sequence ASC")
        .bind(run.id)
        .all();
      assertExactEventHistory(after.results ?? [], [...prefix, expected], "Canonical Runner result retry");
    }
  }

  async nextEvent({ id, run, eventType, occurredAt, payload }) {
    const row = await this.database
      .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM run_events WHERE run_id = ?")
      .bind(run.id)
      .first();
    return createEvent({
      id,
      runId: run.id,
      sequence: Number(row?.next_sequence ?? 1),
      eventType,
      state: run.state,
      occurredAt,
      payload,
    });
  }

  async ensureCanonicalEvent({ id, run, eventType, occurredAt, payload }) {
    const existing = await this.database
      .prepare("SELECT * FROM run_events WHERE id = ?")
      .bind(id)
      .first();
    if (existing) {
      const expected = await createEvent({
        id,
        runId: run.id,
        sequence: Number(existing.sequence),
        eventType,
        state: run.state,
        occurredAt,
        payload,
      });
      assertSameEvent(existing, expected);
      return;
    }
    const event = await this.nextEvent({ id, run, eventType, occurredAt, payload });
    try {
      const inserted = await insertEventStatement(this.database, event).run();
      if (changes(inserted) !== 1) {
        throw new RunStoreConflictError("Run event repair did not append immutable evidence.");
      }
    } catch (cause) {
      const raced = await this.database.prepare("SELECT * FROM run_events WHERE id = ?").bind(id).first();
      if (!raced) {
        throw new RunStoreConflictError("Run event repair conflicted with another transition.", { cause });
      }
      assertSameEvent(raced, await createEvent({
        id,
        runId: run.id,
        sequence: Number(raced.sequence),
        eventType,
        state: run.state,
        occurredAt,
        payload,
      }));
    }
  }

  async ensureQueuedEvent(run) {
    const eventInput = {
      id: `run-event:${run.id}:queued`,
      run: { ...run, state: "queued" },
      eventType: "run_queued",
      occurredAt: run.queuedAt,
      payload: {
        artifactBundleHash: run.artifactBundleHash,
        requestHash: run.requestHash,
      },
    };
    const existing = await this.database
      .prepare("SELECT * FROM run_events WHERE id = ?")
      .bind(eventInput.id)
      .first();
    if (!existing) {
      const count = await this.database
        .prepare("SELECT COUNT(*) AS event_count FROM run_events WHERE run_id = ?")
        .bind(run.id)
        .first();
      if (
        run.state !== "queued" ||
        run.preparingAt !== null ||
        run.startedAt !== null ||
        run.cancelRequestedAt !== null ||
        run.finishedAt !== null ||
        run.runnerResultHash !== null ||
        Number(count?.event_count ?? 0) !== 0
      ) {
        throw new RunStoreConflictError(
          "A missing run_queued event can be repaired only for a pristine queued Run with no later history.",
        );
      }
    }
    await this.ensureCanonicalEvent(eventInput);
  }

  async ensureCancellationEvent(run) {
    const requestedWhileRunning = run.startedAt !== null;
    const expectedState = requestedWhileRunning ? "cancel_requested" : "cancelled";
    const eventInput = {
      id: `run-event:${run.id}:${requestedWhileRunning ? "cancellation-requested" : "cancelled"}`,
      run: { ...run, state: expectedState },
      eventType: requestedWhileRunning ? "cancellation_requested" : "run_cancelled",
      occurredAt: run.cancelRequestedAt,
      payload: { requestHash: run.requestHash },
    };
    const existing = await this.database
      .prepare("SELECT * FROM run_events WHERE id = ?")
      .bind(eventInput.id)
      .first();
    if (!existing) {
      if (run.runnerResultHash !== null) {
        throw new RunStoreConflictError(
          "A missing cancellation event cannot be appended after terminal runner evidence.",
        );
      }
      if (
        run.state !== expectedState ||
        (run.startedAt !== null && run.preparingAt === null) ||
        (expectedState === "cancelled" && run.finishedAt !== run.cancelRequestedAt) ||
        (expectedState === "cancel_requested" && run.finishedAt !== null)
      ) {
        throw new RunStoreConflictError("Run cancellation projection is not safe for canonical event repair.");
      }
      await this.assertCanonicalPreCancellationHistory(run);
    }
    await this.ensureCanonicalEvent(eventInput);
  }

  async assertCanonicalPreCancellationHistory(run) {
    const rows = await this.database
      .prepare("SELECT * FROM run_events WHERE run_id = ? ORDER BY sequence ASC")
      .bind(run.id)
      .all();
    const expected = [
      await createEvent({
        id: `run-event:${run.id}:queued`,
        runId: run.id,
        sequence: 1,
        eventType: "run_queued",
        state: "queued",
        occurredAt: run.queuedAt,
        payload: {
          artifactBundleHash: run.artifactBundleHash,
          requestHash: run.requestHash,
        },
      }),
    ];
    if (run.preparingAt !== null) {
      expected.push(await createEvent({
        id: `run-event:${run.id}:workspace-preparing`,
        runId: run.id,
        sequence: expected.length + 1,
        eventType: "workspace_preparation_started",
        state: "preparing",
        occurredAt: run.preparingAt,
        payload: {
          requestHash: run.requestHash,
          artifactBundleHash: run.artifactBundleHash,
        },
      }));
    }
    if (run.startedAt !== null) {
      expected.push(await createEvent({
        id: `run-event:${run.id}:started`,
        runId: run.id,
        sequence: expected.length + 1,
        eventType: "run_started",
        state: "running",
        occurredAt: run.startedAt,
        payload: { requestHash: run.requestHash },
      }));
    }
    if ((rows.results ?? []).length !== expected.length) {
      throw new RunStoreConflictError("Run history is not an exact canonical prefix for cancellation repair.");
    }
    for (let index = 0; index < expected.length; index += 1) {
      assertSameEvent(rows.results[index], expected[index]);
    }
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
    preparingAt: row.preparing_at,
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

function insertGuardedEventStatement(database, event, updatedAt, exactPriorEventSequence = null) {
  return database
    .prepare(
      `WITH projection_guard AS (
        SELECT 1
        FROM runs
        WHERE id = ? AND state = ? AND updated_at = ?
          AND (
            ? IS NULL
            OR (
              SELECT COUNT(*)
              FROM run_events
              WHERE run_id = ?
            ) = ?
          )
          AND (
            ? IS NULL
            OR (
              SELECT COALESCE(MAX(sequence), 0)
              FROM run_events
              WHERE run_id = ?
            ) = ?
          )
      )
      INSERT INTO run_events (
        id, run_id, sequence, event_type, state, payload_hash, canonical_payload, occurred_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      FROM projection_guard
      UNION ALL
      SELECT ?, NULL, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM projection_guard)`,
    )
    .bind(
      event.runId,
      event.state,
      updatedAt,
      exactPriorEventSequence,
      event.runId,
      exactPriorEventSequence,
      exactPriorEventSequence,
      event.runId,
      exactPriorEventSequence,
      event.id,
      event.runId,
      event.sequence,
      event.eventType,
      event.state,
      event.payloadHash,
      event.canonicalPayload,
      event.occurredAt,
      event.id,
      event.sequence,
      event.eventType,
      event.state,
      event.payloadHash,
      event.canonicalPayload,
      event.occurredAt,
    );
}

function changes(result) {
  const value = result?.meta?.changes ?? 0;
  return Number.isSafeInteger(value) ? value : Number(value);
}

function sameProjection(actual, expected) {
  return [
    "id",
    "state",
    "preparingAt",
    "startedAt",
    "cancelRequestedAt",
    "finishedAt",
    "runnerResultHash",
  ].every((key) => actual[key] === expected[key]);
}

function assertSameEvent(row, expected) {
  if (
    row.id !== expected.id ||
    row.run_id !== expected.runId ||
    Number(row.sequence) !== expected.sequence ||
    row.event_type !== expected.eventType ||
    row.state !== expected.state ||
    row.payload_hash !== expected.payloadHash ||
    row.canonical_payload !== expected.canonicalPayload ||
    row.occurred_at !== expected.occurredAt
  ) {
    throw new RunStoreConflictError("An immutable Run event id already contains different canonical evidence.");
  }
}

function assertExactEventHistory(rows, expected, label) {
  if (rows.length !== expected.length) {
    throw new RunStoreConflictError(`${label} requires an exact canonical Run event prefix.`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    assertSameEvent(rows[index], expected[index]);
  }
}

function requireUtcInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO-8601 UTC instant.`);
  }
}

function assertStoredResultReceivedAt(receivedAt, finishedAt) {
  try {
    requireUtcInstant(receivedAt, "Stored Runner result receivedAt");
  } catch {
    throw new RunStoreConflictError("Stored Runner result receivedAt is not a valid ISO-8601 UTC instant.");
  }
  if (Date.parse(receivedAt) < Date.parse(finishedAt)) {
    throw new RunStoreConflictError("Stored Runner result receivedAt precedes its signed finish time.");
  }
}
