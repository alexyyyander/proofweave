import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PinnedRunnerImageRegistry } from "../services/lean-runner/runner-image-policy.mjs";
import { RunnerJobAuthenticator } from "../services/lean-runner/queue.mjs";

/**
 * Validate the non-secret deployment topology for the isolated Lean Runner.
 * Its rendered configuration always leaves execution disabled; an operator
 * must complete the separately documented non-production and incident gates
 * before changing the kill switch in a deployed Worker.
 */
export function validateLeanRunnerDeploymentManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Runner deployment manifest must be a JSON object.");
  }
  rejectExtraKeys(value, ["control_plane", "queue", "runner", "keys"], "Runner deployment manifest");
  const controlPlane = object(value.control_plane, "control_plane");
  const queue = object(value.queue, "queue");
  const runner = object(value.runner, "runner");
  const keys = object(value.keys, "keys");
  rejectExtraKeys(controlPlane, ["d1_database_name", "d1_database_id", "r2_bucket_name"], "control_plane");
  rejectExtraKeys(queue, ["name", "dead_letter_queue", "max_batch_size", "max_batch_timeout_seconds", "max_retries", "max_concurrency"], "queue");
  rejectExtraKeys(runner, ["worker_name", "container_class", "image", "retry_delay_seconds"], "runner");
  rejectExtraKeys(keys, ["control_plane_issuer", "runner_result_key_id"], "keys");

  const normalizedControlPlane = Object.freeze({
    databaseName: requiredName(controlPlane.d1_database_name, "control_plane.d1_database_name"),
    databaseId: requiredUuid(controlPlane.d1_database_id, "control_plane.d1_database_id"),
    bucketName: requiredName(controlPlane.r2_bucket_name, "control_plane.r2_bucket_name"),
  });
  const normalizedQueue = Object.freeze({
    name: requiredQueueName(queue.name, "queue.name"),
    deadLetterQueue: requiredQueueName(queue.dead_letter_queue, "queue.dead_letter_queue"),
    maxBatchSize: requiredInteger(queue.max_batch_size, "queue.max_batch_size", { min: 1, max: 1 }),
    maxBatchTimeoutSeconds: requiredInteger(queue.max_batch_timeout_seconds, "queue.max_batch_timeout_seconds", { min: 1, max: 60 }),
    maxRetries: requiredInteger(queue.max_retries, "queue.max_retries", { min: 1, max: 10 }),
    maxConcurrency: requiredInteger(queue.max_concurrency, "queue.max_concurrency", { min: 1, max: 1 }),
  });
  if (normalizedQueue.name === normalizedQueue.deadLetterQueue) {
    throw new Error("queue.name and queue.dead_letter_queue must be different resources.");
  }

  const image = object(runner.image, "runner.image");
  rejectExtraKeys(image, ["image_digest", "lean_toolchain", "mathlib_revision"], "runner.image");
  const normalizedImage = Object.freeze({
    imageDigest: requiredImageDigest(image.image_digest, "runner.image.image_digest"),
    leanToolchain: requiredText(image.lean_toolchain, "runner.image.lean_toolchain", 240),
    mathlibRevision: requiredText(image.mathlib_revision, "runner.image.mathlib_revision", 160),
  });
  // Reuse the runtime allowlist constructor so preflight and Queue execution
  // cannot silently disagree about what constitutes an approved image.
  new PinnedRunnerImageRegistry({ images: [normalizedImage] });

  const normalizedRunner = Object.freeze({
    workerName: requiredWorkerName(runner.worker_name, "runner.worker_name"),
    containerClass: requiredExact(runner.container_class, "LeanRunnerContainer", "runner.container_class"),
    image: normalizedImage,
    retryDelaySeconds: requiredInteger(runner.retry_delay_seconds, "runner.retry_delay_seconds", { min: 1, max: 86_400 }),
  });
  const issuer = object(keys.control_plane_issuer, "keys.control_plane_issuer");
  rejectExtraKeys(issuer, ["id", "public_key"], "keys.control_plane_issuer");
  const normalizedIssuer = Object.freeze({
    id: requiredIdentifier(issuer.id, "keys.control_plane_issuer.id"),
    publicKey: requiredPublicKey(issuer.public_key, "keys.control_plane_issuer.public_key"),
  });
  // This validates the same identifier/public-key restrictions used before a
  // Queue delivery can be accepted by the Runner Worker.
  new RunnerJobAuthenticator({ issuerKeys: [normalizedIssuer] });
  const normalizedKeys = Object.freeze({
    controlPlaneIssuer: normalizedIssuer,
    runnerResultKeyId: requiredIdentifier(keys.runner_result_key_id, "keys.runner_result_key_id"),
  });

  return Object.freeze({
    controlPlane: normalizedControlPlane,
    queue: normalizedQueue,
    runner: normalizedRunner,
    keys: normalizedKeys,
  });
}

