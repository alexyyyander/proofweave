// services/anchoring/anchor-manifest-storage.mjs
import { canonicalUtf8 } from "../../packages/protocol/canonical-json.mjs";
import { anchorManifestHash } from "../../packages/protocol/anchor-manifest.mjs";

export function createManifestStorage({ bucket, prefix = "anchors" }) {
  if (!bucket) throw new TypeError("createManifestStorage requires a bucket (R2-compatible).");
  return {
    async put(manifest) {
      const manifestHash = await anchorManifestHash(manifest);
      const key = `${prefix}/${manifestHash}`;
      await bucket.put(key, canonicalUtf8(manifest));
      return { key, manifestHash };
    },
    async get(key) {
      return bucket.get(key);
    },
  };
}
