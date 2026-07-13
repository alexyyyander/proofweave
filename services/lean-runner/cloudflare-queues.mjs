import {
  normalizeRunnerQueueMessage,
  RunnerQueueProtocolError,
} from "./queue.mjs";
import { canonicalUtf8 } from "../../packages/protocol/canonical-json.mjs";

// Cloudflare Queues accepts messages smaller than 128 KiB. Runner messages
// contain only an immutable request and its signature, never source bytes.
export const cloudflareRunnerQueueMaxMessageBytes = 128 * 1024;

export class CloudflareRunnerQueueError extends Error {
  constructor(message, { cause } = {}) {
    super(message, { cause });
    this.name = "CloudflareRunnerQueueError";
  }
}

/**
 * Production producer adapter for a Cloudflare Queue binding. Cloudflare
 * confirms durable acceptance when send() resolves, but it intentionally has
 * no cross-request idempotency primitive; the signed Run/request identity is
 * what makes at-least-once delivery safe at the consumer.
 */
export class CloudflareRunnerQueue {
  constructor({ queue }) {
    if (!queue || typeof queue.send !== "function") {
      throw new CloudflareRunnerQueueError("CloudflareRunnerQueue requires a Cloudflare Queue binding with send().");
    }
    this.queue = queue;
  }

  async enqueue(message) {
    const normalized = await normalizeRunnerQueueMessage(message);
    if (canonicalUtf8(normalized).byteLength >= cloudflareRunnerQueueMaxMessageBytes) {
      throw new CloudflareRunnerQueueError("Signed RunnerQueue message exceeds the Cloudflare Queue message limit.");
    }
    try {
      await this.queue.send(normalized);
    } catch (cause) {
      throw new CloudflareRunnerQueueError("Cloudflare Queue did not confirm RunnerQueue message acceptance.", { cause });
    }
    return Object.freeze({ message: normalized, created: true, deliveryState: "queued" });
  }
}

/**
 * Consume one Worker Queue batch. Each message is authenticated before the
 * executor sees it. The executor must resolve only after it has durably stored
 * the signed result; otherwise this adapter explicitly schedules a retry.
 */
export async function consumeCloudflareRunnerBatch({
  batch,
  authenticator,
  execute,
  retryDelaySeconds = 30,
}) {
  if (!batch || !Array.isArray(batch.messages)) {
    throw new CloudflareRunnerQueueError("Cloudflare Queue consumer requires a MessageBatch.");
  }
  if (!authenticator || typeof authenticator.authenticate !== "function") {
    throw new CloudflareRunnerQueueError("Cloudflare Queue consumer requires a RunnerJobAuthenticator.");
  }
  if (typeof execute !== "function") {
    throw new CloudflareRunnerQueueError("Cloudflare Queue consumer requires a durable execution callback.");
  }
  if (!Number.isInteger(retryDelaySeconds) || retryDelaySeconds < 1 || retryDelaySeconds > 86_400) {
    throw new CloudflareRunnerQueueError("Cloudflare Queue retryDelaySeconds must be between 1 and 86400.");
  }

  let acknowledged = 0;
  let retried = 0;
  for (const delivery of batch.messages) {
    if (!delivery || typeof delivery.ack !== "function" || typeof delivery.retry !== "function") {
      throw new CloudflareRunnerQueueError("Cloudflare Queue message must expose ack() and retry().");
    }
    try {
      const message = await authenticator.authenticate(delivery.body);
      await execute(message);
      delivery.ack();
      acknowledged += 1;
    } catch {
      delivery.retry({ delaySeconds: retryDelaySeconds });
      retried += 1;
    }
  }
  return Object.freeze({ acknowledged, retried });
}

/** Keep protocol errors identifiable without leaking a provider exception. */
export function isRunnerQueueMessageError(error) {
  return error instanceof RunnerQueueProtocolError || error instanceof CloudflareRunnerQueueError;
}