/** Render only non-secret Worker configuration, with execution hard-disabled. */
export function renderLeanRunnerWranglerConfig(manifest) {
  const config = validateLeanRunnerDeploymentManifest(manifest);
  return JSON.stringify({
    "$schema": "../../node_modules/wrangler/config-schema.json",
    name: config.runner.workerName,
    main: "cloudflare-worker.mjs",
    compatibility_date: "2026-07-13",
    compatibility_flags: ["nodejs_compat"],
    queues: {
      consumers: [{
        queue: config.queue.name,
        max_batch_size: config.queue.maxBatchSize,
        max_batch_timeout: config.queue.maxBatchTimeoutSeconds,
        max_retries: config.queue.maxRetries,
        dead_letter_queue: config.queue.deadLetterQueue,
        max_concurrency: config.queue.maxConcurrency,
      }],
    },
    vars: {
      RUNNER_EXECUTION_ENABLED: "false",
      RUNNER_APPROVED_IMAGES_JSON: JSON.stringify([config.runner.image]),
      RUNNER_CONTROL_PLANE_ISSUER_KEYS_JSON: JSON.stringify([config.keys.controlPlaneIssuer]),
      RUNNER_RESULT_KEY_ID: config.keys.runnerResultKeyId,
      RUNNER_RETRY_DELAY_SECONDS: String(config.runner.retryDelaySeconds),
    },
    containers: [{
      class_name: config.runner.containerClass,
      image: config.runner.image.imageDigest,
      max_instances: 1,
      instance_type: "standard-1",
    }],
    durable_objects: { bindings: [{ name: "LEAN_RUNNER_CONTAINER", class_name: config.runner.containerClass }] },
    migrations: [{ tag: "v1", new_sqlite_classes: [config.runner.containerClass] }],
    d1_databases: [{
      binding: "DB",
      database_name: config.controlPlane.databaseName,
      database_id: config.controlPlane.databaseId,
    }],
    r2_buckets: [{ binding: "ARTIFACTS", bucket_name: config.controlPlane.bucketName }],
  }, null, 2) + "\n";
}

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    throw new Error("Usage: node scripts/preflight-lean-runner-deployment.mjs <runner-deployment-manifest.json>");
  }
  const source = await readFile(manifestPath, "utf8");
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch {
    throw new Error("Runner deployment manifest must be valid JSON.");
  }
  validateLeanRunnerDeploymentManifest(manifest);
  process.stdout.write(`${renderLeanRunnerWranglerConfig(manifest)}\n`);
  process.stdout.write("Runner deployment manifest is valid. The rendered Worker keeps RUNNER_EXECUTION_ENABLED=false and does not include the Runner result private key. Complete the documented non-production, observability, backup, and incident gates before enabling execution.\n");
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function rejectExtraKeys(value, allowed, label) {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) throw new Error(`${label} contains unsupported field ${unexpected}.`);
}

function requiredName(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(value) || isPlaceholder(value)) {
    throw new Error(`${label} must be a non-placeholder Cloudflare resource name.`);
  }
  return value;
}

function requiredQueueName(value, label) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{2,62}$/.test(value) || isPlaceholder(value)) {
    throw new Error(`${label} must be a lowercase Cloudflare Queue name.`);
  }
  return value;
}

function requiredWorkerName(value, label) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{2,62}$/.test(value) || isPlaceholder(value)) {
    throw new Error(`${label} must be a lowercase Cloudflare Worker name.`);
  }
  return value;
}

function requiredUuid(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) || isPlaceholder(value)) {
    throw new Error(`${label} must be a non-placeholder D1 database UUID.`);
  }
  return value;
}

function requiredImageDigest(value, label) {
  if (typeof value !== "string" || isPlaceholder(value)) {
    throw new Error(`${label} must be an immutable non-placeholder image reference.`);
  }
  return value;
}

function requiredText(value, label, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength || isPlaceholder(value)) {
    throw new Error(`${label} must be a non-placeholder non-empty value.`);
  }
  return value;
}

function requiredInteger(value, label, { min, max }) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function requiredExact(value, expected, label) {
  if (value !== expected) throw new Error(`${label} must be ${expected}.`);
  return value;
}

function requiredIdentifier(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 240 || /[\0\r\n]/.test(value) || isPlaceholder(value)) {
    throw new Error(`${label} must be a non-placeholder bounded identifier.`);
  }
  return value;
}

function requiredPublicKey(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value) || /^A{43}$/.test(value) || isPlaceholder(value)) {
    throw new Error(`${label} must be a non-placeholder base64url Ed25519 public key.`);
  }
  return value;
}

function isPlaceholder(value) {
  return value.includes("REPLACE_") || value.includes("example") || value.includes("localhost");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Invalid Runner deployment manifest."}\n`);
    process.exitCode = 1;
  });
}
