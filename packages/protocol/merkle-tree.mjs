// packages/protocol/merkle-tree.mjs

export class MerkleTreeError extends Error {
  constructor(message) {
    super(message);
    this.name = "MerkleTreeError";
  }
}

export async function emptyMerkleRoot() {
  return toSha256Hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(0))));
}

/**
 * @param {string[]} leafHashes - already RFC6962 leaf-hashed values ("sha256:<hex>").
 *   buildMerkleTree never re-applies the 0x00 leaf prefix.
 */
export async function buildMerkleTree(leafHashes) {
  if (!Array.isArray(leafHashes)) throw new MerkleTreeError("leafHashes must be an array.");
  const leaves = leafHashes.map((value) => requireSha256(value, "leaf hash"));
  if (leaves.length === 0) {
    return Object.freeze({ leafCount: 0, root: await emptyMerkleRoot(), rootNode: null });
  }
  const rootNode = await buildNode(leaves, 0, leaves.length);
  return Object.freeze({ leafCount: leaves.length, root: toSha256Hex(rootNode.hash), rootNode });
}

export function generateInclusionProof(tree, index) {
  if (!tree?.rootNode) throw new MerkleTreeError("Cannot prove inclusion in an empty tree.");
  if (!Number.isInteger(index) || index < 0 || index >= tree.leafCount) {
    throw new MerkleTreeError(`Leaf index ${index} is outside the tree.`);
  }
  const path = [];
  walk(tree.rootNode, index, path);
  return Object.freeze({ path: Object.freeze(path) });
}

export async function verifyInclusionProof(leafHash, proof, root) {
  let current = requireSha256(leafHash, "leaf hash");
  for (const step of proof?.path ?? []) {
    if (step?.position !== "left" && step?.position !== "right") {
      throw new MerkleTreeError("Proof step position must be left or right.");
    }
    const sibling = requireSha256(step.hash, "proof hash");
    const prefix = new Uint8Array([0x01]);
    current = step.position === "left"
      ? await sha256Bytes(concatBytes(prefix, sibling, current))
      : await sha256Bytes(concatBytes(prefix, current, sibling));
  }
  requireSha256(root, "root"); // format check only
  return toSha256Hex(current) === root; // string comparison, NOT against requireSha256's byte array
}

async function buildNode(leaves, start, end) {
  const count = end - start;
  if (count === 1) return { kind: "leaf", startIndex: start, endIndex: end, hash: leaves[start] };
  const split = largestPowerOfTwoBelow(count);
  const left = await buildNode(leaves, start, start + split);
  const right = await buildNode(leaves, start + split, end);
  const hash = await sha256Bytes(concatBytes(new Uint8Array([0x01]), left.hash, right.hash));
  return { kind: "node", startIndex: start, endIndex: end, left, right, hash };
}

function walk(node, index, path) {
  if (node.kind === "leaf") return;
  if (index < node.right.startIndex) {
    walk(node.left, index, path);
    path.push({ hash: toSha256Hex(node.right.hash), position: "right" });
  } else {
    walk(node.right, index, path);
    path.push({ hash: toSha256Hex(node.left.hash), position: "left" });
  }
}

function largestPowerOfTwoBelow(count) {
  let power = 1;
  while (power * 2 < count) power *= 2;
  return power;
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new MerkleTreeError(`${label} must be sha256:<hex>.`);
  }
  return hexToBytes(value.slice(7));
}

async function sha256Bytes(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toSha256Hex(bytes) {
  return `sha256:${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
