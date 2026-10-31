// tests/anchor-merkle-tree.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMerkleTree,
  emptyMerkleRoot,
  generateInclusionProof,
  verifyInclusionProof,
} from "../packages/protocol/merkle-tree.mjs";

const hex = (ch, n = 64) => `sha256:${ch.repeat(n)}`;
const leafHashes = ["a", "b", "c", "d", "e", "f", "1"].map((ch) => hex(ch));

test("builds RFC6962-shaped trees and verifies inclusion for every leaf", async () => {
  for (const n of [1, 2, 3, 5, 7]) {
    const tree = await buildMerkleTree(leafHashes.slice(0, n));
    for (let index = 0; index < n; index += 1) {
      const proof = generateInclusionProof(tree, index);
      assert.equal(await verifyInclusionProof(leafHashes[index], proof, tree.root), true, `n=${n} i=${index}`);
    }
  }
});

test("rejects tampered leaves, proofs, and roots", async () => {
  const tree = await buildMerkleTree(leafHashes);
  const proof = generateInclusionProof(tree, 2);
  assert.equal(await verifyInclusionProof(hex("0"), proof, tree.root), false); // valid format but not in tree
  assert.equal(await verifyInclusionProof(leafHashes[2], proof, hex("9")), false);
  const flipped = { path: [...proof.path.slice(0, -1), { ...proof.path.at(-1), position: proof.path.at(-1).position === "left" ? "right" : "left" }] };
  assert.equal(await verifyInclusionProof(leafHashes[2], flipped, tree.root), false);
  await assert.rejects(() => verifyInclusionProof("sha256:zz", proof, tree.root), /sha256:<hex>/); // malformed format → throws
  assert.throws(() => generateInclusionProof(tree, 99), /index/);
  await assert.rejects(() => buildMerkleTree(["not-a-hash"]), /sha256:<hex>/);
});

test("empty tree root equals sha256 of empty input", async () => {
  const tree = await buildMerkleTree([]);
  assert.equal(tree.root, await emptyMerkleRoot());
  assert.equal(tree.leafCount, 0);
});
