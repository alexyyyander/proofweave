# 链上防篡改锚定（On-chain Anchoring）Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把收据/公开检查点/证据包的规范哈希批量做成 RFC6962 Merkle 批次，经链无关适配器锚定到链，提供公开包含性证明与独立核验。

**Architecture:** 纯函数协议层（叶子/Merkle/manifest/见证签名）→ D1/Turso 存储与入队 → 批建造器 + coordinator（mock 适配器先跑通链下闭环）→ EVM 适配器 + 公开接口 + 内容寻址存储 + CLI 核验。设计依据：`docs/superpowers/specs/2026-10-14-onchain-anchoring-design.md`。

**Tech Stack:** Node 22 `node:test` + Miniflare D1/R2、WebCrypto（Ed25519/SHA-256）、`canonical-json.mjs` 既有约定、EVM 用 `ethers` v6（仅适配器内动态引入）。

**参考现有代码风格：**
- 协议模块：`packages/protocol/contribution-receipt.mjs`（错误类、normalize、hash、签名 verify 模式）
- 存储：`services/credits/d1-receipt-credit-settlement.mjs`（构造器收 `database`）、`services/lean-runner/d1-run-store.mjs`（投影+事件原子写入）
- 测试 DB：`tests/d1-run-store.test.mjs`（Miniflare + `applyMigrations` helper）
- HTTP 路由：`app/api/receipts/route.ts`（`Response.json` + 错误约定）

---

## Chunk 1: 协议层（叶子 / Merkle / manifest / 见证签名）

### Task 1: `anchor-leaf.mjs`

**Files:**
- Create: `packages/protocol/anchor-leaf.mjs`
- Test: `tests/anchor-leaf.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
// tests/anchor-leaf.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  anchorLeafHash,
  anchorLeafProtocolVersion,
  normalizeAnchorLeaf,
} from "../packages/protocol/anchor-leaf.mjs";

const leaf = {
  protocolVersion: anchorLeafProtocolVersion,
  recordType: "contribution_receipt",
  recordId: "receipt:alice-1",
  recordHash: `sha256:${"a".repeat(64)}`,
};

test("normalizes, whitelists, and freezes anchor leaves", () => {
  const normalized = normalizeAnchorLeaf(leaf);
  assert.deepEqual(normalized, leaf);
  assert.throws(() => normalizeAnchorLeaf({ ...leaf, extra: 1 }), /unsupported field extra/);
  assert.throws(() => normalizeAnchorLeaf({ ...leaf, protocolVersion: "pw-anchor-leaf-v0" }), /protocolVersion/);
  assert.throws(() => normalizeAnchorLeaf({ ...leaf, recordType: "other" }), /recordType/);
  assert.throws(() => normalizeAnchorLeaf({ ...leaf, recordHash: "sha256:zz" }), /recordHash/);
});

test("anchorLeafHash is deterministic and domain separated", async () => {
  const a = await anchorLeafHash(leaf);
  const b = await anchorLeafHash({ ...leaf });
  assert.equal(a, b);
  assert.match(a, /^sha256:[a-f0-9]{64}$/);
  const otherType = await anchorLeafHash({ ...leaf, recordType: "evidence_bundle" });
  assert.notEqual(a, otherType);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/anchor-leaf.test.mjs`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```js
// packages/protocol/anchor-leaf.mjs
import { canonicalJson } from "./canonical-json.mjs";

export const anchorLeafProtocolVersion = "pw-anchor-leaf-v1";

export const anchorRecordTypes = Object.freeze([
  "contribution_receipt",
  "research_checkpoint",
  "evidence_bundle",
]);

export class AnchorLeafProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "AnchorLeafProtocolError";
  }
}

export function normalizeAnchorLeaf(leaf) {
  rejectExtraKeys(leaf, ["protocolVersion", "recordType", "recordId", "recordHash"], "Anchor leaf");
  if (leaf.protocolVersion !== anchorLeafProtocolVersion) {
    throw new AnchorLeafProtocolError(`Anchor leaf protocolVersion must be ${anchorLeafProtocolVersion}.`);
  }
  if (!anchorRecordTypes.includes(leaf.recordType)) {
    throw new AnchorLeafProtocolError(`Anchor leaf recordType ${leaf.recordType} is not supported.`);
  }
  if (typeof leaf.recordId !== "string" || leaf.recordId.length === 0 || leaf.recordId.length > 256) {
    throw new AnchorLeafProtocolError("Anchor leaf recordId must be a non-empty string of at most 256 characters.");
  }
  requireSha256(leaf.recordHash, "Anchor leaf recordHash");
  return Object.freeze({
    protocolVersion: anchorLeafProtocolVersion,
    recordType: leaf.recordType,
    recordId: leaf.recordId,
    recordHash: leaf.recordHash,
  });
}

/** sha256(0x00 ‖ canonicalJson(leaf)) — the RFC6962 leaf step, done exactly once here. */
export async function anchorLeafHash(leaf) {
  const normalized = normalizeAnchorLeaf(leaf);
  const leafBytes = new TextEncoder().encode(canonicalJson(normalized));
  const prefixed = new Uint8Array(leafBytes.length + 1);
  prefixed[0] = 0x00;
  prefixed.set(leafBytes, 1);
  return toSha256Hex(new Uint8Array(await crypto.subtle.digest("SHA-256", prefixed)));
}

export function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new AnchorLeafProtocolError(`${label} must be sha256:<hex>.`);
  }
  return value;
}

function rejectExtraKeys(value, allowed, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AnchorLeafProtocolError(`${label} must be a plain object.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new AnchorLeafProtocolError(`${label} has unsupported field ${key}.`);
  }
}

function toSha256Hex(bytes) {
  return `sha256:${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/anchor-leaf.test.mjs`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/anchor-leaf.mjs tests/anchor-leaf.test.mjs
git commit -m "Add anchor leaf protocol with domain-separated hashing"
```

### Task 2: `merkle-tree.mjs`

**Files:**
- Create: `packages/protocol/merkle-tree.mjs`
- Test: `tests/anchor-merkle-tree.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
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
const leafHashes = ["a", "b", "c", "d", "e", "f", "g"].map((ch) => hex(ch));

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
  assert.equal(await verifyInclusionProof(hex("0"), proof, tree.root), false); // 格式合法但不在此树
  assert.equal(await verifyInclusionProof(leafHashes[2], proof, hex("9")), false);
  const flipped = { path: [...proof.path.slice(0, -1), { ...proof.path.at(-1), position: proof.path.at(-1).position === "left" ? "right" : "left" }] };
  assert.equal(await verifyInclusionProof(leafHashes[2], flipped, tree.root), false);
  await assert.rejects(() => verifyInclusionProof("sha256:zz", proof, tree.root), /sha256:<hex>/); // 格式非法 → 抛错
  assert.throws(() => generateInclusionProof(tree, 99), /index/);
  assert.throws(() => buildMerkleTree(["not-a-hash"]), /sha256:<hex>/);
});

