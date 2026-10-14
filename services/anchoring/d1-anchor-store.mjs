import { canonicalJson, sha256Canonical } from "../../packages/protocol/canonical-json.mjs";

export class AnchorStoreConflictError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "AnchorStoreConflictError";
  }
}

export class AnchorStoreNotFoundError extends Error {
  constructor(id) {
    super(`Anchor entity ${id} was not found.`);
    this.name = "AnchorStoreNotFoundError";
  }
}

export class D1AnchorStore {
  constructor(database) {
    if (!database) {
      throw new TypeError("D1AnchorStore requires a D1 database handle.");
    }
    this.database = database;
  }

  newId(prefix) {
    return `${prefix}:${crypto.randomUUID()}`;
  }

  async insertRecord({ recordType, recordId, recordHash, leafHash, createdAt }) {
    const result = await this.database
      .prepare(
        `INSERT OR IGNORE INTO anchor_records (
          id, record_type, record_id, record_hash, leaf_hash, batch_id, created_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      )
      .bind(this.newId("anchor-record"), recordType, recordId, recordHash, leafHash, createdAt)
      .run();
    const record = await this.findRecord({ recordType, recordId, recordHash });
    return { created: changes(result) === 1, record };
  }

  async findRecord({ recordType, recordId, recordHash }) {
    return await this.database
      .prepare("SELECT * FROM anchor_records WHERE record_type = ? AND record_id = ? AND record_hash = ? LIMIT 1")
      .bind(recordType, recordId, recordHash)
      .first();
  }

  async countPendingRecords() {
    const row = await this.database
      .prepare("SELECT COUNT(*) AS pending_count FROM anchor_records WHERE batch_id IS NULL")
      .first();
    return Number(row?.pending_count ?? 0);
  }

  async listPendingRecords(limit = 1000) {
    const rows = await this.database
      .prepare(
        `SELECT * FROM anchor_records
         WHERE batch_id IS NULL
         ORDER BY record_type, record_id, record_hash
         LIMIT ?`,
      )
      .bind(limit)
      .all();
    return rows.results ?? [];
  }

  async createBatch({ id, root, leafCount, manifestHash, manifestKey, prevBatchId, prevRoot, chain, network, createdAt, leaves, expectedHeadVersion = null }) {
    if (!Array.isArray(leaves) || leaves.length === 0) {
      throw new TypeError("Anchor batch must append at least one leaf; empty anchor batches are not allowed.");
    }
    if (leafCount !== leaves.length) {
      throw new TypeError("Anchor batch leafCount must equal the number of provided leaves.");
    }
    if (expectedHeadVersion !== null && (!Number.isSafeInteger(expectedHeadVersion) || expectedHeadVersion < 0)) {
      throw new TypeError("Anchor batch expectedHeadVersion must be a non-negative integer.");
    }
    let expectedVersion = expectedHeadVersion;
    if (expectedVersion === null) {
      const headRow = await this.database
        .prepare("SELECT * FROM anchor_log_head ORDER BY version DESC LIMIT 1")
        .first();
      expectedVersion = Number(headRow?.version ?? 0);
    }
    const batchInsert = this.database
      .prepare(
        `INSERT INTO anchor_batches (
          id, status, root, leaf_count, manifest_hash, manifest_key,
          prev_batch_id, prev_root, chain, network, witness_count, created_at, anchored_at
        ) VALUES (?, 'built', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL)`,
      )
      .bind(id, root, leafCount, manifestHash, manifestKey, prevBatchId, prevRoot, chain, network, createdAt);
    const leafUpdates = leaves.map((leaf) =>
      this.database
        .prepare(
          `UPDATE anchor_records
           SET batch_id = ?
           WHERE batch_id IS NULL AND record_type = ? AND record_id = ? AND record_hash = ?`,
        )
        .bind(id, leaf.record_type, leaf.record_id, leaf.record_hash),
    );
    // CAS: the trailing head INSERT claims version = expectedVersion + 1; when a
    // concurrent writer has already committed that version the PRIMARY KEY
    // conflict fails the statement and D1 rolls back this entire batch
    // atomically — that conflict IS the compare-and-swap. The guard below
    // converts every other violated invariant into the same guaranteed
    // conflict by re-inserting the expected version (whose row always
    // exists): it trips when any leaf failed to bind to a pending record, or
    // when the head row at commit time no longer matches the caller's
    // observed (expectedHeadVersion, prevBatchId, prevRoot) triple — closing
    // the silent fork where a stale prev pointer would otherwise commit
    // cleanly on top of a log that already moved on.
    const leafGuard = this.database
      .prepare(
        `INSERT INTO anchor_log_head (version, head_batch_id, head_root, updated_at)
         SELECT ?, NULL, NULL, ?
         WHERE (SELECT COUNT(*) FROM anchor_records WHERE batch_id = ?) != ?
            OR NOT EXISTS (
              SELECT 1 FROM anchor_log_head
              WHERE version = ? AND head_batch_id IS ? AND head_root IS ?
            )`,
      )
      .bind(expectedVersion, createdAt, id, leaves.length, expectedVersion, prevBatchId, prevRoot);
    const headInsert = this.database
      .prepare(
        "INSERT INTO anchor_log_head (version, head_batch_id, head_root, updated_at) VALUES (?, ?, ?, ?)",
      )
      .bind(expectedVersion + 1, id, root, createdAt);
    const statements = [
      batchInsert,
      ...leafUpdates,
      ...(await this.eventStatements(id, "batch_built", {
        batchId: id,
        root,
        leafCount,
        manifestHash,
        manifestKey,
        prevBatchId,
        prevRoot,
        chain,
        network,
      }, createdAt)),
      leafGuard,
      headInsert,
    ];
    let results;
    try {
      results = await this.database.batch(statements);
    } catch (cause) {
      if (isUniqueConstraintError(cause)) {
        throw new AnchorStoreConflictError(
          "Anchor batch build lost the log head CAS race or conflicted with an existing anchor batch.",
          { cause },
        );
      }
      throw cause;
    }
    const eventIndex = 1 + leafUpdates.length;
    if (
      changes(results[0]) !== 1 ||
      leafUpdates.some((_, index) => changes(results[1 + index]) !== 1) ||
      changes(results[eventIndex]) !== 1 ||
      changes(results[eventIndex + 2]) !== 1
    ) {
      throw new AnchorStoreConflictError(
        "Anchor batch build did not persist its projection, immutable evidence, and log head together.",
      );
    }
    return { batch: await this.getBatch(id) };
  }

  async getBatch(batchId) {
    return await this.database.prepare("SELECT * FROM anchor_batches WHERE id = ?").bind(batchId).first();
  }

  async listBatches({ limit = 50, offset = 0 } = {}) {
    const rows = await this.database
      .prepare("SELECT * FROM anchor_batches ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?")
      .bind(limit, offset)
      .all();
    return rows.results ?? [];
  }

  async getLatestBatch() {
    return await this.database
      .prepare("SELECT * FROM anchor_batches ORDER BY created_at DESC, id DESC LIMIT 1")
      .first();
  }

  async getLogHead() {
    const row = await this.database
      .prepare("SELECT * FROM anchor_log_head ORDER BY version DESC LIMIT 1")
      .first();
    return {
      headBatchId: row?.head_batch_id ?? null,
      headRoot: row?.head_root ?? null,
      version: Number(row?.version ?? 0),
    };
  }

  async markSubmitted(batchId, txRef, submittedAt) {
    const batch = await this.getBatch(batchId);
    if (!batch) throw new AnchorStoreNotFoundError(batchId);
    if (batch.status !== "built") {
      throw new AnchorStoreConflictError(
        `Anchor batch ${batchId} must be in 'built' status to record a platform submission (found '${batch.status}').`,
      );
    }
    const submissionId = this.newId("anchor-submission");
    const statements = [
      this.database
        .prepare("UPDATE anchor_batches SET status = 'submitted' WHERE id = ? AND status = 'built'")
        .bind(batchId),
      this.database
        .prepare(
          `INSERT INTO anchor_submissions (
            id, batch_id, submitter_kind, submitter_id, chain, network, tx_ref, status, confirmations, block_ref, submitted_at, updated_at
          ) VALUES (?, ?, 'platform', 'platform', ?, ?, ?, 'pending', 0, NULL, ?, ?)`,
        )
        .bind(submissionId, batchId, batch.chain, batch.network, txRef, submittedAt, submittedAt),
      ...(await this.eventStatements(batchId, "platform_submitted", {
        batchId,
        submissionId,
        txRef,
      }, submittedAt)),
    ];
    let results;
    try {
      results = await this.database.batch(statements);
    } catch (cause) {
      if (isUniqueConstraintError(cause)) {
        throw new AnchorStoreConflictError(
          "Anchor submission transaction reference already exists for this chain and network.",
          { cause },
        );
      }
      throw cause;
    }
    if (results.some((result) => changes(result) !== 1)) {
      throw new AnchorStoreConflictError(
        "Platform submission did not persist its projection and immutable evidence together.",
      );
    }
    return { batch: await this.getBatch(batchId), submissionId };
  }

  async recordSubmission({ batchId, submitterKind, submitterId, chain, network, txRef, submittedAt }) {
    const result = await this.database
      .prepare(
        `INSERT OR IGNORE INTO anchor_submissions (
          id, batch_id, submitter_kind, submitter_id, chain, network, tx_ref, status, confirmations, block_ref, submitted_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?)`,
      )
      .bind(this.newId("anchor-submission"), batchId, submitterKind, submitterId, chain, network, txRef, submittedAt, submittedAt)
      .run();
    const submission = await this.database
      .prepare("SELECT * FROM anchor_submissions WHERE chain = ? AND network = ? AND tx_ref = ? LIMIT 1")
      .bind(chain, network, txRef)
      .first();
    return { created: changes(result) === 1, submission };
  }

  async updateSubmissionStatus({ submissionId, status, confirmations, blockRef, updatedAt }) {
    if (!["confirmed", "failed"].includes(status)) {
      throw new TypeError("Anchor submission status may only transition to 'confirmed' or 'failed'.");
    }
    const row = await this.database
      .prepare("SELECT * FROM anchor_submissions WHERE id = ?")
      .bind(submissionId)
      .first();
    if (!row) throw new AnchorStoreNotFoundError(submissionId);
    if (row.status !== "pending") {
      throw new AnchorStoreConflictError(
        `Anchor submission ${submissionId} has already left 'pending' status (found '${row.status}'); terminal transitions are immutable.`,
      );
    }
    const parentBatch = await this.getBatch(row.batch_id);
    if (parentBatch?.status === "failed") {
      throw new AnchorStoreConflictError(
        `Anchor batch ${row.batch_id} is failed; its submissions can no longer transition.`,
      );
    }
    // The event id is status-independent so two transitions with different
    // outcomes collide on the same event PRIMARY KEY; the house guarded-event
    // pattern (INSERT...SELECT gated on the projection having landed) keeps
    // evidence and projection atomically consistent, and the batch-status
    // filter in the UPDATE refuses transitions for failed anchor batches.
    const eventId = `anchor-batch-event:${row.batch_id}:submission_status:${submissionId}`;
    const eventType = status === "confirmed" ? "submission_confirmed" : "submission_failed";
    const payload = { submissionId, status, confirmations, blockRef };
    const results = await this.database.batch([
      this.database
        .prepare(
          `UPDATE anchor_submissions
           SET status = ?, confirmations = ?, block_ref = ?, updated_at = ?
           WHERE id = ? AND status = 'pending'
             AND batch_id IN (SELECT id FROM anchor_batches WHERE status != 'failed')`,
        )
        .bind(status, confirmations, blockRef, updatedAt, submissionId),
      this.database
        .prepare(
          `INSERT INTO anchor_batch_events (
            id, batch_id, event_type, payload_hash, canonical_payload, created_at
          )
          SELECT ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM anchor_submissions WHERE id = ? AND status = ? AND updated_at = ?
          )`,
        )
        .bind(
          eventId,
          row.batch_id,
          eventType,
          await sha256Canonical(payload),
          canonicalJson(payload),
          updatedAt,
          submissionId,
          status,
          updatedAt,
        ),
    ]);
    if (results.some((result) => changes(result) !== 1)) {
      throw new AnchorStoreConflictError(
        "Anchor submission transition did not persist its projection and immutable evidence together.",
      );
    }
    return await this.database
      .prepare("SELECT * FROM anchor_submissions WHERE id = ?")
      .bind(submissionId)
      .first();
  }

  async listSubmissions(batchId) {
    const rows = await this.database
      .prepare("SELECT * FROM anchor_submissions WHERE batch_id = ? ORDER BY submitted_at, id")
      .bind(batchId)
      .all();
    return rows.results ?? [];
  }

  async listPendingSubmissions() {
    const rows = await this.database
      .prepare(
        `SELECT s.* FROM anchor_submissions s
         JOIN anchor_batches b ON b.id = s.batch_id
         WHERE s.status = 'pending'
         ORDER BY s.submitted_at, s.id`,
      )
      .all();
    return rows.results ?? [];
  }

  async listManifestLeaves(batchId) {
    const rows = await this.database
      .prepare(
        `SELECT record_type, record_id, record_hash FROM anchor_records
         WHERE batch_id = ?
         ORDER BY record_type, record_id, record_hash`,
      )
      .bind(batchId)
      .all();
    return (rows.results ?? []).map((row) => ({
      recordType: row.record_type,
      recordId: row.record_id,
      recordHash: row.record_hash,
    }));
  }

  async getConfirmedPlatformSubmission(batchId) {
    return await this.database
      .prepare(
        `SELECT * FROM anchor_submissions
         WHERE batch_id = ? AND submitter_kind = 'platform' AND status = 'confirmed'
         ORDER BY submitted_at, id
         LIMIT 1`,
      )
      .bind(batchId)
      .first();
  }

  async markBatchConfirmed(batchId, anchoredAt) {
    const batch = await this.getBatch(batchId);
    if (!batch) throw new AnchorStoreNotFoundError(batchId);
    if (batch.status !== "submitted") {
      throw new AnchorStoreConflictError(
        `Anchor batch ${batchId} must be in 'submitted' status to confirm anchoring (found '${batch.status}').`,
      );
    }
    const platform = await this.getConfirmedPlatformSubmission(batchId);
    if (!platform) {
      throw new AnchorStoreConflictError(
        `Anchor batch ${batchId} has no confirmed platform submission; anchoring cannot be confirmed.`,
      );
    }
    const headRow = await this.database
      .prepare("SELECT * FROM anchor_log_head ORDER BY version DESC LIMIT 1")
      .first();
    const headVersion = Number(headRow?.version ?? 0);
    // In-transaction guard: re-inserting the current head version (whose row
    // always exists) fails with a PRIMARY KEY conflict — aborting the whole
    // batch — unless the projection still reads 'submitted' at commit time,
    // so a concurrent status change can never leave a confirmed projection
    // without its immutable evidence.
    let results;
    try {
      results = await this.database.batch([
        this.database
          .prepare(
            `INSERT INTO anchor_log_head (version, head_batch_id, head_root, updated_at)
             SELECT ?, NULL, NULL, ?
             WHERE (SELECT status FROM anchor_batches WHERE id = ?) IS NOT 'submitted'`,
          )
          .bind(headVersion, anchoredAt, batchId),
        this.database
          .prepare(
            "UPDATE anchor_batches SET status = 'confirmed', anchored_at = ? WHERE id = ? AND status = 'submitted'",
          )
          .bind(anchoredAt, batchId),
        ...(await this.eventStatements(batchId, "batch_confirmed", {
          batchId,
          anchoredAt,
          submissionId: platform.id,
        }, anchoredAt)),
      ]);
    } catch (cause) {
      if (isUniqueConstraintError(cause)) {
        throw new AnchorStoreConflictError(
          `Anchor batch ${batchId} confirmation raced a concurrent status change.`,
          { cause },
        );
      }
      throw cause;
    }
    if (changes(results[1]) !== 1 || changes(results[2]) !== 1) {
      throw new AnchorStoreConflictError(
        "Anchor batch confirmation did not persist its projection and immutable evidence together.",
      );
    }
    return await this.getBatch(batchId);
  }

  async syncWitnessCount(batchId, updatedAt) {
    const batch = await this.getBatch(batchId);
    if (!batch) throw new AnchorStoreNotFoundError(batchId);
    const row = await this.database
      .prepare(
        `SELECT COUNT(DISTINCT submitter_id) AS witness_count FROM anchor_submissions
         WHERE batch_id = ? AND submitter_kind = 'witness' AND status = 'confirmed'`,
      )
      .bind(batchId)
      .first();
    const witnessCount = Number(row?.witness_count ?? 0);
    const results = await this.database.batch([
      this.database
        .prepare("UPDATE anchor_batches SET witness_count = ? WHERE id = ?")
        .bind(witnessCount, batchId),
      ...(await this.eventStatements(batchId, "witness_count_synced", {
        batchId,
        witnessCount,
      }, updatedAt, { dedupeKey: String(witnessCount), orIgnore: true })),
    ]);
    if (changes(results[0]) !== 1) {
      throw new AnchorStoreNotFoundError(batchId);
    }
    return await this.getBatch(batchId);
  }

  async abandonBatch(batchId, updatedAt) {
    const batch = await this.getBatch(batchId);
    if (!batch) throw new AnchorStoreNotFoundError(batchId);
    if (!["built", "submitted"].includes(batch.status)) {
      throw new AnchorStoreConflictError(
        `Anchor batch ${batchId} cannot be abandoned from terminal status '${batch.status}'.`,
      );
    }
    const pending = await this.database
      .prepare(
        "SELECT 1 AS pending FROM anchor_submissions WHERE batch_id = ? AND status = 'pending' LIMIT 1",
      )
      .bind(batchId)
      .first();
    if (pending) {
      throw new AnchorStoreConflictError(
        `Anchor batch ${batchId} has a pending submission and cannot be abandoned while an anchor is in flight.`,
      );
    }
    const confirmed = await this.database
      .prepare(
        "SELECT 1 AS confirmed FROM anchor_submissions WHERE batch_id = ? AND status = 'confirmed' LIMIT 1",
      )
      .bind(batchId)
      .first();
    if (confirmed) {
      throw new AnchorStoreConflictError(
        `Anchor batch ${batchId} has a confirmed submission and cannot be abandoned.`,
      );
    }
    const headRow = await this.database
      .prepare("SELECT * FROM anchor_log_head ORDER BY version DESC LIMIT 1")
      .first();
    const expectedHeadVersion = Number(headRow?.version ?? 0);
    // In-transaction guard: re-inserting the current head version (whose row
    // is guaranteed to exist) fails with a PRIMARY KEY conflict and aborts the
    // whole batch unless, at commit time, the batch still has no confirmed
    // submission AND is still the log tip — abandoning a non-tip batch would
    // otherwise erase its successors from the head log.
    let results;
    try {
      results = await this.database.batch([
        this.database
          .prepare("UPDATE anchor_records SET batch_id = NULL WHERE batch_id = ?")
          .bind(batchId),
        this.database
          .prepare(
            `INSERT INTO anchor_log_head (version, head_batch_id, head_root, updated_at)
             SELECT ?, NULL, NULL, ?
             WHERE (SELECT COUNT(*) FROM anchor_submissions WHERE batch_id = ? AND status = 'confirmed') > 0
                OR (SELECT head_batch_id FROM anchor_log_head ORDER BY version DESC LIMIT 1) IS NOT ?`,
          )
          .bind(expectedHeadVersion, updatedAt, batchId, batchId),
        this.database
          .prepare(
            "INSERT INTO anchor_log_head (version, head_batch_id, head_root, updated_at) VALUES (?, ?, ?, ?)",
          )
          .bind(expectedHeadVersion + 1, batch.prev_batch_id, batch.prev_root, updatedAt),
        this.database
          .prepare("UPDATE anchor_batches SET status = 'failed' WHERE id = ? AND status IN ('built', 'submitted')")
          .bind(batchId),
        ...(await this.eventStatements(batchId, "batch_abandoned", {
          batchId,
          releasedRecords: batch.leaf_count,
          restoredHeadBatchId: batch.prev_batch_id,
          restoredHeadRoot: batch.prev_root,
        }, updatedAt)),
      ]);
    } catch (cause) {
      if (isUniqueConstraintError(cause)) {
        throw new AnchorStoreConflictError(
          "Anchor batch abandonment lost the log head CAS race or is no longer the log tip.",
          { cause },
        );
      }
      throw cause;
    }
    if (
      changes(results[0]) !== batch.leaf_count ||
      changes(results[2]) !== 1 ||
      changes(results[3]) !== 1 ||
      changes(results[4]) !== 1
    ) {
      throw new AnchorStoreConflictError(
        "Anchor batch abandonment did not release records, restore the head, and fail the projection atomically.",
      );
    }
    return await this.getBatch(batchId);
  }

  async listBatchEvents(batchId) {
    const rows = await this.database
      .prepare("SELECT * FROM anchor_batch_events WHERE batch_id = ? ORDER BY created_at, id")
      .bind(batchId)
      .all();
    return rows.results ?? [];
  }

  async eventStatements(batchId, eventType, payload, createdAt, { dedupeKey = null, orIgnore = false } = {}) {
    const id = dedupeKey === null
      ? `anchor-batch-event:${batchId}:${eventType}`
      : `anchor-batch-event:${batchId}:${eventType}:${dedupeKey}`;
    return [
      this.database
        .prepare(
          `${orIgnore ? "INSERT OR IGNORE" : "INSERT"} INTO anchor_batch_events (
            id, batch_id, event_type, payload_hash, canonical_payload, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, batchId, eventType, await sha256Canonical(payload), canonicalJson(payload), createdAt),
    ];
  }
}

function isUniqueConstraintError(cause) {
  return cause instanceof Error && /UNIQUE constraint failed/.test(cause.message);
}

function changes(result) {
  const value = result?.meta?.changes ?? 0;
  return Number.isSafeInteger(value) ? value : Number(value);
}
