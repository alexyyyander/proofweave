# 链上防篡改锚定设计

日期：2026-10-14
状态：待实现
范围：Proofweave 三个 Web3 子项目中的 **B. 防篡改锚定**（A. 去中心化身份 + VC、C. 链上结算为后续工作）

## 1. 目标与非目标

### 1.1 目标

把 Proofweave 已经产生的可验证记录（贡献收据、公开研究检查点、证据包）的规范哈希批量锚定到区块链，使任何第三方能在不信任平台的前提下独立核验：

- 某条记录在时间 T 已存在（存在性）。
- 该记录自 T 起未改变（完整性）。
- 多个批次构成仅追加日志，且平台不能事后重写历史顺序。

设计为**链无关**：锚定逻辑与具体链解耦，通过可插拔适配器支持 EVM、Solana、Tron，先实现 EVM。

### 1.2 非目标（本子项目不做）

- 不证明数学正确性、新颖性或作者身份；只证明哈希存在与未被篡改。
- 不涉及代币、积分流转、托管、KYC/AML、真实付款（属子项目 C）。
- 不做钱包登录、DID/VC 签发（属子项目 A）。
- 不上链任何原始证据字节或个人信息，只上链哈希。
- 不在本子项目内实现 Solana/Tron 适配器（只定义接口并留桩）。

## 2. 架构

```
现有记录（收据/检查点/证据包，各有规范哈希）
        │  入队
        ▼
anchor_records（待锚定叶子） ──► AnchorBatchBuilder
                                    │ 按 (type,id,hash) 确定性排序
                                    │ RFC6962 风格 Merkle（0x00 叶 / 0x01 节点）
                                    ▼
                            anchor_batches（根 + prevRoot 链式）
                                    │
                        ┌───────────┴────────────┐
                        ▼                        ▼
              AnchorChainAdapter          内容寻址 manifest
          （evm / solana / tron）        （R2: sha256:<hash>）
                        │
                        ▼
            链上：root + manifestHash + leafCount + prevRoot
                        │
        平台默认提交 + 见证者可独立提交同一 root（anchor_submissions）
                        │
                        ▼
        公开核验：/api/anchors/* + scripts/verify-anchor-proof.mjs
```

### 2.1 叶子定义

每条可锚定记录映射为一个叶子：

```json
{
  "protocolVersion": "pw-anchor-leaf-v1",
  "recordType": "contribution_receipt | research_checkpoint | evidence_bundle",
  "recordId": "<平台内稳定 ID>",
  "recordHash": "sha256:<64 hex>"
}
```

字段名与仓库既有协议一致，使用 `protocolVersion`（如同名常量 `anchorLeafProtocolVersion`）。

- `recordHash` 使用该记录协议已有的规范哈希，每种类型**唯一确定**。
  - `contribution_receipt`：`await contributionReceiptHash(receipt)`（`packages/protocol/contribution-receipt.mjs`）。
  - `research_checkpoint`：`await researchCheckpointHash(checkpoint)`（`packages/protocol/research-checkpoint.mjs`）。
  - `evidence_bundle`：`await artifactBundleHash(bundle)`（`packages/protocol/artifact-bundle.mjs`）。该哈希已覆盖工作区树（workspace tree hash），因此**不再单独取树哈希**，避免歧义。
- `leafHash = sha256(0x00 ‖ canonicalJson(anchorLeaf))`，类型字段参与哈希，形成域分隔，防止二次原像与跨类型碰撞。

### 2.2 Merkle 与批链

- 采用 RFC6962（Certificate Transparency）的 Merkle Tree Hash（MTH）定义，并**固定**非 2 的幂叶子数的树形状规则，保证跨实现可复现：
  - 叶（对单叶节点）：`MTH([d]) = sha256(0x00 ‖ d)`
  - 空树：`MTH([]) = sha256("")`
  - `n > 1` 时，取**小于 n 的最大 2 的幂** `k`，则 `MTH(D[0:n]) = sha256(0x01 ‖ MTH(D[0:k]) ‖ MTH(D[k:n]))`（不复制末叶，只做递归二分）。