test("empty tree root equals sha256 of empty input", async () => {
  const tree = await buildMerkleTree([]);
  assert.equal(tree.root, await emptyMerkleRoot());
  assert.equal(tree.leafCount, 0);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/anchor-merkle-tree.test.mjs`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

关键点：输入是**已计算好的 leafHash**（`sha256:<hex>`）；n=1 基例直接返回该哈希（**不**再加 `0x00` 前缀）；内部节点 `sha256(0x01 ‖ left ‖ right)`；分裂点 `k = 小于 n 的最大 2 的幂`。

```js
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
  requireSha256(root, "root"); // 仅校验格式
  return toSha256Hex(current) === root; // 与字符串比较，不是与 requireSha256 的字节数组比较
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
    path.push({ hash: toSha256Hex(node.right.hash), position: "right" });
    walk(node.left, index, path);
  } else {
    path.push({ hash: toSha256Hex(node.left.hash), position: "left" });
    walk(node.right, index, path);
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/anchor-merkle-tree.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/merkle-tree.mjs tests/anchor-merkle-tree.test.mjs
git commit -m "Add RFC6962-style pre-hashed Merkle tree with inclusion proofs"
```

> **实现修正记录（Task 2 执行时发现，以仓库实际代码为准）：**
> 1. 测试夹具第 7 个叶子 `"g"` → `"1"`（`hex("g")` 非法 hex，格式校验会拒绝）。
> 2. `walk()` 改为**先递归后 push**（叶子优先的路径顺序）；与 `verifyInclusionProof` 的正向迭代配套（原计划 root-first push 与正向验证不一致）。外部客户端看到的 `proof.path` 是**自叶向根**的兄弟序列——Task 17 契约文档需写明。
> 3. `buildMerkleTree(["not-a-hash"])` 断言用 `await assert.rejects`（异步函数，`assert.throws` 捕获不到）。

### Task 3: `anchor-manifest.mjs`

**Files:**
- Create: `packages/protocol/anchor-manifest.mjs`
- Test: `tests/anchor-manifest.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
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
  // 用真实树根替换 fixture 根，保证 verify 通过
  const { buildMerkleTree } = await import("../packages/protocol/merkle-tree.mjs");
  const tree = await buildMerkleTree(leafHashes);
  const valid = { ...manifest, root: tree.root };
  assert.equal(await verifyAnchorManifest(valid), true);
  assert.equal(await verifyAnchorManifest({ ...valid, leafCount: 3 }), false);
  assert.equal(await verifyAnchorManifest({ ...valid, root: `sha256:${"0".repeat(64)}` }), false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/anchor-manifest.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现**

```js
// packages/protocol/anchor-manifest.mjs
import { canonicalJson, sha256Canonical } from "./canonical-json.mjs";
import { anchorLeafHash, anchorLeafProtocolVersion } from "./anchor-leaf.mjs";
import { buildMerkleTree } from "./merkle-tree.mjs";

export const anchorManifestProtocolVersion = "pw-anchor-manifest-v1";

export class AnchorManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = "AnchorManifestError";
  }
}

export function normalizeAnchorManifest(manifest) {
  const allowed = ["protocolVersion", "batchId", "root", "leafCount", "prevBatchId", "prevRoot", "createdAt", "leaves"];
  for (const key of Object.keys(manifest)) {
    if (!allowed.includes(key)) throw new AnchorManifestError(`Anchor manifest has unsupported field ${key}.`);
  }
  if (manifest.protocolVersion !== anchorManifestProtocolVersion) {
    throw new AnchorManifestError(`Anchor manifest protocolVersion must be ${anchorManifestProtocolVersion}.`);
  }
  if (typeof manifest.batchId !== "string" || manifest.batchId.length === 0) {
    throw new AnchorManifestError("Anchor manifest batchId must be a non-empty string.");
  }
  if (!Array.isArray(manifest.leaves) || manifest.leaves.length !== manifest.leafCount) {
    throw new AnchorManifestError("Anchor manifest leafCount must match leaves length.");
  }
  // 规范化：叶子按 (recordType, recordId, recordHash) 排序，保证乱序输入得到同一 canonical 形式与同一哈希。
  const leaves = [...manifest.leaves].sort(compareLeafEntries);
  return { ...manifest, leaves };
}

function compareLeafEntries(a, b) {
  return a.recordType.localeCompare(b.recordType)
    || a.recordId.localeCompare(b.recordId)
    || a.recordHash.localeCompare(b.recordHash);
}

export function canonicalAnchorManifest(manifest) {
  return canonicalJson(normalizeAnchorManifest(manifest));
}

export async function anchorManifestHash(manifest) {
  return sha256Canonical(normalizeAnchorManifest(manifest));
}

/** Recompute the tree from manifest leaves and compare with the declared root. 结构性/格式错误一律返回 false 而非抛出。 */
export async function verifyAnchorManifest(manifest) {
  let normalized;
  try {
    normalized = normalizeAnchorManifest(manifest);
    const leafHashes = [];
    for (const entry of normalized.leaves) {
      leafHashes.push(await anchorLeafHash({ protocolVersion: anchorLeafProtocolVersion, ...entry }));
    }
    const tree = await buildMerkleTree(leafHashes);
    return tree.root === normalized.root && tree.leafCount === normalized.leafCount;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/anchor-manifest.test.mjs`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/anchor-manifest.mjs tests/anchor-manifest.test.mjs
git commit -m "Add anchor manifest canonicalization and root verification"
```

### Task 4: `anchor-witness.mjs`（见证签名负载）

**Files:**
- Create: `packages/protocol/anchor-witness.mjs`
- Test: `tests/anchor-witness.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
// tests/anchor-witness.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  anchorWitnessProtocolVersion,
  anchorWitnessSigningPayload,
  signAnchorWitness,
  verifyAnchorWitnessSignature,
} from "../packages/protocol/anchor-witness.mjs";

const input = {
  batchId: "anchor-batch:1",
  root: `sha256:${"1".repeat(64)}`,
  manifestHash: `sha256:${"2".repeat(64)}`,
  txRef: "mock:local:tx-1",
};

test("witness signature binds batchId, root, manifestHash, and txRef", async () => {
  const payload = anchorWitnessSigningPayload(input);
  assert.equal(payload.protocolVersion, anchorWitnessProtocolVersion);
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const signature = await signAnchorWitness(payload, keys.privateKey);
  assert.equal(await verifyAnchorWitnessSignature(payload, signature, keys.publicKey), true);
  const tampered = anchorWitnessSigningPayload({ ...input, txRef: "mock:local:tx-2" });
  assert.equal(await verifyAnchorWitnessSignature(tampered, signature, keys.publicKey), false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/anchor-witness.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现**（签名方式与 `contribution-receipt.mjs` 相同：Ed25519 over canonicalUtf8，base64url 签名）

```js
// packages/protocol/anchor-witness.mjs
import { canonicalUtf8 } from "./canonical-json.mjs";

export const anchorWitnessProtocolVersion = "pw-anchor-witness-v1";

export class AnchorWitnessError extends Error {
  constructor(message) {
    super(message);
    this.name = "AnchorWitnessError";
  }
}

export function anchorWitnessSigningPayload({ batchId, root, manifestHash, txRef }) {
  for (const [key, value] of Object.entries({ batchId, root, manifestHash, txRef })) {
    if (typeof value !== "string" || value.length === 0) {
      throw new AnchorWitnessError(`Anchor witness ${key} must be a non-empty string.`);
    }
  }
  return Object.freeze({ protocolVersion: anchorWitnessProtocolVersion, batchId, root, manifestHash, txRef });
}

export async function signAnchorWitness(payload, privateKey) {
  try {
    return toBase64Url(await crypto.subtle.sign("Ed25519", privateKey, canonicalUtf8(payload)));
  } catch {
    throw new AnchorWitnessError("privateKey must be an Ed25519 signing key.");
  }
}

export async function verifyAnchorWitnessSignature(payload, signature, publicKey) {
  try {
    return await crypto.subtle.verify("Ed25519", publicKey, fromBase64Url(signature), canonicalUtf8(payload));
  } catch {
    return false;
  }
}

function toBase64Url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/anchor-witness.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/anchor-witness.mjs tests/anchor-witness.test.mjs
git commit -m "Add anchor witness signing payload protocol"
```

---

## Chunk 2: 数据模型与存储（迁移 0046 / schema / d1-anchor-store / intake）

### Task 5: 迁移 SQL + schema.ts

**Files:**
- Create: `drizzle/0046_add_anchor_tables.sql`
- Modify: `db/schema.ts`（文件末尾追加表定义）
- Test: 运行既有 `tests/libsql-migrations.test.mjs` 验证无回归；若它断言精确表集合则同步更新

- [ ] **Step 1: 写迁移 SQL**（风格照抄 `drizzle/0045_expand_curated_research_records.sql`；顺序：batches → log_head → records → submissions → events）

```sql
-- drizzle/0046_add_anchor_tables.sql
CREATE TABLE IF NOT EXISTS `anchor_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'built' NOT NULL,
	`root` text NOT NULL,
	`leaf_count` integer NOT NULL,
	`manifest_hash` text NOT NULL,
	`manifest_key` text NOT NULL,
	`prev_batch_id` text,
	`prev_root` text,
	`chain` text NOT NULL,
	`network` text NOT NULL,
	`witness_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`anchored_at` text
);
--> statement-breakpoint
-- 部分唯一索引：失败（abandoned）批次可被同叶子集合重建出相同 root 而不冲突。
CREATE UNIQUE INDEX IF NOT EXISTS `anchor_batches_root_idx` ON `anchor_batches` (`root`) WHERE `status` != 'failed';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `anchor_log_head` (
	`version` integer PRIMARY KEY NOT NULL,
	`head_batch_id` text,
	`head_root` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `anchor_log_head` (`version`, `head_batch_id`, `head_root`, `updated_at`)
VALUES (0, NULL, NULL, '1970-01-01T00:00:00.000Z');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `anchor_records` (
	`id` text PRIMARY KEY NOT NULL,
	`record_type` text NOT NULL,
	`record_id` text NOT NULL,
	`record_hash` text NOT NULL,
	`leaf_hash` text NOT NULL,
	`batch_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `anchor_batches`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `anchor_records_identity_idx` ON `anchor_records` (`record_type`,`record_id`,`record_hash`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `anchor_records_pending_idx` ON `anchor_records` (`batch_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `anchor_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`submitter_kind` text NOT NULL,
	`submitter_id` text NOT NULL,
	`chain` text NOT NULL,
	`network` text NOT NULL,
	`tx_ref` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`confirmations` integer DEFAULT 0 NOT NULL,
	`block_ref` text,
	`submitted_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `anchor_batches`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `anchor_submissions_tx_idx` ON `anchor_submissions` (`chain`,`network`,`tx_ref`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `anchor_submissions_batch_idx` ON `anchor_submissions` (`batch_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `anchor_batch_events` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload_hash` text NOT NULL,
	`canonical_payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `anchor_batches`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `anchor_batch_events_batch_idx` ON `anchor_batch_events` (`batch_id`);
```

- [ ] **Step 2: `db/schema.ts` 追加对应的 drizzle 表定义**

打开 `db/schema.ts`，模仿既有 `sqliteTable(...)` 写法，按上面 SQL 逐表声明 `anchorBatches`、`anchorLogHead`、`anchorRecords`、`anchorSubmissions`、`anchorBatchEvents`（列名/约束一一对应，`batch_id` 外键 `references(() => anchorBatches.id)`）。

- [ ] **Step 3: 验证迁移可执行**

Run: `node --test tests/libsql-migrations.test.mjs`
Expected: PASS（注意：`tests/libsql-migrations.test.mjs` 有**三处**引用最后迁移名——约第 20 行的 `.at(-1).name` 断言与第 37/54 行两个 `deepEqual` 里的 `latestMigration`，全部同步改为 `"0046_add_anchor_tables.sql"`；若还有精确表列表断言，把 5 张新表加入期望列表）

- [ ] **Step 4: Commit**

```bash
git add drizzle/0046_add_anchor_tables.sql db/schema.ts tests/libsql-migrations.test.mjs
git commit -m "Add anchor tables migration 0046 and schema definitions"
```

### Task 6: `d1-anchor-store.mjs`

**Files:**
- Create: `services/anchoring/d1-anchor-store.mjs`
- Test: `tests/d1-anchor-store.test.mjs`

- [ ] **Step 1: 写失败测试**（Miniflare 设置照抄 `tests/d1-run-store.test.mjs` 的 before/after + `applyMigrations`）

```js
// tests/d1-anchor-store.test.mjs
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { D1AnchorStore } from "../services/anchoring/d1-anchor-store.mjs";
import { sha256Canonical } from "../packages/protocol/canonical-json.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
let miniflare;
let database;

before(async () => {
  miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
  });
  database = await miniflare.getD1Database("DB");
  await applyMigrations(database);
});

after(async () => { await miniflare?.dispose(); });

function recordFixture(i) {
  return {
    recordType: "contribution_receipt",
    recordId: `receipt:r${i}`,
    recordHash: `sha256:${String(i).padStart(64, "0")}`,
    leafHash: `sha256:${String(1000 + i).padStart(64, "0")}`,
  };
}

test("intake insert is idempotent and unique per (type,id,hash)", async () => {
  const store = new D1AnchorStore(database);
  const first = await store.insertRecord({ ...recordFixture(1), createdAt: "2026-10-14T00:00:00.000Z" });
  const again = await store.insertRecord({ ...recordFixture(1), createdAt: "2026-10-14T00:00:01.000Z" });
  assert.equal(first.created, true);
  assert.equal(again.created, false);
});

test("createBatch snapshots pending records, CAS-serializes head, appends event", async () => {
  const store = new D1AnchorStore(database);
  const leaves = [];
  for (let i = 2; i <= 5; i += 1) {
    const fixture = { ...recordFixture(i), createdAt: "2026-10-14T00:00:00.000Z" };
    await store.insertRecord(fixture);
    leaves.push({ record_type: fixture.recordType, record_id: fixture.recordId, record_hash: fixture.recordHash, leaf_hash: fixture.leafHash });
  }
  const batchInput = {
    id: "anchor-batch:b1", root: `sha256:${"f".repeat(64)}`, leafCount: 4,
    manifestHash: await sha256Canonical({ batch: "b1" }), manifestKey: "anchors/sha256_x",
    prevBatchId: null, prevRoot: null, chain: "mock", network: "local", createdAt: "2026-10-14T00:01:00.000Z",
    leaves,
  };
  const created = await store.createBatch(batchInput);
  assert.equal(created.batch.id, "anchor-batch:b1");
  const batch = await store.getBatch("anchor-batch:b1");
  assert.equal(batch.status, "built");
  assert.equal(batch.leaf_count, 4);
  const head = await store.getLogHead();
  assert.equal(head.headBatchId, "anchor-batch:b1");
  assert.equal(head.headRoot, `sha256:${"f".repeat(64)}`);
  const assigned = await store.listPendingRecords();
  // 注意共享 DB：test 1 插入的 r1 未入批，仍是唯一 pending 行
  assert.equal(assigned.length, 1);
  assert.equal(assigned[0].record_id, "receipt:r1");
  const events = await store.listBatchEvents("anchor-batch:b1");
  assert.equal(events.filter((event) => event.event_type === "batch_built").length, 1);
  const manifestLeaves = await store.listManifestLeaves("anchor-batch:b1");
  assert.equal(manifestLeaves.length, 4);
  assert.deepEqual(Object.keys(manifestLeaves[0]).sort(), ["recordHash", "recordId", "recordType"]);
});

test("abandonBatch releases records and rolls back head only without confirmed submissions", async () => {
  const store = new D1AnchorStore(database);
  // b1（上一个测试创建）无确认提交 → 可放弃；释放其 4 条记录 + r1 共 5 条 pending
  await store.abandonBatch("anchor-batch:b1", "2026-10-14T00:02:00.000Z");
  assert.equal((await store.getBatch("anchor-batch:b1")).status, "failed");
  assert.equal((await store.listPendingRecords()).length, 5);
  const head = await store.getLogHead();
  // 追加式头日志：放弃后最新 head 指回创世（NULL）
  assert.equal(head.headBatchId, null);
  // 已有确认提交的批次禁止放弃：另建一批 → markSubmitted → 确认 → abandon 必须 rejects
  const leaves2 = [];
  for (let i = 6; i <= 6; i += 1) {
    const fixture = { ...recordFixture(i), createdAt: "2026-10-14T00:03:00.000Z" };
    await store.insertRecord(fixture);
    leaves2.push({ record_type: fixture.recordType, record_id: fixture.recordId, record_hash: fixture.recordHash, leaf_hash: fixture.leafHash });
  }
  await store.createBatch({ id: "anchor-batch:b2", root: `sha256:${"e".repeat(64)}`, leafCount: 1,
    manifestHash: await sha256Canonical({ batch: "b2" }), manifestKey: "anchors/sha256_y",
    prevBatchId: null, prevRoot: null, chain: "mock", network: "local", createdAt: "2026-10-14T00:03:00.000Z", leaves: leaves2 });
  await store.markSubmitted("anchor-batch:b2", "mock:local:tx-b2", "2026-10-14T00:03:01.000Z");
  const [submission] = await store.listSubmissions("anchor-batch:b2");
  await store.updateSubmissionStatus({ submissionId: submission.id, status: "confirmed", confirmations: 12, blockRef: "b", updatedAt: "2026-10-14T00:03:02.000Z" });
  await assert.rejects(() => store.abandonBatch("anchor-batch:b2", "2026-10-14T00:03:03.000Z"), /confirmed/);
});
```

> 注：`listBatchEvents` 是 store 需提供的读取方法（SELECT 该批事件按 created_at,id 排序）。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/d1-anchor-store.test.mjs`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

方法清单（全部走 `this.database.prepare/batch`，风格对齐 `d1-run-store.mjs`——投影与事件同一 `batch()` 原子写入，冲突抛 `AnchorStoreConflictError`）：

```js
// services/anchoring/d1-anchor-store.mjs
import { canonicalJson, sha256Canonical } from "../../packages/protocol/canonical-json.mjs";

export class AnchorStoreConflictError extends Error { /* name = "AnchorStoreConflictError" */ }
export class AnchorStoreValidationError extends Error { /* name = "AnchorStoreValidationError" */ }

export class D1AnchorStore {
  constructor(database) {
    if (!database) throw new TypeError("D1AnchorStore requires a D1-compatible database.");
    this.database = database;
  }

  newId(prefix) { return `${prefix}:${crypto.randomUUID()}`; }

  async insertRecord({ recordType, recordId, recordHash, leafHash, createdAt }) {
    // INSERT OR IGNORE ...（唯一约束 record_type+record_id+record_hash）
    // 返回 { created }，并读回行
  }

  async findRecord({ recordType, recordId, recordHash }) { /* SELECT ... LIMIT 1 */ }
  async countPendingRecords() { /* SELECT COUNT(*) WHERE batch_id IS NULL */ }
  async listPendingRecords(limit = 1000) { /* SELECT ... WHERE batch_id IS NULL ORDER BY record_type, record_id, record_hash LIMIT ? */ }

  /**
   * 原子建批（D1 batch 为隐式事务；串行化靠**追加式头日志**在 SQL 内强保证）：
   * 1) INSERT anchor_batches (status='built')
   * 2) UPDATE anchor_records SET batch_id=? WHERE batch_id IS NULL AND (type,id,hash) IN (本批叶子)
   * 3) INSERT anchor_batch_events 'batch_built'
   * 4) INSERT INTO anchor_log_head (version, head_batch_id, head_root, updated_at) VALUES (prevVersion+1, ?, ?, ?)
   *    —— anchor_log_head.version 是主键：并发建批写入同一 prevVersion+1 时第二个 INSERT 因主键冲突失败，
   *    **整个 D1 batch 在事务内中止回滚**（这就是 CAS，且无需 batch() 之后的 JS 读回——那无法回滚已提交事务）。
   * getLogHead() = SELECT ... ORDER BY version DESC LIMIT 1；version=0 为种子创世行。
   * 冲突时抛 AnchorStoreConflictError 并由调用方整体重试（重试会读到新的 head）。
   */
  async createBatch({ id, root, leafCount, manifestHash, manifestKey, prevBatchId, prevRoot, chain, network, createdAt, leaves }) { /* ... */ }

  async getBatch(batchId) { /* ... */ }
  async listBatches({ limit = 50, offset = 0 } = {}) { /* ... */ }
  async getLogHead() { /* SELECT ... ORDER BY version DESC LIMIT 1 → { headBatchId, headRoot, version } */ }
  async getLatestBatch() { /* ORDER BY created_at DESC, id DESC LIMIT 1（供 coordinator 的 T 触发基准） */ }

  async markSubmitted(batchId, txRef, submittedAt) { /* status built->submitted + 事件 'platform_submitted' + INSERT anchor_submissions(kind=platform) */ }

  async recordSubmission({ batchId, submitterKind, submitterId, chain, network, txRef, submittedAt }) {
    // INSERT OR IGNORE（唯一 chain+network+tx_ref）；命中已存在时返回 { created:false }
  }
  async updateSubmissionStatus({ submissionId, status, confirmations, blockRef, updatedAt }) { /* + 事件 'submission_confirmed'/'submission_failed' */ }
  async listSubmissions(batchId) { /* ... */ }
  async listPendingSubmissions() { /* JOIN batches WHERE submission.status='pending'（pollConfirmations 用） */ }
  /** 该批叶子，按 (record_type, record_id, record_hash) 排序，返回 camelCase [{ recordType, recordId, recordHash }]（verifier 用）。 */
  async listManifestLeaves(batchId) { /* ... */ }
  async getConfirmedPlatformSubmission(batchId) { /* submitter_kind='platform' AND status='confirmed' LIMIT 1 */ }

  /** 重算 witness_count = COUNT(DISTINCT submitter_id) WHERE kind='witness' AND status='confirmed'，回写批次并 append 事件（幂等）。 */
  async syncWitnessCount(batchId, updatedAt) { /* ... */ }

  /** 仅当批次无任何已确认提交才允许：records.batch_id 置 NULL + 追加一条新 head 行（version+1，指回该批的 prev）+ 批次标 failed + 事件 'batch_abandoned'，同一 database.batch() 内完成。若存在确认提交则抛 AnchorStoreConflictError。 */
  async abandonBatch(batchId, updatedAt) { /* ... */ }
}
```

事件写入统一走私有 `eventStatements(batchId, eventType, payload, createdAt)` → `INSERT INTO anchor_batch_events (id, batch_id, event_type, payload_hash, canonical_payload, created_at) VALUES (?, ?, ?, sha256Canonical(payload) 形式的 hex, canonicalJson(payload), ?)`，与既有 store 的不可变事件一致；并提供 `DELETE` 拒绝（触发器或省略——沿用仓库做法：只提供插入与读取）。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/d1-anchor-store.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/anchoring/d1-anchor-store.mjs tests/d1-anchor-store.test.mjs
git commit -m "Add D1 anchor store with atomic batches, CAS log head, and immutable events"
```

### Task 7: `anchor-intake.mjs`

**Files:**
- Create: `services/anchoring/anchor-intake.mjs`
- Test: `tests/anchor-intake.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
// tests/anchor-intake.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createAnchorIntake } from "../services/anchoring/anchor-intake.mjs";

test("enqueue computes leafHash and rejects unknown record types", async () => {
  const inserted = [];
  const store = {
    async insertRecord(input) { inserted.push(input); return { created: inserted.length === 1 }; },
  };
  const intake = createAnchorIntake(store);
  const result = await intake.enqueueAnchorRecord({
    recordType: "contribution_receipt",
    recordId: "receipt:a",
    recordHash: `sha256:${"a".repeat(64)}`,
    createdAt: "2026-10-14T00:00:00.000Z",
  });
  assert.match(inserted[0].leafHash, /^sha256:[a-f0-9]{64}$/);
  await assert.rejects(
    () => intake.enqueueAnchorRecord({ recordType: "nope", recordId: "x", recordHash: `sha256:${"a".repeat(64)}` }),
    /recordType/,
  );
});
```

- [ ] **Step 2: 跑测试确认失败** → Run: `node --test tests/anchor-intake.test.mjs`

- [ ] **Step 3: 实现**

```js
// services/anchoring/anchor-intake.mjs
import { anchorLeafHash, anchorLeafProtocolVersion, normalizeAnchorLeaf } from "../../packages/protocol/anchor-leaf.mjs";

export function createAnchorIntake(store) {
  return {
    async enqueueAnchorRecord({ recordType, recordId, recordHash, createdAt }) {
      const leaf = normalizeAnchorLeaf({ protocolVersion: anchorLeafProtocolVersion, recordType, recordId, recordHash });
      const leafHash = await anchorLeafHash(leaf);
      return store.insertRecord({ recordType, recordId, recordHash, leafHash, createdAt });
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/anchor-intake.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/anchoring/anchor-intake.mjs tests/anchor-intake.test.mjs
git commit -m "Add anchor intake that computes leaf hashes at enqueue time"
```

---

## Chunk 3: 批建造器 + mock 适配器 + coordinator（链下闭环）

### Task 8: `mock-anchor-adapter.mjs` + `anchor-chain-adapter.mjs`

**Files:**
- Create: `services/anchoring/anchor-chain-adapter.mjs`
- Create: `services/anchoring/mock-anchor-adapter.mjs`
- Test: `tests/anchor-chain-adapter.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
// tests/anchor-chain-adapter.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { parseChainSpecifier, parseTxRef, resolveAdapter } from "../services/anchoring/anchor-chain-adapter.mjs";
import { createMockAnchorAdapter } from "../services/anchoring/mock-anchor-adapter.mjs";

test("chain/tx specifiers parse and reject malformed input", () => {
  assert.deepEqual(parseChainSpecifier("evm:base-sepolia"), { chain: "evm", network: "base-sepolia" });
  assert.deepEqual(parseTxRef("evm:base-sepolia:0xabc"), { chain: "evm", network: "base-sepolia", txId: "0xabc" });
  assert.throws(() => parseTxRef("garbage"), /txRef/);
  assert.throws(() => parseChainSpecifier("only-chain"), /chain specifier/);
});

test("mock adapter submits, confirms, and reads back anchored root", async () => {
  const adapter = createMockAnchorAdapter({ network: "local", operatorAddress: "mock:operator" });
  const submitted = await adapter.submitRoot({
    root: `sha256:${"1".repeat(64)}`, manifestHash: `sha256:${"2".repeat(64)}`,
    leafCount: 3, prevRoot: null, batchId: "anchor-batch:b1",
  });
  assert.match(submitted.txRef, /^mock:local:tx-/);
  const confirmation = await adapter.getConfirmation({ txRef: submitted.txRef });
  assert.equal(confirmation.status, "confirmed");
  const read = await adapter.readAnchoredRoot({ txRef: submitted.txRef });
  assert.equal(read.root, `sha256:${"1".repeat(64)}`);
  assert.equal(read.sender, "mock:operator");
  assert.equal(await adapter.readAnchoredRoot({ txRef: "mock:local:missing" }), null);
});

test("resolveAdapter matches chain+network and throws when absent", () => {
  const adapter = createMockAnchorAdapter({ network: "local", operatorAddress: "mock:operator" });
  const registry = new Map([["mock:local", adapter]]);
  assert.equal(resolveAdapter({ registry, chain: "mock", network: "local" }), adapter);
  assert.throws(() => resolveAdapter({ registry, chain: "solana", network: "mainnet" }), /No anchor adapter/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/anchor-chain-adapter.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现**

```js
// services/anchoring/anchor-chain-adapter.mjs

export class AnchorAdapterConfigurationError extends Error {
  constructor(message) { super(message); this.name = "AnchorAdapterConfigurationError"; }
}

export function parseChainSpecifier(specifier) {
  const parts = String(specifier ?? "").split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new AnchorAdapterConfigurationError("chain specifier must be <chain>:<network>.");
  }
  return { chain: parts[0], network: parts[1] };
}

export function parseTxRef(txRef) {
  const parts = String(txRef ?? "").split(":");
  if (parts.length !== 3 || !parts.every(Boolean)) {
    throw new AnchorAdapterConfigurationError("txRef must be <chain>:<network>:<txId>.");
  }
  return { chain: parts[0], network: parts[1], txId: parts[2] };
}

export function resolveAdapter({ registry, chain, network }) {
  const adapter = registry?.get(`${chain}:${network}`);
  if (!adapter) throw new AnchorAdapterConfigurationError(`No anchor adapter configured for ${chain}:${network}.`);
  return adapter;
}

/** 从托管 env JSON 构建注册表（每项 {id,network, rpcUrl, sinkAddress, operatorPrivateKeyJwk, confirmationThreshold}）。 */
export function adapterRegistryFromConfig(configs, factories) {
  const registry = new Map();
  for (const config of configs ?? []) {
    const factory = factories?.[config.id];
    if (!factory) throw new AnchorAdapterConfigurationError(`Unknown anchor adapter id ${config.id}.`);
    registry.set(`${config.id}:${config.network}`, factory(config));
  }
  return registry;
}
```

```js
// services/anchoring/mock-anchor-adapter.mjs

export function createMockAnchorAdapter({ network = "local", operatorAddress = "mock:operator", confirmations = 12 } = {}) {
  const txs = new Map();
  let counter = 0;
  return {
    id: "mock",
    network,
    operatorAddress,
    async submitRoot({ root, manifestHash, leafCount, prevRoot, batchId, sender }) {
      const txId = `tx-${(counter += 1)}`;
      // sender 仅 mock 支持且默认 operator；供 witness 独立性测试使用（真实适配器忽略该字段）。
      txs.set(txId, { root, manifestHash, leafCount, prevRoot, batchId, sender: sender ?? operatorAddress });
      return { txRef: `mock:${network}:${txId}` };
    },
    async getConfirmation() {
      return { status: "confirmed", confirmations, blockRef: `mock-block-${confirmations}` };
    },
    async readAnchoredRoot({ txRef }) {
      const txId = String(txRef ?? "").split(":").at(-1);
      const tx = txs.get(txId);
      return tx ? { root: tx.root, manifestHash: tx.manifestHash, leafCount: tx.leafCount, prevRoot: tx.prevRoot, sender: tx.sender } : null;
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/anchor-chain-adapter.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/anchoring/anchor-chain-adapter.mjs services/anchoring/mock-anchor-adapter.mjs tests/anchor-chain-adapter.test.mjs
git commit -m "Add chain-agnostic anchor adapter registry and mock adapter"
```

### Task 9: `anchor-batch-builder.mjs`

**Files:**
- Create: `services/anchoring/anchor-batch-builder.mjs`
- Test: `tests/anchor-batch-builder.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
// tests/anchor-batch-builder.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createAnchorBatchBuilder } from "../services/anchoring/anchor-batch-builder.mjs";
import { anchorLeafHash, anchorLeafProtocolVersion } from "../packages/protocol/anchor-leaf.mjs";

function fakeStoreWith(pending) {
  return {
    async countPendingRecords() { return pending.length; },
    async listPendingRecords() { return pending; },
    async getLogHead() { return { headBatchId: null, headRoot: null, version: 0 }; },
    async createBatch(input) { return { created: true, batch: { id: input.id, ...input } }; },
  };
}

test("builder sorts leaves deterministically and verifies manifest root", async () => {
  const pending = ["b", "a"].map((ch) => ({
    id: `anchor-record:${ch}`, record_type: "contribution_receipt", record_id: `receipt:${ch}`,
    record_hash: `sha256:${ch.repeat(64)}`, leaf_hash: "", created_at: "2026-10-14T00:00:00.000Z",
  }));
  // 行形状与 store 返回一致（snake_case）；leaf_hash 需真实可复算
  for (const row of pending) {
    row.leaf_hash = await anchorLeafHash({
      protocolVersion: anchorLeafProtocolVersion, recordType: row.record_type, recordId: row.record_id, recordHash: row.record_hash,
    });
  }
  const builder = createAnchorBatchBuilder({ store: fakeStoreWith(pending), chain: "mock", network: "local" });
  const result = await builder.buildNextBatch({ prevBatchId: null, prevRoot: null });
  assert.equal(result.created, true);
  const [first, second] = result.manifest.leaves;
  assert.equal(first.recordId, "receipt:a"); // 已按 (type,id,hash) 排序
  assert.equal(result.tree.root, result.manifest.root);
});

test("builder refuses to create an empty batch", async () => {
  const builder = createAnchorBatchBuilder({ store: fakeStoreWith([]), chain: "mock", network: "local" });
  const result = await builder.buildNextBatch({ prevBatchId: null, prevRoot: null });
  assert.equal(result.created, false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/anchor-batch-builder.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现**

```js
// services/anchoring/anchor-batch-builder.mjs
import { anchorManifestHash, anchorManifestProtocolVersion } from "../../packages/protocol/anchor-manifest.mjs";
import { buildMerkleTree } from "../../packages/protocol/merkle-tree.mjs";

export function createAnchorBatchBuilder({ store, chain, network, now = () => new Date().toISOString() }) {
  return {
    async buildNextBatch({ prevBatchId = null, prevRoot = null } = {}) {
      const pending = await store.listPendingRecords(1000);
      if (pending.length === 0) return { created: false };
      const sorted = [...pending].sort(compareLeaves);
      const tree = await buildMerkleTree(sorted.map((row) => row.leaf_hash));
      const manifest = Object.freeze({
        protocolVersion: anchorManifestProtocolVersion,
        batchId: `anchor-batch:${crypto.randomUUID()}`,
        root: tree.root,
        leafCount: tree.leafCount,
        prevBatchId,
        prevRoot,
        createdAt: now(),
        leaves: sorted.map((row) => ({ recordType: row.record_type, recordId: row.record_id, recordHash: row.record_hash })),
      });
      const manifestHash = await anchorManifestHash(manifest);
      const manifestKey = `anchors/${manifestHash}`;
      const stored = await store.createBatch({
        id: manifest.batchId, root: tree.root, leafCount: tree.leafCount, manifestHash, manifestKey,
        prevBatchId, prevRoot, chain, network, createdAt: manifest.createdAt, leaves: sorted,
      });
      return { created: true, batch: stored.batch ?? stored, manifest, manifestHash, manifestKey, tree };
    },
  };
}

function compareLeaves(a, b) {
  return a.record_type.localeCompare(b.record_type)
    || a.record_id.localeCompare(b.record_id)
    || a.record_hash.localeCompare(b.record_hash);
}
```

> 实现说明：`buildNextBatch` 内不再自行判空触发（触发归 coordinator）；`store.createBatch` 返回 `{ batch }`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/anchor-batch-builder.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/anchoring/anchor-batch-builder.mjs tests/anchor-batch-builder.test.mjs
git commit -m "Add deterministic anchor batch builder over pending records"
```

### Task 10: `anchor-manifest-storage.mjs`（内容寻址存储）

**Files:**
- Create: `services/anchoring/anchor-manifest-storage.mjs`
- Test: `tests/anchor-manifest-storage.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
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
  const roundTrip = new TextDecoder().decode(await storage.get(key)); // put 写入 canonicalUtf8（Uint8Array）
  assert.equal(JSON.parse(roundTrip).batchId, "b");
});
```

- [ ] **Step 2: 跑测试确认失败** → Run: `node --test tests/anchor-manifest-storage.test.mjs`

- [ ] **Step 3: 实现**

```js
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
```

- [ ] **Step 4: 跑测试确认通过** → Run: `node --test tests/anchor-manifest-storage.test.mjs`

- [ ] **Step 5: Commit**

```bash
git add services/anchoring/anchor-manifest-storage.mjs tests/anchor-manifest-storage.test.mjs
git commit -m "Add content-addressed anchor manifest storage"
```

### Task 11: `anchor-coordinator.mjs`（含 witness 流程）

**Files:**
- Create: `services/anchoring/anchor-coordinator.mjs`
- Test: `tests/anchor-coordinator.test.mjs`

- [ ] **Step 1: 写失败测试**

覆盖四个场景（Miniflare DB + mock 适配器 + MemoryBucket）：

```js
// tests/anchor-coordinator.test.mjs
// 场景：
// 1) maybeBuildAndSubmit：pending>=N 时建批→存 manifest→submitRoot→批次 submitted、平台 submission pending。
// 2) pollConfirmations：确认数>=阈值后平台 submission confirmed、批次 confirmed。
// 3) 空批次：pending=0 时返回 {created:false}，不产生批次。
// 4) submitWitness：伪造签名拒绝；签名有效但 txRef 链上不符拒绝；sender==operator 拒绝；合法提交→witness_count=1。
```

测试骨架（复用 `tests/d1-anchor-store.test.mjs` 的 Miniflare before/after；helper `setupCoordinator()` 返回 `{ store, coordinator, adapter, bucket, intake }`）：

```js
test("builds and submits when threshold reached, then confirms", async () => {
  const { store, coordinator, intake } = await setupCoordinator({ minLeafCount: 2, confirmationThreshold: 1 });
  for (let i = 0; i < 2; i += 1) {
    await intake.enqueueAnchorRecord({
      recordType: "contribution_receipt", recordId: `receipt:${i}`,
      recordHash: `sha256:${String(i).padStart(64, "0")}`, createdAt: "2026-10-14T00:00:00.000Z",
    });
  }
  const summary = await coordinator.maybeBuildAndSubmit({});
  assert.equal(summary.created, true);
  const batch = await store.getBatch(summary.batch.id);
  assert.equal(batch.status, "submitted");
  const confirmed = await coordinator.pollConfirmations();
  assert.equal(confirmed.confirmedBatches.length, 1);
  assert.equal((await store.getBatch(summary.batch.id)).status, "confirmed");
});

test("witness flow enforces signature, chain truth, and independence", async () => {
  const { store, coordinator, adapter, witnessKeys } = await setupCoordinator({ minLeafCount: 1, confirmationThreshold: 0 });
  const { batch } = await intakeEnqueueAndSubmitOne(); // helper：入队 1 条并 maybeBuildAndSubmit
  const witnessTxRef = "mock:local:tx-witness-1"; // gate 1 只验签名，txRef 在闸 3 才需要真实

  // 闸 1：签名无效
  const badSignature = await coordinator.submitWitness({ batchId: batch.id, payload: witnessPayload(batch), signature: "bad", txRef: witnessTxRef });
  assert.equal(badSignature.accepted, false);

  // 闸 2：网络不匹配（批次规范网络是 mock:local）
  const wrongNetworkTx = "mock:other:tx-9";
  assert.equal((await coordinator.submitWitness({
    batchId: batch.id, payload: witnessPayload(batch, wrongNetworkTx),
    signature: await signAnchorWitness(witnessPayload(batch, wrongNetworkTx), witnessKeys.privateKey), txRef: wrongNetworkTx,
  })).accepted, false);

  // 闸 3：签名有效但 txRef 链上不承载该批次 root
  const forgedTxRef = "mock:local:tx-forged";
  assert.equal((await coordinator.submitWitness({
    batchId: batch.id, payload: witnessPayload(batch, forgedTxRef),
    signature: await signAnchorWitness(witnessPayload(batch, forgedTxRef), witnessKeys.privateKey), txRef: forgedTxRef,
  })).accepted, false);

  // 闸 4/5：复用平台自己的交易 → 独立性拒绝
  const platformTxRef = (await store.listSubmissions(batch.id))[0].tx_ref;
  assert.equal((await coordinator.submitWitness({
    batchId: batch.id, payload: witnessPayload(batch, platformTxRef),
    signature: await signAnchorWitness(witnessPayload(batch, platformTxRef), witnessKeys.privateKey), txRef: platformTxRef,
  })).accepted, false);

  // 合法：见证者用**不同 sender** 真实提交一笔锚定同一 root 的交易
  const witnessSubmission = await adapter.submitRoot({
    root: batch.root, manifestHash: batch.manifest_hash, leafCount: batch.leaf_count,
    prevRoot: batch.prev_root, batchId: batch.id, sender: "mock:witness-1",
  });
  const ok = await coordinator.submitWitness({
    batchId: batch.id, payload: witnessPayload(batch, witnessSubmission.txRef),
    signature: await signAnchorWitness(witnessPayload(batch, witnessSubmission.txRef), witnessKeys.privateKey),
    txRef: witnessSubmission.txRef,
  });
  assert.equal(ok.accepted, true);
  assert.equal((await store.getBatch(batch.id)).witness_count, 1);
  // 幂等：同一见证者同一 txRef 重复提交 → accepted true 但计数不变
  const repeat = await coordinator.submitWitness({
    batchId: batch.id, payload: witnessPayload(batch, witnessSubmission.txRef),
    signature: await signAnchorWitness(witnessPayload(batch, witnessSubmission.txRef), witnessKeys.privateKey),
    txRef: witnessSubmission.txRef,
  });
  assert.equal(repeat.accepted, true);
  assert.equal((await store.getBatch(batch.id)).witness_count, 1);
});
```

> 注：`witnessPayload(batch, txRef)` = `anchorWitnessSigningPayload({ batchId: batch.id, root: batch.root, manifestHash: batch.manifest_hash, txRef })`；`witnessKeys` 是测试生成的 Ed25519 密钥对，`setupCoordinator` 的 `verifyWitnessAuthority` 用其公钥校验并返回 `{ submitterId: "person:witness" }`（模拟"有效 Person/Agent + 委派"）。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/anchor-coordinator.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现**

```js
// services/anchoring/anchor-coordinator.mjs
import { verifyAnchorWitnessSignature } from "../../packages/protocol/anchor-witness.mjs";
import { parseTxRef, resolveAdapter } from "./anchor-chain-adapter.mjs";

export class AnchorCoordinatorError extends Error { /* name */ }

export function createAnchorCoordinator({
  store, builder, manifestStorage, adapter, config, verifyWitnessAuthority, now = () => new Date().toISOString(),
}) {
  // config: { chain, network, minLeafCount, maxIntervalSeconds, confirmationThreshold }
  return {
    /** 触发条件：pending >= N，或 now - 上一批 created_at >= T，或**首运行基线**（无任何批次且 pending > 0 ——
     *  即 spec §2.2 "无上一批则以协调器首次运行为基准"，防止首批记录因 T 永不触发）；
     *  空批（pending === 0）直接 {created:false}。 */
    async maybeBuildAndSubmit({ force = false, lastBatch = null } = {}) {
      const pendingCount = await store.countPendingRecords();
      if (pendingCount === 0) return { created: false, reason: "empty" };
      const due = force || pendingCount >= config.minLeafCount
        || lastBatch === null
        || (Date.parse(now()) - Date.parse(lastBatch.created_at)) / 1000 >= config.maxIntervalSeconds;
      if (!due) return { created: false, reason: "not_due" };
      const head = await store.getLogHead();
      const built = await builder.buildNextBatch({ prevBatchId: head.headBatchId, prevRoot: head.headRoot });
      if (!built.created) return { created: false, reason: "empty" };
      const { key } = await manifestStorage.put(built.manifest);
      const { txRef } = await adapter.submitRoot({
        root: built.tree.root, manifestHash: built.manifestHash, leafCount: built.tree.leafCount,
        prevRoot: head.headRoot, batchId: built.batch.id,
      });
      await store.markSubmitted(built.batch.id, txRef, now());
      return { created: true, batch: built.batch, txRef, manifestKey: key };
    },

    /** 遍历所有 pending 的链上提交（**平台与见证者都轮询**，用 store.listPendingSubmissions()）；
     *  确认数 >= 阈值 → confirmed + syncWitnessCount；reverted/丢弃 → failed。
     *  批次 status 仍**只由平台提交**驱动；witness 提交只影响 witness_count。返回 { confirmedBatches, failedBatches }。 */
    async pollConfirmations() { /* ... */ },

    /**
     * 崩溃恢复：status='built' 的批次（createBatch 后、markSubmitted 前崩溃）重新走
     * manifestStorage.put（幂等，内容寻址同 key）+ adapter.submitRoot（产生新 txRef，作为另一条
     * 平台 submission 记录）+ markSubmitted。同一批次可多次提交；唯一约束 (chain,network,tx_ref)
     * 保证 txRef 不重复。返回恢复的批次数。
     */
    async resumeUnfinishedBatches() { /* SELECT status='built' 批次 → 同 maybeBuildAndSubmit 的提交路径 */ },

    /**
     * 见证提交五道闸：
     * 1) verifyWitnessAuthority(payload, signature) → { submitterId }（Person/Agent + 委派有效）；
     *    **coordinator 捕获其抛出的错误**并映射为 { accepted: false, reason: "invalid_signature" }；
     * 2) parseTxRef(txRef) 的 chain:network 必须等于批次规范网络；
     * 3) adapter.readAnchoredRoot(txRef) 返回的 root/manifestHash/leafCount/prevRoot 与批次一致；
     * 4) sender !== adapter.operatorAddress（独立性）；
     * 5) 落库顺序：先 recordSubmission（返回 submission 行/ID，唯一 tx_ref 幂等）→ adapter.getConfirmation(txRef)
     *    → updateSubmissionStatus（confirmed/failed）→ syncWitnessCount（只数 confirmed）。
     *    测试里 confirmationThreshold:0 即见证交易立即 confirmed → witness_count=1。
     */
    async submitWitness({ batchId, payload, signature, txRef }) { /* ... 返回 { accepted, reason? } */ },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/anchor-coordinator.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/anchoring/anchor-coordinator.mjs tests/anchor-coordinator.test.mjs
git commit -m "Add anchor coordinator with witness gating and recovery"
```

> 链下端到端集成测试（`tests/anchor-flow.test.mjs`）依赖 Task 12 的 verifier，安排在 Task 12 的最后一步执行。

---

## Chunk 4: EVM 适配器、桩、verifier、CLI（链上闭环）

### Task 12: `anchor-verifier.mjs`

**Files:**
- Create: `services/anchoring/anchor-verifier.mjs`
- Test: `tests/anchor-verifier.test.mjs`

- [ ] **Step 1: 写失败测试**（自含夹具，与 Step 5 的 anchor-flow 相同模式：Miniflare DB + mock adapter；**不要**从尚不存在的其他测试文件导入）

```js
// tests/anchor-verifier.test.mjs
// 1) verified：重算 recordHash→leafHash→proof→root，链上 root 匹配。
// 2) unanchored：store 里没有该记录。
// 3) mismatch：recordHash 对得上但 root 比对失败（篡改 manifest 中的 leaf）。
// 4) pending：批次未 confirmed。
// 5) prev_root_mismatch：篡改批次 prev_root 与前批 root 不一致 → mismatch（spec §5 第 6 步）。
```

- [ ] **Step 2: 跑测试确认失败** → Run: `node --test tests/anchor-verifier.test.mjs`

- [ ] **Step 3: 实现**

```js
// services/anchoring/anchor-verifier.mjs
import { anchorLeafHash, anchorLeafProtocolVersion } from "../../packages/protocol/anchor-leaf.mjs";
import { buildMerkleTree, generateInclusionProof, verifyInclusionProof } from "../../packages/protocol/merkle-tree.mjs";

/**
 * @param hashers - { [recordType]: async (record) => "sha256:<hex>" }，由调用方注入
 *   （收据用 contributionReceiptHash，检查点用 researchCheckpointHash，bundle 用 artifactBundleHash）。
 */
export async function verifyAnchorRecord({ recordType, record, hasher, store, adapter }) {
  const recordHash = await hasher(record);
  const recordId = record.id;
  const row = await store.findRecord({ recordType, recordId, recordHash });
  if (!row) return { status: "unanchored", recordHash };
  const leafHash = await anchorLeafHash({ protocolVersion: anchorLeafProtocolVersion, recordType, recordId, recordHash });
  if (row.leaf_hash !== leafHash) return { status: "mismatch", reason: "leaf_hash_mismatch" };
  const batch = await store.getBatch(row.batch_id);
  if (!batch || batch.status !== "confirmed") return { status: "pending", batchId: row.batch_id };

  // adapter 可选：GET proof 路由复用本函数时不传 adapter，跳过链上比对（返回 pending 而非伪造 verified）。
  let onChain = null;
  if (adapter) {
    const submission = await store.getConfirmedPlatformSubmission(batch.id);
    if (!submission) return { status: "pending", reason: "no_confirmed_submission" };
    onChain = await adapter.readAnchoredRoot({ txRef: submission.tx_ref });
    if (!onChain || onChain.root !== batch.root || onChain.manifestHash !== batch.manifest_hash) {
      return { status: "mismatch", reason: "chain_root_mismatch" };
    }
  }
  // spec §5 第 6 步：校验 prevRoot 与前一批次连续（创世批次 prev_batch_id 与 prev_root 必须同时为 null）。
  if ((batch.prev_batch_id === null) !== (batch.prev_root === null)) {
    return { status: "mismatch", reason: "prev_root_mismatch" };
  }
  const prevBatch = batch.prev_batch_id ? await store.getBatch(batch.prev_batch_id) : null;
  if (batch.prev_batch_id && (!prevBatch || prevBatch.root !== batch.prev_root)) {
    return { status: "mismatch", reason: "prev_root_mismatch" };
  }

  const manifestRows = await store.listManifestLeaves(batch.id); // store 提供：按 (type,id,hash) 排序返回该批 leaves
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
  return {
    status: adapter ? "verified" : "pending", // 无 adapter 时本地结构核验通过，但未经链上比对
    batchId: batch.id, root: batch.root, index, proof,
    ...(adapter ? { txRef: (await store.getConfirmedPlatformSubmission(batch.id))?.tx_ref } : {}),
  };
}
```

> `store.listManifestLeaves(batchId)` 已在 Task 6 的 store 中声明并测试（camelCase `[{ recordType, recordId, recordHash }]`，按 (record_type, record_id, record_hash) 排序）；此处仅交叉引用。

- [ ] **Step 4: 跑测试确认通过** → Run: `node --test tests/anchor-verifier.test.mjs`

- [ ] **Step 5: 链下端到端集成测试**（夹具自含：Miniflare DB + mock adapter + MemoryBucket，不依赖其他测试文件的导出）

新增 `tests/anchor-flow.test.mjs`：入队伪造收据哈希 → coordinator `maybeBuildAndSubmit` → `pollConfirmations` → `verifyAnchorRecord`（用 store + mock adapter）→ `{status:"verified"}`；篡改 recordHash 后 → `mismatch`/`unanchored`；伪造 `prev_root` → `prev_root_mismatch`。

Run: `node --test tests/anchor-flow.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/anchoring/anchor-verifier.mjs tests/anchor-verifier.test.mjs tests/anchor-flow.test.mjs
git commit -m "Add anchor verifier and off-chain closed-loop integration test"
```

### Task 13: EVM 适配器（ethers v6，动态引入）+ Solana/Tron 桩

**Files:**
- Create: `services/anchoring/evm-anchor-adapter.mjs`
- Create: `services/anchoring/solana-anchor-adapter.mjs`
- Create: `services/anchoring/tron-anchor-adapter.mjs`
- Modify: `package.json`（dependencies 增加 `"ethers": "^6.13.0"`）
- Test: `tests/evm-anchor-adapter.test.mjs`（**不**依赖真实链：calldata 编解码单测 + 桩测试）

- [ ] **Step 1: 安装依赖**

Run: `npm install ethers@^6.13.0`
Expected: package.json dependencies 出现 ethers

- [ ] **Step 2: 写失败测试**（只测纯编解码与桩）

```js
// tests/evm-anchor-adapter.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { decodeAnchorCalldata, encodeAnchorCalldata } from "../services/anchoring/evm-anchor-adapter.mjs";
import { createSolanaAnchorAdapter } from "../services/anchoring/solana-anchor-adapter.mjs";
import { createTronAnchorAdapter } from "../services/anchoring/tron-anchor-adapter.mjs";

const root = `sha256:${"1".repeat(64)}`;
const manifestHash = `sha256:${"2".repeat(64)}`;

test("anchor calldata round-trips four fields deterministically", () => {
  const data = encodeAnchorCalldata({ root, manifestHash, leafCount: 7, prevRoot: null });
  const decoded = decodeAnchorCalldata(data);
  assert.deepEqual(decoded, { root, manifestHash, leafCount: 7, prevRoot: null });
  const withPrev = decodeAnchorCalldata(encodeAnchorCalldata({ root, manifestHash, leafCount: 7, prevRoot: `sha256:${"3".repeat(64)}` }));
  assert.equal(withPrev.prevRoot, `sha256:${"3".repeat(64)}`);
  assert.throws(() => decodeAnchorCalldata("0x1234"), /calldata/);
});

test("solana and tron adapters are explicit stubs", async () => {
  const solana = await createSolanaAnchorAdapter({});
  await assert.rejects(() => solana.submitRoot({}), /not implemented/);
  const tron = await createTronAnchorAdapter({});
  await assert.rejects(() => tron.submitRoot({}), /not implemented/);
});
```

- [ ] **Step 3: 跑测试确认失败** → Run: `node --test tests/evm-anchor-adapter.test.mjs`

- [ ] **Step 4: 实现**

```js
// services/anchoring/evm-anchor-adapter.mjs

export class EvmAnchorAdapterError extends Error { /* name */ }

/** 编码：bytes32 root | bytes32 manifestHash | uint256 leafCount | bytes32 prevRoot（null → 32 零字节）。 */
export function encodeAnchorCalldata({ root, manifestHash, leafCount, prevRoot }) {
  return "0x" + [
    sha256ToBytes32(root), sha256ToBytes32(manifestHash),
    BigInt(leafCount).toString(16).padStart(64, "0"),
    prevRoot ? sha256ToBytes32(prevRoot) : "0".repeat(64),
  ].join("");
}

export function decodeAnchorCalldata(data) {
  const hex = String(data ?? "");
  if (!/^0x([0-9a-f]{256})$/.test(hex)) throw new EvmAnchorAdapterError("Anchor calldata must be exactly 256 hex chars (4 x 32 bytes).");
  const body = hex.slice(2);
  const word = (i) => body.slice(i * 64, (i + 1) * 64);
  const fromBytes32 = (wordHex) => `sha256:${wordHex}`;
  return {
    root: fromBytes32(word(0)),
    manifestHash: fromBytes32(word(1)),
    leafCount: Number(BigInt(`0x${word(2)}`)),
    prevRoot: /^0+$/.test(word(3)) ? null : fromBytes32(word(3)),
  };
}

function sha256ToBytes32(value) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new EvmAnchorAdapterError(`${value} must be sha256:<hex>.`);
  }
  return value.slice(7);
}

/** 网络侧（submitRoot/getConfirmation/readAnchoredRoot）用 ethers v6 动态引入，避免协议层/测试强依赖。 */
export async function createEvmAnchorAdapter({ network, rpcUrl, sinkAddress, operatorPrivateKeyJwk, confirmationThreshold = 12 }) {
  const { Wallet, JsonRpcProvider } = await import("ethers");
  const operatorPrivateKey = privateKeyHexFromJwk(operatorPrivateKeyJwk);
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(operatorPrivateKey, provider);
  const operatorAddress = (await wallet.getAddress()).toLowerCase();
  return {
    id: "evm",
    network,
    operatorAddress,
    async submitRoot({ root, manifestHash, leafCount, prevRoot, batchId }) {
      const tx = await wallet.sendTransaction({ to: sinkAddress, data: encodeAnchorCalldata({ root, manifestHash, leafCount, prevRoot }) });
      void batchId; // 不上链，仅日志
      return { txRef: `evm:${network}:${tx.hash}` };
    },
    async getConfirmation({ txRef }) {
      const { txId } = splitTxRef(txRef);
      const receipt = await provider.getTransactionReceipt(txId);
      if (!receipt) return { status: "pending", confirmations: 0, blockRef: null };
      const head = await provider.getBlockNumber();
      const confirmations = head - receipt.blockNumber + 1;
      if (receipt.status === 0) return { status: "failed", confirmations, blockRef: receipt.blockNumber };
      return {
        status: confirmations >= confirmationThreshold ? "confirmed" : "pending",
        confirmations,
        blockRef: receipt.blockNumber,
      };
    },
    async readAnchoredRoot({ txRef }) {
      const { txId } = splitTxRef(txRef);
      const tx = await provider.getTransaction(txId);
      if (!tx) return null;
      try {
        return { ...decodeAnchorCalldata(tx.data), sender: (tx.from ?? "").toLowerCase() };
      } catch {
        return null; // 交易存在但 calldata 不是锚定格式
      }
    },
  };
}

function splitTxRef(txRef) {
  const parts = String(txRef ?? "").split(":");
  if (parts.length !== 3 || parts[0] !== "evm") throw new EvmAnchorAdapterError(`txRef ${txRef} is not an evm anchor txRef.`);
  return { network: parts[1], txId: parts[2] };
}

function privateKeyHexFromJwk(jwk) {
  // secp256k1 JWK 的 d（base64url 32 字节）→ 0x 前缀 hex，供 ethers Wallet 使用。
  const der = atob(String(jwk?.d ?? "").replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = Uint8Array.from(der, (c) => c.charCodeAt(0));
  if (bytes.length !== 32) throw new EvmAnchorAdapterError("operatorPrivateKeyJwk.d must decode to 32 bytes.");
  return "0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

```js
// services/anchoring/solana-anchor-adapter.mjs
export async function createSolanaAnchorAdapter() {
  return stubAdapter("solana");
}

function stubAdapter(id) {
  const notImplemented = async () => { throw new Error(`${id} anchor adapter is not implemented yet.`); };
  return { id, network: null, operatorAddress: null, submitRoot: notImplemented, getConfirmation: notImplemented, readAnchoredRoot: notImplemented };
}
```

```js
// services/anchoring/tron-anchor-adapter.mjs
export async function createTronAnchorAdapter() {
  return stubAdapter("tron");
}

function stubAdapter(id) {
  const notImplemented = async () => { throw new Error(`${id} anchor adapter is not implemented yet.`); };
  return { id, network: null, operatorAddress: null, submitRoot: notImplemented, getConfirmation: notImplemented, readAnchoredRoot: notImplemented };
}
```

- [ ] **Step 5: 跑测试确认通过** → Run: `node --test tests/evm-anchor-adapter.test.mjs`

- [ ] **Step 6: Commit**

```bash
git add services/anchoring/evm-anchor-adapter.mjs services/anchoring/solana-anchor-adapter.mjs services/anchoring/tron-anchor-adapter.mjs tests/evm-anchor-adapter.test.mjs package.json package-lock.json
git commit -m "Add EVM anchor adapter with deterministic calldata and chain stubs"
```

### Task 14: CLI `scripts/verify-anchor-proof.mjs`

**Files:**
- Create: `scripts/verify-anchor-proof.mjs`
- Test: 手动运行（集成测试已覆盖 verifier；CLI 做参数/退出码校验）

- [ ] **Step 1: 实现**

```js
// scripts/verify-anchor-proof.mjs
// 用法：
//   node scripts/verify-anchor-proof.mjs --type contribution_receipt --record <record.json 路径或 '-' 表示 stdin>
//     [--batch <anchorBatchId>]（可选，默认取该记录所在批）
//   --record 的 JSON 形状即各类型协议的规范对象（收据=完整 Contribution Receipt 对象；
//   检查点=完整 Research Checkpoint；bundle=完整 Artifact Bundle）——hasher 对该对象调用对应 hash 函数。
// 数据库：与仓库其他脚本一致，从 .env.local / 托管环境读取 TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
//   （libSQL HTTP 远程）或本机 Miniflare D1 文件（--local <dbPath> 用 node:fs + libsql file: URL）。
//      adapter 由 ANCHOR_ADAPTERS_JSON 环境变量构建（adapterRegistryFromConfig）。
// 流程：读 record → hasher 按类型选择（复用 packages/protocol 对应 hash 函数）→ D1AnchorStore
//      → verifyAnchorRecord（复用 services/anchoring/anchor-verifier.mjs + resolveAdapter）
// 退出码：0=verified，2=mismatch，3=pending/unanchored，1=参数/IO 错误。
```

实现要点：参数解析用 `node:util.parseArgs`；数据库获取优先 `--env-file` 方式读 `.env.local`（沿用 `npm run runner:trusted:*` 的 `--env-file-if-exists` 惯例，脚本内用 `scripts/lib/environment-file.mjs` 若存在）；adapter 由 `ANCHOR_ADAPTERS_JSON` 环境变量构建（`adapterRegistryFromConfig`）。

- [ ] **Step 2: 语法检查 + 冒烟**

Run: `node --check scripts/verify-anchor-proof.mjs && node scripts/verify-anchor-proof.mjs --help`
Expected: 语法通过；`--help` 输出用法并退出码 1

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-anchor-proof.mjs
git commit -m "Add anchor proof verification CLI"
```

---

## Chunk 5: 公开接口 + 配置 + check 脚本 + 文档

### Task 15: 公开 API 路由

**Files:**
- Create: `app/api/anchors/route.ts`（GET 批次列表）
- Create: `app/api/anchors/[batchId]/route.ts`（GET manifest）
- Create: `app/api/anchors/proof/route.ts`（GET 包含证明）
- Create: `app/api/anchors/[batchId]/witness/route.ts`（POST 见证提交）

- [ ] **Step 1: 阅读现有路由约定**

Read `app/api/receipts/route.ts` 与 `app/api/receipts/[id]/route.ts`：`export const dynamic = "force-dynamic"`、`Response.json`、`MissingDatabaseBindingError → 503` 的错误约定。数据库句柄按 `db/repositories/*` 现行方式获取（construct `new D1AnchorStore(<binding>)`）。

- [ ] **Step 2: GET 列表与 manifest**

```ts
// app/api/anchors/route.ts —— GET /api/anchors
// 200 { batches: [...] }；锚定关闭（无适配器配置且批次表为空）→ 200 { status: "anchoring_disabled", batches: [] }
// 503 { error: { code: "unavailable", ... } } 沿用 receipts 约定
// app/api/anchors/[batchId]/route.ts —— GET manifest JSON
// 数据源：优先从 R2 bucket（env 绑定，与 Task 16 的 ANCHOR_ADAPTERS_JSON 同批配置；本地 Miniflare 用 r2Buckets）按 manifest_key 读取；
// bucket 不可用或未绑定时，从批次行 + anchor_records（listManifestLeaves）**重建** manifest 并校验 root 一致后返回——不因缺 bucket 而 404；
// 锚定关闭（无批次且无适配器配置）→ 200 { status: "anchoring_disabled", manifest: null }（spec §4.3 适用于全部读取接口）
```

- [ ] **Step 3: GET proof**

```ts
// app/api/anchors/proof/route.ts?type=&recordId=&recordHash=
// 返回 { leaf, leafHash, proof, root, batch: { id, status, chain, network, txRefs }, submissions }
// 404 当记录未入队；锚定关闭 → 200 { status: "anchoring_disabled" }（spec §4.3 适用于全部读取接口）；
// 计算走 services/anchoring/anchor-verifier.mjs 的纯函数部分（不含链上读取——链上核对由 CLI 完成，GET 不做外部 RPC）
```

- [ ] **Step 4: POST witness**

```ts
// app/api/anchors/[batchId]/witness/route.ts
// 请求体 { payload, signature, txRef }；签名负载见 packages/protocol/anchor-witness.mjs
// 身份与委派：按 app 内既有受保护路由模式取当前 Person/Agent（参考 app/authorize 或 delegations 路由的做法），
// verifyWitnessAuthority 是**显式交付物**：路由内实现（db/repositories/delegation.ts 现行 API），
// 校验 (payload, signature) 的签名者存在有效 Person/Agent 委派并返回 { submitterId, publicKey }；
// 校验失败抛 4xx。注入 coordinator.submitWitness；限频复用 services/proofweave-mcp-gateway/d1-rate-limiter.mjs。
// 4xx 明确错误码：invalid_signature / chain_mismatch / chain_truth_mismatch / not_independent / rate_limited / anchoring_disabled
```

- [ ] **Step 5: Miniflare 路由冒烟测试**

新增 `tests/anchor-api.test.mjs`：直接函数级调用各 route 的导出函数（伪造 `Request`），断言状态码与 JSON 形状（含 `anchoring_disabled` 分支）。若仓库已有对 app route 的渲染级测试模式（参考 `tests/rendered-html.test.mjs`），按其方式接入。

Run: `node --test tests/anchor-api.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/api/anchors tests/anchor-api.test.mjs
git commit -m "Add public anchor API routes with witness submission"
```

### Task 16: 配置样例 + package.json 脚本 + check:fast

**Files:**
- Modify: `.env.example`
- Modify: `package.json`

- [ ] **Step 1: `.env.example` 追加**

```bash
# On-chain anchoring (optional). Absent = anchoring disabled everywhere.
# ANCHOR_ADAPTERS_JSON=[{"id":"evm","network":"base-sepolia","rpcUrl":"https://...","sinkAddress":"0x...","operatorPrivateKeyJwk":{"kty":"EC","crv":"secp256k1","d":"..."},"confirmationThreshold":12}]
ANCHOR_BATCH_MIN_LEAVES=100
ANCHOR_BATCH_MAX_INTERVAL_SECONDS=86400
ANCHOR_CONFIRMATION_THRESHOLD=12
ANCHOR_WITNESS_THRESHOLD=1
```

- [ ] **Step 2: `package.json`**

- scripts 增加：
  `"anchor:check": "node --check packages/protocol/anchor-leaf.mjs && node --check packages/protocol/merkle-tree.mjs && node --check packages/protocol/anchor-manifest.mjs && node --check packages/protocol/anchor-witness.mjs && node --check services/anchoring/anchor-chain-adapter.mjs && node --check services/anchoring/mock-anchor-adapter.mjs && node --check services/anchoring/anchor-intake.mjs && node --check services/anchoring/anchor-batch-builder.mjs && node --check services/anchoring/anchor-manifest-storage.mjs && node --check services/anchoring/anchor-coordinator.mjs && node --check services/anchoring/d1-anchor-store.mjs && node --check services/anchoring/anchor-verifier.mjs && node --check services/anchoring/evm-anchor-adapter.mjs && node --check services/anchoring/solana-anchor-adapter.mjs && node --check services/anchoring/tron-anchor-adapter.mjs && node --check scripts/verify-anchor-proof.mjs && node --test tests/anchor-leaf.test.mjs tests/anchor-merkle-tree.test.mjs tests/anchor-manifest.test.mjs tests/anchor-witness.test.mjs tests/anchor-chain-adapter.test.mjs tests/anchor-intake.test.mjs tests/d1-anchor-store.test.mjs tests/anchor-batch-builder.test.mjs tests/anchor-manifest-storage.test.mjs tests/anchor-coordinator.test.mjs tests/anchor-verifier.test.mjs tests/anchor-flow.test.mjs tests/evm-anchor-adapter.test.mjs tests/anchor-api.test.mjs"`
- 把 `npm run anchor:check` 追加进 `check:fast` 脚本链的末尾（`npm run runtime:recovery-isolation:check` 之后）。

- [ ] **Step 3: 验证**

Run: `npm run anchor:check`
Expected: 全部 PASS

Run: `npm run check:fast`
Expected: 全部 PASS（含新 anchor:check）

- [ ] **Step 4: Commit**

```bash
git add .env.example package.json
git commit -m "Wire anchor checks into check:fast and document anchor env config"
```

### Task 17: 契约文档

**Files:**
- Create: `docs/anchor-contract.md`

- [ ] **Step 1: 写契约文档**

内容（从 spec 提炼，供使用者阅读）：
- 记录类型与各自哈希函数映射（收据/检查点/证据包）。
- 叶子/manifest/批链格式与 `pw-anchor-*-v1` 版本常量。
- 链上 calldata 布局（`bytes32 root | bytes32 manifestHash | uint256 leafCount | bytes32 prevRoot`，创世 prevRoot=0x00…00）与 txRef 格式。
- **追加式头日志说明**：实现以 `anchor_log_head.version` 为主键的追加日志承载 head（spec §3 "单行头 + CAS" 的等价实现——INSERT 主键冲突即事务内原子中止），head 历史保留可审计。
- 见证签名负载与五道闸。
- 核验路径 7 步与 CLI 用法。
- 运维：触发阈值、关闭开关 `anchoring_disabled`、失败批次放弃/回滚规则、密钥托管（JWK）与轮换。

- [ ] **Step 2: Commit**

```bash
git add docs/anchor-contract.md
git commit -m "Add anchor contract documentation"
```

### Task 18: 生产接线（签发入队 + 触发脚本）

**Files:**
- Modify: `services/receipts/d1-contribution-receipt-coordinator.mjs`
- Create: `scripts/anchor-tick.mjs`
- Modify: `package.json`（新增 `anchor:tick` script）

- [ ] **Step 1: 收据签发成功后入队**

在 `services/receipts/d1-contribution-receipt-coordinator.mjs` 的签发成功路径（`issue` 完成并持久化后）追加 best-effort 入队：构造 `D1AnchorStore`（同一 database）+ `createAnchorIntake`，调用 `enqueueAnchorRecord({ recordType: "contribution_receipt", recordId: receipt.id, recordHash: await contributionReceiptHash(receipt), createdAt })`。**入队失败不得影响签发**：包在 try/catch 中，失败仅记录（沿用仓库结构化审计 `packages/observability/structured-audit.mjs`）。检查点与证据包签发路径同模式（在各自 store/coordinator 的成功路径追加；提交 PR 时列出改动的具体文件）。

- [ ] **Step 2: 触发脚本**

```js
// scripts/anchor-tick.mjs
// 一次 tick 依次执行：resumeUnfinishedBatches() → maybeBuildAndSubmit({ lastBatch: await store.getLatestBatch() })
//   → pollConfirmations()；输出 JSON 摘要；适配器未配置 → 输出 { status: "anchoring_disabled" } 且退出码 0。
// AnchorStoreConflictError（建批 CAS 竞争）**不在脚本内重试**——tick 是单次的，cron 的下一次运行即重试；输出冲突摘要并退出码 0。
// 数据库与 ANCHOR_ADAPTERS_JSON 从 .env.local / 托管环境读取（沿用 --env-file-if-exists 惯例）。
```

package.json 增加：`"anchor:tick": "node --env-file-if-exists=.env.local scripts/anchor-tick.mjs"`。定时调度（cron）是部署层配置，写进 `docs/anchor-contract.md` 的运维小节，不在本仓库代码内实现。

- [ ] **Step 3: 验证 + Commit**

把 `node --check scripts/anchor-tick.mjs` 追加进 `package.json` 的 `anchor:check` 链末尾（Task 16 已建立该链）。

Run: `npm run anchor:check`
Expected: PASS（含 anchor-tick 的 --check）

```bash
git add services/receipts/d1-contribution-receipt-coordinator.mjs scripts/anchor-tick.mjs package.json docs/anchor-contract.md
git commit -m "Wire receipt issuance into anchor intake and add anchor tick script"
```

---

## 完成定义（验收）

1. `npm run anchor:check` 全绿；`npm run check:fast` 全绿。
2. `npm run lint && npm run typecheck` 通过。
3. `tests/anchor-flow.test.mjs` 证明链下闭环：入队→建批→mock 提交→确认→`verifyAnchorRecord` 返回 `verified`，篡改返回 `mismatch`。
4. `tests/evm-anchor-adapter.test.mjs` 证明 calldata 跨实现可解析；无真实链依赖。
5. 迁移 `0046` 在 Miniflare 全量迁移下可重复执行（`INSERT OR IGNORE` / `IF NOT EXISTS`）。
6. 不引入除 `ethers` 外的新依赖；`ethers` 只在 `evm-anchor-adapter.mjs` 内动态 import。

## 明确不做（本计划）

- Solana/Tron 适配器实现（仅桩）、最小事件注册合约、真实链部署与真实 gas 运行。
- 定时调度器本身（cron 触发 `npm run anchor:tick` 是部署层配置，只在 `docs/anchor-contract.md` 记录）。
- DID/VC、钱包登录、链上结算（属子项目 A/C）。
- 检查点与证据包签发路径的入队接线：Task 18 Step 1 以收据路径为完整实现，检查点/证据包按同一模式在各自签发路径追加（提交 PR 时列出改动文件；如发现签发入口分散，先接收据并在 PR 描述中记录其余入口的后续工单）。
