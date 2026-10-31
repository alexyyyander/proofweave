// tests/anchor-manifest-storage.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createManifestStorage } from "../services/anchoring/anchor-manifest-storage.mjs";

class MemoryBucket {
  constructor() { this.map = new Map(); }
  async put(key, value) { this.map.set(key, value); }
  async get(key) { return this.map.get(key) ?? null; }
}

test("manifest storage is content-addressed and round-trips", async () => {
  const bucket = new MemoryBucket();
  const storage = createManifestStorage({ bucket });
  const manifest = { protocolVersion: "pw-anchor-manifest-v1", batchId: "b", root: `sha256:${"1".repeat(64)}`, leafCount: 0, prevBatchId: null, prevRoot: null, createdAt: "t", leaves: [] };
  const { key, manifestHash } = await storage.put(manifest);
  assert.equal(key, `anchors/${manifestHash}`);
  const roundTrip = new TextDecoder().decode(await storage.get(key)); // put writes canonicalUtf8 (Uint8Array)
  assert.equal(JSON.parse(roundTrip).batchId, "b");
});