- **接口职责切分（避免二次域前缀）**：`anchorLeafHash(leaf)` 内部执行一次叶步骤 `sha256(0x00 ‖ canonicalJson(leaf))`，返回 `leafHash`；`buildMerkleTree(leafHashes)` 接收**已计算的 `leafHash` 数组**，只做内部节点组合与形状计算，**不再**对叶子加 `0x00` 前缀。包含证明由 `generateInclusionProof(tree, index)` 生成（`tree` 为 `buildMerkleTree` 返回值，`index` 为叶子在确定性排序中的下标），核验用 `verifyInclusionProof(leafHash, proof, root)`。文档与实现必须保持这一分工；具体签名以 §4.1 为准。
- 叶子顺序确定性：按 `(recordType, recordId, recordHash)` 升序排列，保证同一集合产生同一根。
- 每批次根为 `root`，并记录 `prevRoot`（上一批次的根）与 `prevBatchId`，构成仅追加日志。创世批次的 `prevRoot` 为 `null`。
- **追加链串行化**：批次创建必须串行，禁止并发产生分叉。实现方式：以单行头记录（`anchor_log_head`，详见 §3）保存“当前最新批次与 `prevRoot`”，建批事务在同一事务内读取并更新该行（比较并交换）；任何并发建批因头记录版本冲突而失败并重试，从而保证任一时刻只有一个开放批次、`prevRoot` 指向唯一前驱。
- manifest 记录全部叶子的 `{recordType, recordId, recordHash}` 列表与根，其规范 JSON 的哈希为 `manifestHash`；manifest 自身包含 `protocolVersion: "pw-anchor-manifest-v1"`，用于版本承载与核验。
- **快照边界**：建批在一个事务内完成“选中并锁定待锚定记录”。builder 只选中 `batch_id IS NULL` 的记录，并在同一事务内将其 `batch_id` 更新为该批次。建批开始后新入队的记录 `batch_id` 仍为 `null`，自动进入下一批。因此同一记录不会被两个批次同时覆盖，根确定且不漏锚。
- **触发条件**：建批由 `anchor-coordinator` 触发，满足以下任一即建批——待锚定记录数 `>= N`，或距上一批 `created_at`（无上一批则以协调器首次运行为基准）`>= T`。`N`、`T` 为托管配置（默认值见 §9）。协调触发可由定时任务调用 coordinator，不改变上述串行化保证。
- **空批次**：若满足触发条件时待锚定记录数为 0，则**不创建批次**（不做空追加），直接返回“无待锚定记录”。因此 `MTH([]) = sha256("")` 仅作为算法定义保留，不会因定时触发而误产生空批次。

### 2.3 链抽象

适配器接口（链无关）：

```js
// AnchorChainAdapter（JSDoc 标注）
{
  id,       // "evm" | "solana" | "tron"
  network,  // "base-sepolia" | "mainnet" | ...
  async submitRoot({ root, manifestHash, leafCount, prevRoot, batchId }) -> { txRef },
  async getConfirmation({ txRef }) -> { status, confirmations, blockRef },
  async readAnchoredRoot({ txRef }) -> { root, manifestHash, leafCount, prevRoot, sender } | null
}
```

- `txRef` 为链无关引用，形如 `<chain>:<network>:<txId>`（EVM 为交易哈希）。
- 上链载荷为 `(root, manifestHash, leafCount, prevRoot)`，不含批次之外的任何数据。`submitRoot` 入参中的 `batchId` **不上链**，仅用于本地幂等与日志关联。
- **EVM 适配器（先做）**：起步用 calldata memo，向固定 sink 地址发送一笔交易，calldata 为这四个字段的确定性编码；核验时从交易输入解析。后续可平滑替换为最小事件注册合约（发出 `Anchored(root, manifestHash, leafCount, prevRoot)` 事件），以便见证者与外部工具消费。
- **创世批次编码**：`prevRoot = null` 在链上编码为 32 字节全零（`0x00…00`），使 `readAnchoredRoot` 判定无歧义。
- **Solana 适配器（留桩）**：memo 指令承载四字段编码。
- **Tron 适配器（留桩）**：memo/tx data 承载同一编码。
- 适配器由 `resolveAdapter(chainId)` 从托管环境变量解析（RPC URL、sink 地址、签名密钥引用）。见证者提交的 `txRef` 形如 `<chain>:<network>:<txId>`；端点解析出 `chain`/`network` 后，用同一 `resolveAdapter` 得到匹配该网络的适配器实例（一个 chain 可配置多个 network 适配器）。

