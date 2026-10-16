// services/anchoring/anchor-coordinator.mjs
import { anchorManifestHash, anchorManifestProtocolVersion } from "../../packages/protocol/anchor-manifest.mjs";
import { anchorWitnessProtocolVersion } from "../../packages/protocol/anchor-witness.mjs";
import { parseTxRef } from "./anchor-chain-adapter.mjs";

export class AnchorCoordinatorError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "AnchorCoordinatorError";
  }
}

const FAILED_CONFIRMATION_STATUSES = new Set(["failed", "reverted", "dropped"]);

/**
 * Orchestrates the anchoring pipeline: build → content-addressed manifest store →
 * persist prepared transaction → broadcast → markSubmitted, plus confirmation polling, crash recovery,
 * and the five-gate witness submission flow (spec §2.4).
 *
 * submitWitness rejection reasons:
 *   "unknown_batch"         — no batch row for the given batchId
 *   "payload_mismatch"      — signed payload does not attest the submitted txRef / batch row
 *                             (protocolVersion, batchId, txRef, root, manifestHash must all match)
 *   "invalid_signature"     — verifyWitnessAuthority failure
 *   "invalid_txref"         — txRef is not a <chain>:<network>:<txId> triple
 *   "network_mismatch"      — txRef chain:network differs from the batch's canonical network
 *   "chain_truth_mismatch"  — on-chain tx missing or does not carry the batch's anchor payload
 *   "not_independent"       — tx sender is the platform operator, or the txRef is already
 *                             recorded for a platform submission or a different submitter
 *   "batch_failed"          — the batch is terminally failed; new witness evidence is refused
 */
