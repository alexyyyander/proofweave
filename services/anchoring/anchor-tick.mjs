import { AnchorStoreConflictError } from "./d1-anchor-store.mjs";

export async function runAnchorTick(coordinator) {
  try {
    const recoveredBatches = await coordinator.resumeUnfinishedBatches();
    const built = await coordinator.maybeBuildAndSubmit({});
    const { confirmedBatches, failedBatches, errors } = await coordinator.pollConfirmations();
    const partialFailure = errors.length > 0 || failedBatches.length > 0;
    const summary = {
      status: partialFailure ? "partial_failure" : "ok",
      recoveredBatches,
      batchCreated: built.created,
      ...(built.created
        ? {
          batchId: built.batch.id,
          root: built.batch.root,
          leafCount: Number(built.batch.leaf_count),
          txRef: built.txRef,
          manifestKey: built.manifestKey,
        }
        : built.reason ? { reason: built.reason } : {}),
      ...(built.predecessorBatchId ? { predecessorBatchId: built.predecessorBatchId } : {}),
      confirmedBatches,
      failedBatches,
      errors,
    };
    return { summary, exitCode: partialFailure ? 2 : 0 };
  } catch (error) {
    if (error instanceof AnchorStoreConflictError) {
      return { summary: { status: "conflict", reason: error.message }, exitCode: 0 };
    }
    throw error;
  }
}