### 2.4 提交主体（混合模型）

- 平台使用一个运营密钥默认提交，并出 gas。
- 任何具备有效 Person/Agent 身份与签名的见证者，可对同一 `root` 独立提交（`submitter_kind = witness`）。
- **见证者绑定与提交路径**（本子项目内实现，不留到后续）：
  - 见证者通过 `POST /api/anchors/:batchId/witness` 提交，携带其 Person/Agent 签名与 `txRef`。签名负载为 `canonicalJson({ protocolVersion: "pw-anchor-witness-v1", batchId, root, manifestHash, txRef })`，用仓库既有的 Ed25519 校验路径（参考 `db/repositories/delegation.ts` 的签名校验与 `packages/protocol/canonical-json.mjs`）验证，且提交方必须存在有效委派。校验失败返回明确错误。
  - **链上真值校验（强制）**：记录提交前，端点/coordinator 必须调用适配器 `readAnchoredRoot({ txRef })`，确认该交易在链上确实承载与该批次一致的 `root`、`manifestHash`、`leafCount`、`prevRoot`。只有链上一致性通过，才写入 `anchor_submissions` 并计入 `witness_count`。仅签名正确而链上不符的提交被拒绝。这防止持有有效身份者用任意 `txRef` 刷高见证计数。
  - **独立性校验（强制）**：见证者提交的 `txRef` 不得与平台提交复用同一交易（由 `(chain, network, tx_ref)` 唯一约束保证），且 `readAnchoredRoot` 返回的 `sender` 必须与该批次平台提交的发送地址**不同**。否则视为非独立提交并拒绝。这使“见证者”必须自行完成一次真实链上锚定。
  - 同一 `(chain, network, tx_ref)` 唯一，重复提交去重；同一见证者对同一批次重复提交幂等。
  - `K`（独立见证者数量阈值）为托管配置。系统统计 `submitter_kind = witness` 且 `status = confirmed` 的**不同** `submitter_id` 数量。
- **正交状态**：链上确认状态与见证状态是两个维度，分别记录，不塞进同一枚举：
  - `anchor_batches.status ∈ { built, submitted, confirmed, failed }`：只表示平台/适配器的链上确认进展。
  - `anchor_batches.witness_count`（整数）：已达确认的独立见证者数量；`witness_state` 由 `witness_count >= K` 派生为 `witnessed`，否则 `none`。
  - 因此批次可以同时是 `confirmed` 且 `witnessed`；见证状态不会覆盖终态失败，失败批次保留其已有见证者提交记录。
- **唯一规范网络**：每个批次有一个平台提交绑定的规范 `chain:network`，批次 `status` 由该网络上的平台提交驱动。见证者必须使用该规范网络提交（端点拒绝其他网络，返回明确错误），从而消除多链提交时状态语义歧义。若要锚定到多个网络，建立多个批次（各自带独立 `prevRoot` 链）。

### 2.5 数据可用性

- 平台提供公开只读接口返回批次与包含证明。
- manifest 同时写入内容寻址存储（R2，key = `sha256:<manifestHash>`），即使平台接口不可用也能取出叶子与证明。
- 链上只存根，不存全量清单。

### 2.6 信任边界

- 只上链哈希，无 PII，无原始证据字节。
- 运营密钥与任何链签名密钥按仓库既有托管密钥模式存放（参考 `RUNNER_CONTROL_PLANE_PRIVATE_KEY_JWK` 的 JWK 托管方式），绝不进入提交者的本地环境或 Lean 沙箱。
- 锚定只建立“存在 + 自 T 起不变 + 追加顺序”，正确性仍由现有审阅与收据流程承担。
- 锚定层信任入队路径（`anchor-intake`）传入的 `recordHash` 就是该记录的真实规范哈希；本层不反向读取各记录存储去复核。独立核验（§5 第 1 步）会从记录本身重算 `recordHash`，因此传入假哈希只会让对应核验失败，而不会产生“记录已被正确锚定”的可核验断言。

