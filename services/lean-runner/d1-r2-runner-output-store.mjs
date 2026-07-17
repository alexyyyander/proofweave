export const maxRunnerOutputBytes = 20_000_000;
export const runnerOutputContentType = "text/plain; charset=utf-8";

export class RunnerOutputStoreConflictError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RunnerOutputStoreConflictError";
  }
}

export class RunnerOutputStoreValidationError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RunnerOutputStoreValidationError";
  }
}

/**
 * Immutable R2/D1 persistence for Runner stdout and stderr. These objects are
 * intentionally separate from participant Artifact Bundles: a signed Run
 * result may cite them only after both its exact bytes and immutable index rows
 * exist. The trusted Worker owns this adapter; Containers receive no R2/D1
 * binding.
 */
export class D1R2RunnerOutputStore {
  constructor({ database, bucket }) {
    if (!database || typeof database.prepare !== "function") {
      throw new TypeError("D1R2RunnerOutputStore requires a D1 database binding.");
    }
    if (!bucket || typeof bucket.head !== "function" || typeof bucket.put !== "function") {
      throw new TypeError("D1R2RunnerOutputStore requires an R2 bucket binding.");
    }
    this.database = database;
    this.bucket = bucket;
  }

  async persist({ run, execution }) {
    assertActiveRun(run);
    const normalized = await normalizeExecution(execution);
    if (
      normalized.result.jobId !== run.id ||
      normalized.result.attemptId !== run.attemptId ||
      normalized.result.requestHash !== run.requestHash ||
      normalized.result.artifacts.manifestHash !== run.artifactBundleHash
    ) {
      throw new RunnerOutputStoreValidationError("Runner execution evidence does not match its active Run.");
    }
    const [stdout, stderr] = await Promise.all([
      this.put({ runId: run.id, role: "stdout", bytes: normalized.stdout }),
      this.put({ runId: run.id, role: "stderr", bytes: normalized.stderr }),
    ]);
    if (
      stdout.contentHash !== normalized.result.artifacts.stdoutHash ||
      stderr.contentHash !== normalized.result.artifacts.stderrHash
    ) {
      throw new RunnerOutputStoreValidationError("Persisted Runner output hashes differ from unsigned execution evidence.");
    }
    return Object.freeze({ stdout, stderr });
  }

  async put({ runId, role, bytes }) {
    requireIdentifier(runId, "Runner output Run id");
    requireRole(role);
    const content = requireBytes(bytes, "Runner output bytes");
    if (content.byteLength > maxRunnerOutputBytes) {
      throw new RunnerOutputStoreValidationError(`Runner output exceeds the ${maxRunnerOutputBytes} byte limit.`);
    }
    const contentHash = await sha256Bytes(content);
    const objectKey = keyFor(contentHash, role);
    const id = `runner-output:${runId}:${role}`;
    const existing = await this.database
      .prepare("SELECT id, run_id, role, content_hash, object_key, byte_length, content_type FROM runner_output_artifacts WHERE run_id = ? AND role = ?")
      .bind(runId, role)
      .first();
    if (existing) {
      assertIndexed(existing, { id, runId, role, contentHash, objectKey, byteLength: content.byteLength });
      await this.assertObjectPresent({ contentHash, objectKey, byteLength: content.byteLength });
      return immutableMetadata({ id, runId, role, contentHash, objectKey, byteLength: content.byteLength, created: false });
    }

    const stored = await this.bucket.head(objectKey);
    if (stored) {
      assertR2Object(stored, { contentHash, byteLength: content.byteLength });
    } else {
      const written = await this.bucket.put(objectKey, content, {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: runnerOutputContentType },
        customMetadata: { sha256: contentHash },
      });
      if (written === null) {
        const concurrent = await this.bucket.head(objectKey);
        if (!concurrent) throw new RunnerOutputStoreConflictError("Runner output was not written or found after a conditional R2 write.");
        assertR2Object(concurrent, { contentHash, byteLength: content.byteLength });
      }
    }

