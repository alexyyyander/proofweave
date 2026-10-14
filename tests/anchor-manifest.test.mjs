// tests/anchor-manifest.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { anchorLeafHash, anchorLeafProtocolVersion } from "../packages/protocol/anchor-leaf.mjs";
import {
  anchorManifestHash,
  anchorManifestProtocolVersion,
  canonicalAnchorManifest,
  verifyAnchorManifest,
} from "../packages/protocol/anchor-manifest.mjs";

function manifestFixture() {
  return {
    protocolVersion: anchorManifestProtocolVersion,
    batchId: "anchor-batch:1",
    root: `sha256:${"1".repeat(64)}`,
    leafCount: 2,
    prevBatchId: null,
    prevRoot: null,
    createdAt: "2026-10-14T00:00:00.000Z",
    leaves: [
      { recordType: "contribution_receipt", recordId: "receipt:a", recordHash: `sha256:${"a".repeat(64)}` },
      { recordType: "evidence_bundle", recordId: "bundle:b", recordHash: `sha256:${"b".repeat(64)}` },
    ],
  };
}

test("manifest canonical form is order-independent and hashes stably", async () => {
  const manifest = manifestFixture();
  const reordered = { ...manifest, leaves: [...manifest.leaves].reverse() };
  assert.equal(canonicalAnchorManifest(manifest), canonicalAnchorManifest(reordered));
  assert.match(await anchorManifestHash(manifest), /^sha256:[a-f0-9]{64}$/);
});

test("verifyAnchorManifest recomputes root from leaves", async () => {
  const manifest = manifestFixture();
  const leafHashes = [];
  for (const entry of manifest.leaves) {
    leafHashes.push(await anchorLeafHash({ protocolVersion: anchorLeafProtocolVersion, ...entry }));
  }
  // Replace the fixture root with the real tree root so verify passes
  const { buildMerkleTree } = await import("../packages/protocol/merkle-tree.mjs");
  const tree = await buildMerkleTree(leafHashes);
  const valid = { ...manifest, root: tree.root };
  assert.equal(await verifyAnchorManifest(valid), true);
  assert.equal(await verifyAnchorManifest({ ...valid, leafCount: 3 }), false); // structural error → false, not throw
  assert.equal(await verifyAnchorManifest({ ...valid, root: `sha256:${"0".repeat(64)}` }), false);
});