## 3. 数据模型（D1/Turso，追加式 + 投影）

| 表 | 关键列 | 说明 |
| --- | --- | --- |
| `anchor_records` | `id, record_type, record_id, record_hash, leaf_hash, created_at, batch_id(nullable)` | 每条可锚定记录的叶子；唯一约束 `(record_type, record_id, record_hash)`。`batch_id` 为 `null` 表示待锚定。 |
| `anchor_batches` | `id, status(built/submitted/confirmed/failed), root, leaf_count, manifest_hash, manifest_key, prev_batch_id, prev_root, chain, network, witness_count, created_at, anchored_at` | 一个 Merkle 批次。`status` 只表示链上确认状态；`chain`+`network` 是该批次的唯一规范网络；`witness_count` 为独立见证者数量，`witnessed` 由 `witness_count >= K` 派生。 |
| `anchor_submissions` | `id, batch_id, submitter_kind(platform/witness), submitter_id, chain, network, tx_ref, status(pending/confirmed/failed), confirmations, block_ref, submitted_at, updated_at` | 平台与见证者的链上提交；唯一约束 `(chain, network, tx_ref)`。 |
| `anchor_batch_events` | `id, batch_id, event_type, payload_hash, canonical_payload, created_at` | 不可变事件日志，沿用仓库既有“投影 + 事件”模式。 |
| `anchor_log_head` | `id(单行固定值), head_batch_id, head_root, version, updated_at` | 单行头记录，用于批次追加链串行化（比较并交换 `version`），保证无并发分叉。 |

- 迁移：新增 `drizzle/0046_add_anchor_*.sql`（当前最新为 `0045_expand_curated_research_records.sql`，故从 `0046` 起）。
- **数据归属**：锚定数据与收据、运行、审阅同属共享控制平面（生产为 Turso，本地/回退为 D1 兼容库）。`d1-anchor-store` 沿用仓库既有的 D1 兼容 SQL（本地可用、生产经 libSQL 适配器走 Turso），不在 Sites D1 另建一套锚定权威，防止与收据等事实分裂。
- 状态投影与事件必须原子写入，违反时抛出一致性错误（沿用 `d1-run-store.mjs` 等既有 store 的做法）。
- 触发器不在数据库层实现；由 coordinator 按 §2.2 的 `N`/`T` 条件判定。
- **记录更正生命周期**：记录内容改变会产生新的 `recordHash`，即新叶子，进入后续批次；旧叶子与旧批次保持不变（仅追加）。更正通过记录自身协议（如收据的 `contribution-receipt-lifecycle`）表达，锚定层只保证各版本哈希各自的存证，不解释更正语义。
- **失败批次中已锁定记录的去向**：若批次永久失败且**没有任何已确认提交**，运营者可放弃该批次，将其记录的 `batch_id` 重置为 `null`（同时写不可变事件），使其可被后续批次重新选取；**放弃时必须在同一事务内把 `anchor_log_head` 回滚到上一批（或创世状态）**，使失败批次退出追加链，`prevRoot` 只指向真实锚定过的批次，外部核验的“追加顺序”因此不含未上链的根。若已有任一确认提交，则**不得**释放或回滚，避免重复锚定，改为保留批次并按需重试提交。重试始终针对同一 `batchId`/`root`，幂等。
- **批次状态流转**：`built → submitted → confirmed`，或 `submitted → failed`。链上交易回退（reverted）或被丢弃在达到确认阈值后仍判 `failed`，不计为确认；`built` 是建批后提交前的瞬时状态。

## 4. 组件与接口

### 4.1 协议层（纯函数，`packages/protocol/`）