    try {
      await this.database
        .prepare(
          "INSERT INTO runner_output_artifacts (id, run_id, role, content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id, runId, role, contentHash, objectKey, content.byteLength, runnerOutputContentType)
        .run();
    } catch (cause) {
      const concurrent = await this.database
        .prepare("SELECT id, run_id, role, content_hash, object_key, byte_length, content_type FROM runner_output_artifacts WHERE run_id = ? AND role = ?")
        .bind(runId, role)
        .first();
      if (!concurrent) throw cause;
      assertIndexed(concurrent, { id, runId, role, contentHash, objectKey, byteLength: content.byteLength });
    }
    return immutableMetadata({ id, runId, role, contentHash, objectKey, byteLength: content.byteLength, created: true });
  }

  async assertObjectPresent({ contentHash, objectKey, byteLength }) {
    const stored = await this.bucket.head(objectKey);
    if (!stored) throw new RunnerOutputStoreValidationError("Indexed Runner output is missing from R2.");
    assertR2Object(stored, { contentHash, byteLength });
  }
}

async function normalizeExecution(execution) {
  if (!execution || typeof execution !== "object" || Array.isArray(execution)) {
    throw new RunnerOutputStoreValidationError("Runner execution evidence must be an object.");
  }
  if (!execution.result || typeof execution.result !== "object" || Array.isArray(execution.result) || !execution.result.artifacts) {
    throw new RunnerOutputStoreValidationError("Runner execution evidence requires unsigned result artifact hashes.");
  }
  const stdout = requireBytes(execution.stdout, "Runner stdout");
  const stderr = requireBytes(execution.stderr, "Runner stderr");
  if (execution.result.artifacts.stdoutHash !== await sha256Bytes(stdout) || execution.result.artifacts.stderrHash !== await sha256Bytes(stderr)) {
    throw new RunnerOutputStoreValidationError("Runner output bytes do not match unsigned execution evidence hashes.");
  }
  return Object.freeze({ result: execution.result, stdout, stderr });
}

function immutableMetadata({ id, runId, role, contentHash, objectKey, byteLength, created }) {
  return Object.freeze({ id, runId, role, contentHash, objectKey, byteLength, contentType: runnerOutputContentType, created });
}

function assertActiveRun(run) {
  if (!run || typeof run !== "object" || !["running", "cancel_requested"].includes(run.state)) {
    throw new RunnerOutputStoreValidationError("Runner output can only be persisted for an active Run.");
  }
  requireIdentifier(run.id, "Run id");
  requireIdentifier(run.attemptId, "Run attempt id");
  requireSha256(run.requestHash, "Run request hash");
  requireSha256(run.artifactBundleHash, "Run artifact bundle hash");
}

function assertIndexed(row, expected) {
  if (
    row.id !== expected.id || row.run_id !== expected.runId || row.role !== expected.role ||
    row.content_hash !== expected.contentHash || row.object_key !== expected.objectKey ||
    Number(row.byte_length) !== expected.byteLength || row.content_type !== runnerOutputContentType
  ) {
    throw new RunnerOutputStoreConflictError("A Runner output role already has different immutable metadata.");
  }
}

function assertR2Object(object, { contentHash, byteLength }) {
  if (object.customMetadata?.sha256 !== contentHash || Number(object.size) !== byteLength) {
    throw new RunnerOutputStoreConflictError("Runner output R2 object does not match its immutable metadata.");
  }
}

function keyFor(contentHash, role) {
  return `runner-results/sha256/${contentHash.slice("sha256:".length)}/${role}.log`;
}

function requireRole(value) {
  if (!["stdout", "stderr"].includes(value)) {
    throw new RunnerOutputStoreValidationError("Runner output role must be stdout or stderr.");
  }
}

function requireBytes(value, label) {
  if (!(value instanceof Uint8Array)) {
    throw new RunnerOutputStoreValidationError(`${label} must be a byte array.`);
  }
  return value;
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 240) {
    throw new RunnerOutputStoreValidationError(`${label} must be a bounded identifier.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new RunnerOutputStoreValidationError(`${label} must be sha256:<hex>.`);
  }
}

async function sha256Bytes(value) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return `sha256:${hex(new Uint8Array(digest))}`;
}

function hex(value) {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
