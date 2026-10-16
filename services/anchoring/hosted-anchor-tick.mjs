import { timingSafeEqual } from "node:crypto";
import { D1AnchorStore } from "./d1-anchor-store.mjs";
import { createAnchorBatchBuilder } from "./anchor-batch-builder.mjs";
import { createAnchorCoordinator } from "./anchor-coordinator.mjs";
import { createManifestStorage } from "./anchor-manifest-storage.mjs";
import { enqueuePublicAnchorRecords } from "./public-anchor-intake.mjs";
import { withAnchorTickLease } from "./anchor-tick-lease.mjs";
import { runAnchorTick } from "./anchor-tick.mjs";

export function anchorTickAuthorized(header, token) {
  if (typeof token !== "string" || token.length < 32 || typeof header !== "string") return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const supplied = Buffer.from(header);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function runHostedAnchorTick({ database, registry, bucket, config }) {
  if (!bucket?.put || !bucket?.get) throw new Error("Durable anchor manifest bucket is required.");
  if (registry?.size !== 1) throw new Error("Exactly one platform anchor adapter is required.");
  return withAnchorTickLease(database, async (renew) => {
    const store = new D1AnchorStore(database);
    const enqueued = await enqueuePublicAnchorRecords(database, store);
    const [[key, adapter]] = registry;
    const [chain, network] = key.split(":");
    const guardedAdapter = { ...adapter, async submitRoot(payload) {
      await renew();
      return adapter.submitRoot(payload);
    } };
    const coordinator = createAnchorCoordinator({ store,
      builder: createAnchorBatchBuilder({ store, chain, network }),
      manifestStorage: createManifestStorage({ bucket }), adapter: guardedAdapter, config,
      verifyWitnessAuthority: async () => { throw new Error("Ticks do not submit witnesses."); },
    });
    const result = await runAnchorTick(coordinator);
    return { ...result, summary: { ...result.summary, enqueued, manifestStorage: "r2" } };
  });
}