| 文件 | 导出 |
| --- | --- |
| `anchor-leaf.mjs` | `normalizeAnchorLeaf`、`anchorLeafHash`、`anchorLeafProtocolVersion` |
| `merkle-tree.mjs` | `buildMerkleTree(leafHashes)`、`generateInclusionProof(tree, index)`、`verifyInclusionProof(leafHash, proof, root)`、`emptyMerkleRoot` |
| `anchor-manifest.mjs` | `canonicalAnchorManifest`、`anchorManifestHash`、`anchorManifestProtocolVersion`、`verifyAnchorManifest` |

要求：确定性、无副作用、无外部依赖，可被浏览器与 Worker 同时使用；篡改任一叶、根或证明必须导致校验失败。`normalizeAnchorLeaf` 采用字段白名单（仅 `protocolVersion`、`recordType`、`recordId`、`recordHash`），拒绝未知字段，并对 `recordHash` 强制 `sha256:<64 hex>` 格式，以保证域分隔与核验的确定性。

### 4.2 服务层（`services/anchoring/`）

| 文件 | 职责 |
| --- | --- |
| `anchor-chain-adapter.mjs` | 接口定义、`resolveAdapter(chainId)`、适配器注册表、配置校验 |
| `evm-anchor-adapter.mjs` | EVM 实现（calldata memo 起步） |
| `solana-anchor-adapter.mjs` | 接口桩，返回“未实现”错误，禁止静默降级 |
| `tron-anchor-adapter.mjs` | 接口桩，同上 |
| `anchor-batch-builder.mjs` | 拉取待锚定 `anchor_records` → 排序 → 建树 → 生成 manifest → 计算 `manifestHash` |
| `anchor-intake.mjs` | 入队接口：`enqueueAnchorRecord({ recordType, recordId, recordHash })`，写入/更新 `anchor_records`（幂等，唯一约束去重）。由收据、检查点、证据包各自的签发/落库路径在成功后调用；锚定层不反向读取各记录存储。 |
| `anchor-coordinator.mjs` | 编排：建批 → 落库 → 内容寻址存储 → 平台提交 → 轮询确认 → 更新状态；处理见证者提交（校验签名/委派、去重、更新 `witness_count`）；幂等、可恢复 |
| `d1-anchor-store.mjs` | D1/Turso 读写，投影与事件原子写入 |
| `anchor-verifier.mjs` | 给定记录规范 JSON/哈希与批次，重算并核验（供接口与 CLI 复用）；叶子在批内的下标由该批次 manifest 的确定性排序派生，再生成/校验包含证明 |

### 4.3 公开接口（GET 匿名只读；POST 需身份与签名；均无 PII）

| 方法 | 路径 | 返回 |
| --- | --- | --- |
| GET | `/api/anchors` | 批次列表（分页、状态筛选、见证状态筛选） |
| GET | `/api/anchors/:batchId` | 该批次 manifest |
| GET | `/api/anchors/proof?type=&recordId=&recordHash=` | 叶子、`leafHash`、包含路径、`root`、批次、提交记录 |
| POST | `/api/anchors/:batchId/witness` | 见证者提交一个链上确认的 `txRef`；先校验其 Person/Agent 签名与委派，再调用 `readAnchoredRoot(txRef)` 确认链上确实承载该批次的 `root`/`manifestHash`，通过后写入 `anchor_submissions` 并更新 `witness_count` |

- 三个 GET 为匿名只读；`POST .../witness` 需要有效身份与签名，写入路径见 §2.4。
- 核验计算为纯函数，GET 接口不写库。
- 锚定关闭（适配器未配置）时，读取接口返回明确状态 `anchoring_disabled`，`witness` 写入返回明确拒绝，不返回伪造成功。

### 4.4 命令行

- `scripts/verify-anchor-proof.mjs`：给定记录与批次引用，执行完整核验（重算记录哈希 → 叶哈希 → 路径 → 链上根比对），退出码区分 `verified / mismatch / pending`。
- `npm run anchor:check`：见第 7 节。

### 4.5 依赖

- EVM/Tron 签名需 secp256k1。建议在适配器内隔离引入 `ethers` v6（或 `viem`）。选择在实现计划中确定并记录。
- Solana 复用内置 Ed25519（WebCrypto）+ 一个 base58 编码器。
- 依赖仅限适配器层，协议层与建批层保持零外部依赖。

## 5. 核验路径

