// services/anchoring/anchor-verifier.mjs
import { anchorLeafHash, anchorLeafProtocolVersion } from "../../packages/protocol/anchor-leaf.mjs";
import { buildMerkleTree, generateInclusionProof, verifyInclusionProof } from "../../packages/protocol/merkle-tree.mjs";
import { anchorManifestHash, anchorManifestProtocolVersion } from "../../packages/protocol/anchor-manifest.mjs";

/**
 * Verifies that `record` is anchored: recomputes recordHash → leafHash → merkle
 * proof → root, binds the reconstructed manifest, and (when an adapter is
 * provided) checks the full on-chain payload and current confirmation state.
 *
 * @param hasher - async (record) => "sha256:<hex>", injected by the caller
 *   (receipts use contributionReceiptHash, checkpoints researchCheckpointHash, bundles artifactBundleHash).
 *   NOTE: this function takes ONE hasher for the record being verified — the `hasher` param is a single
 *   async function, not a map; callers select by recordType.
 *
 * Returns one of:
 *   { status: "unanchored", recordHash }                          — no store row for the record
 *   { status: "pending", batchId }                                — batch exists but not confirmed
 *   { status: "pending", reason: "no_confirmed_submission" }      — confirmed batch has no confirmed platform submission
 *   { status: "mismatch", reason }                                — reason: leaf_hash_mismatch | chain_root_mismatch |
 *                                                                    prev_root_mismatch | leaf_not_in_batch | proof_failed
 *   { status: "pending", batchId, root, index, proof }            — structurally valid, no adapter: no chain comparison (GET proof route)
 *   { status: "verified", batchId, root, txRef, index, proof }    — full chain check passed
 * Live confirmation checks use confirmationThreshold (default 12), independently
 * of the adapter's own threshold. RPC failures propagate; they never verify.
 */
export async function verifyAnchorRecord({ recordType, record, hasher, store, adapter, confirmationThreshold = 12 }) {
  if (!Number.isSafeInteger(confirmationThreshold) || confirmationThreshold < 1) {
    throw new TypeError("confirmationThreshold must be a positive integer.");
  }
  const recordHash = await hasher(record);
  const recordId = record.id;
  const row = await store.findRecord({ recordType, recordId, recordHash });
  if (!row) return { status: "unanchored", recordHash };
  const leafHash = await anchorLeafHash({ protocolVersion: anchorLeafProtocolVersion, recordType, recordId, recordHash });
  if (row.leaf_hash !== leafHash) return { status: "mismatch", reason: "leaf_hash_mismatch" };
  const batch = await store.getBatch(row.batch_id);
  if (!batch || batch.status !== "confirmed") return { status: "pending", batchId: row.batch_id };

  // adapter optional: the GET proof route reuses this without an adapter, skipping on-chain comparison
  // (returns pending instead of faking verified).
  const submission = adapter ? await store.getConfirmedPlatformSubmission(batch.id) : null;
  if (adapter) {
    if (!submission) return { status: "pending", reason: "no_confirmed_submission" };
    const onChain = await adapter.readAnchoredRoot({ txRef: submission.tx_ref });
    if (!onChain || onChain.root !== batch.root || onChain.manifestHash !== batch.manifest_hash) {
      return { status: "mismatch", reason: "chain_root_mismatch" };
    }
    if (onChain.prevRoot !== batch.prev_root || Number(onChain.leafCount) !== Number(batch.leaf_count)) {
      return { status: "mismatch", reason: "chain_payload_mismatch" };
    }
    // A stored confirmation is historical evidence, not the current chain state.
    const confirmation = await adapter.getConfirmation({ txRef: submission.tx_ref });
    if (["failed", "reverted", "dropped"].includes(confirmation?.status)) {
      return { status: "mismatch", reason: "chain_transaction_failed" };
    }
    if (confirmation?.status !== "confirmed"
      || !Number.isSafeInteger(confirmation.confirmations)
      || confirmation.confirmations < confirmationThreshold) {
      return { status: "pending", reason: "insufficient_chain_confirmations", batchId: batch.id };
    }
  }
  // spec §5 step 6: prevRoot must chain to the previous batch (genesis: both prev pointers null).
  if ((batch.prev_batch_id === null) !== (batch.prev_root === null)) {
    return { status: "mismatch", reason: "prev_root_mismatch" };
  }
  const prevBatch = batch.prev_batch_id ? await store.getBatch(batch.prev_batch_id) : null;
  if (batch.prev_batch_id && (!prevBatch || prevBatch.root !== batch.prev_root)) {
    return { status: "mismatch", reason: "prev_root_mismatch" };
  }

  const manifestRows = await store.listManifestLeaves(batch.id); // camelCase, sorted by (type,id,hash)
  const leafHashes = [];
  let index = -1;
  for (let i = 0; i < manifestRows.length; i += 1) {
    const entry = manifestRows[i];
    leafHashes.push(await anchorLeafHash({ protocolVersion: anchorLeafProtocolVersion, ...entry }));
    if (entry.recordType === recordType && entry.recordId === recordId && entry.recordHash === recordHash) index = i;
  }
  if (index < 0) return { status: "mismatch", reason: "leaf_not_in_batch" };
  const tree = await buildMerkleTree(leafHashes);
  const proof = generateInclusionProof(tree, index);
  const included = await verifyInclusionProof(leafHash, proof, batch.root);
  if (!included) return { status: "mismatch", reason: "proof_failed" };
  // Bind every projected manifest field, including the predecessor and creation
  // time, to the digest committed on-chain. Merkle inclusion only binds leaves.
  let manifestHash;
  try {
    manifestHash = await anchorManifestHash({
      protocolVersion: anchorManifestProtocolVersion,
      batchId: batch.id,
      root: batch.root,
      leafCount: Number(batch.leaf_count),
      prevBatchId: batch.prev_batch_id,
      prevRoot: batch.prev_root,
      createdAt: batch.created_at,
      leaves: manifestRows,
    });
  } catch {
    return { status: "mismatch", reason: "manifest_hash_mismatch" };
  }
  if (manifestHash !== batch.manifest_hash) return { status: "mismatch", reason: "manifest_hash_mismatch" };
  if (!adapter) return { status: "pending", batchId: batch.id, root: batch.root, index, proof }; // structurally valid, no chain comparison
  return { status: "verified", batchId: batch.id, root: batch.root, txRef: submission.tx_ref, index, proof };
}