export function createAnchorCoordinator({
  store, builder, manifestStorage, adapter, config, verifyWitnessAuthority, now = () => new Date().toISOString(),
}) {
  for (const [name, value] of Object.entries({ store, builder, manifestStorage, adapter, verifyWitnessAuthority })) {
    if (!value) throw new TypeError(`createAnchorCoordinator requires ${name}.`);
  }
  for (const key of ["minLeafCount", "maxIntervalSeconds", "confirmationThreshold"]) {
    if (config?.[key] === undefined) throw new TypeError(`createAnchorCoordinator requires config.${key}.`);
  }

  /** Rebuild the canonical manifest from the immutable batch projection + its bound leaves,
   *  refusing to proceed if the recomputed hash differs from the recorded manifest_hash. */
  async function rebuildManifest(batch) {
    const manifest = {
      protocolVersion: anchorManifestProtocolVersion,
      batchId: batch.id,
      root: batch.root,
      leafCount: batch.leaf_count,
      prevBatchId: batch.prev_batch_id,
      prevRoot: batch.prev_root,
      createdAt: batch.created_at,
      leaves: await store.listManifestLeaves(batch.id),
    };
    const manifestHash = await anchorManifestHash(manifest);
    if (manifestHash !== batch.manifest_hash) {
      throw new AnchorCoordinatorError(
        `Anchor batch ${batch.id} manifest does not round-trip to its recorded manifest_hash; refusing to submit.`,
      );
    }
    return manifest;
  }

  /** Persist the signed transaction before broadcast. Retries use the outbox winner. */
  async function submitBuiltBatch(batch, manifest = null) {
    const manifestToStore = manifest ?? await rebuildManifest(batch);
    const { key } = await manifestStorage.put(manifestToStore);
    if (typeof adapter.prepareRoot !== "function" || typeof adapter.broadcastPreparedRoot !== "function") {
      throw new AnchorCoordinatorError("Platform adapter must support durable prepared submissions.");
    }
    const payload = {
      root: batch.root,
      manifestHash: batch.manifest_hash,
      leafCount: batch.leaf_count,
      prevRoot: batch.prev_root,
      batchId: batch.id,
    };
    let prepared = await store.getPreparedSubmission(batch.id);
    if (!prepared) {
      prepared = await store.savePreparedSubmission(batch.id, await adapter.prepareRoot(payload), now());
    }
    const { txRef } = await adapter.broadcastPreparedRoot(prepared, payload);
    if (txRef !== prepared.txRef) throw new AnchorCoordinatorError("Broadcast transaction reference differs from the durable outbox.");
    await store.markSubmitted(batch.id, txRef, now());
    return { batch: await store.getBatch(batch.id), txRef, manifestKey: key };
  }

  return {
    /**
     * Trigger: pending >= minLeafCount, or now - lastBatch.created_at >= maxIntervalSeconds, or
     * FIRST-RUN BASELINE (no batch yet while pending > 0 — spec §2.2 "无上一批则以协调器首次运行为基准",
     * so the very first records are not starved by the interval timer). Empty pending → { created:false }.
     * `lastBatch` defaults to the store's latest batch when omitted; passing `null` asserts first-run.
     */
    async maybeBuildAndSubmit({ force = false, lastBatch } = {}) {
      const pendingCount = await store.countPendingRecords();
      if (pendingCount === 0) return { created: false, reason: "empty" };
      const previous = lastBatch === undefined ? await store.getLatestBatch() : lastBatch;
      const due = force
        || pendingCount >= config.minLeafCount
        || previous === null
        || (Date.parse(now()) - Date.parse(previous.created_at)) / 1000 >= config.maxIntervalSeconds;
      if (!due) return { created: false, reason: "not_due" };
      const head = await store.getLogHead();
      if (head.headBatchId && (await store.getBatch(head.headBatchId))?.status !== "confirmed") {
        return { created: false, reason: "awaiting_predecessor", predecessorBatchId: head.headBatchId };
      }
      const built = await builder.buildNextBatch({
        prevBatchId: head.headBatchId,
        prevRoot: head.headRoot,
        expectedHeadVersion: head.version,
      });
      if (!built.created) return { created: false, reason: "empty" };
      const submitted = await submitBuiltBatch(built.batch, built.manifest);
      return { created: true, batch: submitted.batch, txRef: submitted.txRef, manifestKey: submitted.manifestKey };
    },

    /**
     * Poll pending submissions and repair projections of already confirmed ones.
     * confirmed (status confirmed AND confirmations >= threshold) → updateSubmissionStatus confirmed,
     * then markBatchConfirmed for platform submissions (batch status is driven ONLY by platform
     * submissions) or syncWitnessCount for witness ones. failed/reverted/dropped → submission failed;
     * the batch row is left for operator action (e.g. abandonBatch) and only reported. Still-pending
     * or below-threshold submissions are left untouched.
     * 每个 submission 独立 try/catch：单个 RPC/持久化失败只记录到 errors，不阻塞其余提交
     * （自愈靠下一次 cron tick 重试）。Returns { confirmedBatches, failedBatches, errors } —
     * confirmedBatches = batches whose PLATFORM submission reached confirmed this round.
     */
    async pollConfirmations() {
      const confirmedBatches = [];
      const failedBatches = [];
      const errors = [];
      for (const submission of await store.listSubmissionsForReconciliation()) {
        try {
          const alreadyConfirmed = submission.status === "confirmed";
          const info = alreadyConfirmed ? null : await adapter.getConfirmation({ txRef: submission.tx_ref });
          const confirmations = Number(info?.confirmations ?? 0);
          const updatedAt = now();
          if (alreadyConfirmed || (info?.status === "confirmed" && confirmations >= config.confirmationThreshold)) {
            if (!alreadyConfirmed) {
              await store.updateSubmissionStatus({
                submissionId: submission.id, status: "confirmed", confirmations, blockRef: info.blockRef ?? null, updatedAt,
              });
            }
            if (submission.submitter_kind === "platform") {
              // A recovered batch can carry two platform submissions; only the first confirmation flips status.
              if ((await store.getBatch(submission.batch_id)).status === "submitted") {
                await store.markBatchConfirmed(submission.batch_id, updatedAt);
                confirmedBatches.push(submission.batch_id);
              }
            } else {
              await store.syncWitnessCount(submission.batch_id, updatedAt);
            }
          } else if (FAILED_CONFIRMATION_STATUSES.has(info?.status)) {
            await store.updateSubmissionStatus({
              submissionId: submission.id, status: "failed", confirmations, blockRef: info.blockRef ?? null, updatedAt,
            });
            if (submission.submitter_kind === "platform"
              && (await store.getBatch(submission.batch_id)).status !== "confirmed") {
              failedBatches.push(submission.batch_id);
            }
          }
          // pending (or confirmed but below threshold) → leave for a later poll
        } catch (error) {
          errors.push({
            submissionId: submission.id,
            batchId: submission.batch_id,
            txRef: submission.tx_ref,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return { confirmedBatches, failedBatches, errors };
    },

    /**
     * Recover built batches using their persisted transaction: look it up or replay the
     * same bytes, then repair the database projection. Never re-sign an existing outbox.
     * Migration-marked legacy ambiguous attempts require manual reconciliation.
     */
    async resumeUnfinishedBatches() {
      let recovered = 0;
      for (;;) {
        const built = await store.listBatches({ limit: 500, status: "built" });
        if (built.length === 0) break;
        for (const batch of built) {
          await submitBuiltBatch(batch);
          recovered += 1;
        }
      }
      return recovered;
    },

    /**
     * Witness five gates (spec §2.4), in order:
     * 0) batch row must exist ("unknown_batch"); the signed payload must attest exactly what gets
     *    recorded — protocolVersion/batchId/txRef/root/manifestHash all consistent ("payload_mismatch").
     * 1) verifyWitnessAuthority(payload, signature) → { submitterId }; the coordinator CATCHES its
     *    errors and maps them to { accepted: false, reason: "invalid_signature" }.
     * 2) parseTxRef(txRef) — malformed triples are rejected as "invalid_txref"; otherwise
     *    chain:network must equal the batch's canonical (chain, network) → "network_mismatch".
     * 3) adapter.readAnchoredRoot(txRef): root/manifestHash/leafCount/prevRoot must all match the
     *    batch row → "chain_truth_mismatch" (this is what stops forged txRefs from inflating counts).
     * 4) sender !== adapter.operatorAddress, and the txRef must not be a recorded platform submission
     *    for this batch → "not_independent".
     * 5) Persistence order: recordSubmission (unique (chain,network,tx_ref) idempotent) →
     *    adapter.getConfirmation(txRef) → updateSubmissionStatus → syncWitnessCount (counts confirmed
     *    only). Duplicate (same witness + same txRef): created:false → accepted:true, no double count.
     */
    async submitWitness({ batchId, payload, signature, txRef }) {
      const batch = await store.getBatch(batchId);
      if (!batch) return { accepted: false, reason: "unknown_batch" };
      if (batch.status === "failed") return { accepted: false, reason: "batch_failed" };
      if (payload?.protocolVersion !== anchorWitnessProtocolVersion
        || payload?.batchId !== batchId
        || payload?.txRef !== txRef
        || payload?.root !== batch.root
        || payload?.manifestHash !== batch.manifest_hash) {
        return { accepted: false, reason: "payload_mismatch" };
      }

      // Gate 1: authority (valid Person/Agent identity + delegation)
      let authority;
      try {
        authority = await verifyWitnessAuthority({ payload, signature });
      } catch {
        return { accepted: false, reason: "invalid_signature" };
      }
      if (!authority?.submitterId) return { accepted: false, reason: "invalid_signature" };

      // Gate 2: canonical network
      let parsed;
      try {
        parsed = parseTxRef(txRef);
      } catch {
        return { accepted: false, reason: "invalid_txref" };
      }
      if (parsed.chain !== batch.chain || parsed.network !== batch.network) {
        return { accepted: false, reason: "network_mismatch" };
      }

      // Gate 3: on-chain truth
      const onChain = await adapter.readAnchoredRoot({ txRef });
      if (
        !onChain
        || onChain.root !== batch.root
        || onChain.manifestHash !== batch.manifest_hash
        || Number(onChain.leafCount) !== Number(batch.leaf_count)
        || onChain.prevRoot !== batch.prev_root
      ) {
        return { accepted: false, reason: "chain_truth_mismatch" };
      }

      // Gate 4: independence
      const reusingPlatformTx = (await store.listSubmissions(batch.id)).some((row) =>
        row.submitter_kind === "platform" && row.chain === parsed.chain && row.network === parsed.network && row.tx_ref === txRef);
      if (!adapter.operatorAddress || onChain.sender === adapter.operatorAddress || reusingPlatformTx) {
        return { accepted: false, reason: "not_independent" };
      }

      // Gate 5: persistence
      const { created, submission } = await store.recordSubmission({
        batchId: batch.id,
        submitterKind: "witness",
        submitterId: authority.submitterId,
        chain: parsed.chain,
        network: parsed.network,
        txRef,
        submittedAt: now(),
      });
      if (!created) {
        // The unique (chain,network,tx_ref) row already exists. Idempotent repeat: same witness,
        // same txRef, same batch → accepted without double counting. Anyone else claiming a
        // transaction that is already recorded (platform or another batch/witness) is not independent.
        if (submission.batch_id === batch.id
          && submission.submitter_kind === "witness"
          && submission.submitter_id === authority.submitterId) {
          return { accepted: true, submissionId: submission.id, witnessCount: (await store.getBatch(batch.id)).witness_count };
        }
        return { accepted: false, reason: "not_independent" };
      }

      const info = await adapter.getConfirmation({ txRef });
      const confirmations = Number(info?.confirmations ?? 0);
      const updatedAt = now();
      if (info?.status === "confirmed" && confirmations >= config.confirmationThreshold) {
        await store.updateSubmissionStatus({
          submissionId: submission.id, status: "confirmed", confirmations, blockRef: info.blockRef ?? null, updatedAt,
        });
        const updatedBatch = await store.syncWitnessCount(batch.id, updatedAt);
        return { accepted: true, submissionId: submission.id, witnessCount: updatedBatch.witness_count };
      }
      if (FAILED_CONFIRMATION_STATUSES.has(info?.status)) {
        await store.updateSubmissionStatus({
          submissionId: submission.id, status: "failed", confirmations, blockRef: info.blockRef ?? null, updatedAt,
        });
        return { accepted: true, submissionId: submission.id, witnessCount: (await store.getBatch(batch.id)).witness_count };
      }
      // Still pending on-chain: recorded, counted once it confirms in a later pollConfirmations.
      return { accepted: true, submissionId: submission.id, witnessCount: (await store.getBatch(batch.id)).witness_count };
    },
  };
}