1. 取记录规范 JSON，用记录自身协议重算 `recordHash`。
2. 用 `recordHash` 定位叶子与包含证明。
3. 重算 `leafHash`，沿证明逐层计算至 `root`。
4. 通过适配器或公共 RPC，从 `txRef` 读取链上 `root`。
5. 比对链上 `root` 与第 3 步结果，并要求确认数 ≥ 阈值。
6. 校验 `prevRoot` 与前一批次连续。
7. 输出 `verified | mismatch | pending`。

给定 manifest 内容寻址副本与链读取，核验可完全独立于平台在线状态。

## 6. 失败与运维

- **RPC 失败**：指数退避重试；批次保持 `submitted`；可按 `batchId` 幂等重发。
- **nonce 管理**：每次提交顺序 nonce，冲突时重新读取并重发。
- **链重组**：确认阈值可配（EVM 默认 12）；不足阈值标 `pending`，不标确认。
- **gas**：单笔 gas 上限与预算告警；失败可重试；不静默吞掉失败。
- **见证者**：同一 `root` 重复提交去重；提交方须有有效 Person/Agent 签名，否则拒绝。因见证必须先真实上链（出 gas），垃圾提交天然受限；仍在 `POST .../witness` 加每 Person/每分钟限频，沿用仓库既有限频组件（参考 `remote_mcp_rate_limit_buckets` / `d1-remote-mcp-rate-limiter.mjs`）。
- **密钥轮换**：运营密钥以 JWK 托管；轮换不影响批次内容（交易只含根与 manifest 哈希）。
- **关闭开关**：适配器未配置时，锚定整体关闭，所有接口返回 `anchoring_disabled`。这与“阈值配置值”是两件事：`存在=/关闭` 由适配器配置决定；`N`、`T`、确认数、`K` 是启用后各自的数值参数，缺失时使用文档化默认值，不隐式关闭。

## 7. 测试

- **协议单元测试**：叶子编码与域分隔、Merkle 根与包含证明、篡改叶/根/证明必须失败、批次 `prevRoot` 链式连续。
- **适配器测试**：mock 适配器驱动 coordinator 完成建批到确认；EVM 可选接本地 anvil 或对录制交易做解码/解析测试。
- **集成测试**：从伪造的收据/检查点/证据包 → 建批 → manifest 内容寻址 → CLI 核验通过；篡改后核验失败。
- **端点测试**：Miniflare 下匿名 GET manifest/proof；锚定关闭时返回 `anchoring_disabled`。
- **命令**：新增 `npm run anchor:check`，纳入 `check:fast`（与仓库既有 `runner:check`、`receipt:check` 同风格）。默认全程使用 mock/fixture，不依赖真实链；真实链核验作为单独的手动命令。

## 8. 建议的实现顺序（供实现计划细化）

1. 协议层：叶子、Merkle、manifest（纯函数 + 单元测试）。
2. 数据模型：迁移 + `d1-anchor-store`（投影/事件原子写入）。
3. 批建造器 + coordinator（mock 适配器）。
4. EVM 适配器（calldata memo）。
5. 公开接口 + 内容寻址存储。
6. CLI 核验 + `anchor:check`。
7. 文档：`docs/anchor-contract.md`、运维说明；Solana/Tron 桩接口说明。

自然分界：步骤 1–3（协议层 + 数据模型 + 建批/coordinator，用 mock 适配器）构成可独立验收的“链下闭环”；步骤 4–7（EVM 适配器 + 公开接口 + 内容寻址存储 + CLI）构成“链上闭环”。实现计划按此拆成两个阶段，各自有独立验收点。

## 9. 未决事项（实现计划阶段确定）

- EVM 签名库选型：`ethers` v6 还是 `viem`。
- 默认数值：建批条数 `N`（建议 100）、时间 `T`（建议 24h）、确认数（EVM 建议 12）、见证者阈值 `K`（建议 1）；`K` 的语义已在 §2.4 固定，此处只定默认值。
- R2 内容寻址桶与公开读取策略（仅 manifest，不含任何私有字节）。
- 是否在首版即引入最小事件注册合约，或先 calldata memo 后替换。
