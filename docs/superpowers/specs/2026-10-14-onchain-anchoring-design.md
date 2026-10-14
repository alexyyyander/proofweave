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
  "v": "pw-anchor-leaf-v1",
  "recordType": "contribution_receipt | research_checkpoint | evidence_bundle",
  "recordId": "<平台内稳定 ID>",
  "recordHash": "sha256:<64 hex>"
}
```

- `recordHash` 使用该记录协议已有的规范哈希：
  - 收据：`contributionReceiptHash`（`packages/protocol/contribution-receipt.mjs`）。
  - 公开检查点：检查点协议规范哈希（`packages/protocol/research-checkpoint.mjs`）。
  - 证据包：工作区树哈希 + bundle 哈希（`packages/protocol/artifact-bundle.mjs`、`packages/protocol/workspace-tree.mjs`）。
- `leafHash = sha256(0x00 ‖ canonicalJson(anchorLeaf))`，类型字段参与哈希，形成域分隔，防止二次原像与跨类型碰撞。

### 2.2 Merkle 与批链

- 采用 RFC6962（Certificate Transparency）风格哈希：
  - 叶：`H(0x00 ‖ leafBytes)`
  - 内部节点：`H(0x01 ‖ left ‖ right)`
- 叶子顺序确定性：按 `(recordType, recordId, recordHash)` 升序排列，保证同一集合产生同一根。
- 每批次根为 `root`，并记录 `prevRoot`（上一批次的根）与 `prevBatchId`，构成仅追加日志。创世批次的 `prevRoot` 为 `null`。
- manifest 记录全部叶子的 `{recordType, recordId, recordHash}` 列表与根，其规范 JSON 的哈希为 `manifestHash`。

### 2.3 链抽象

适配器接口（链无关）：

```js
// AnchorChainAdapter（JSDoc 标注）
{
  id,       // "evm" | "solana" | "tron"
  network,  // "base-sepolia" | "mainnet" | ...
  async submitRoot({ root, manifestHash, leafCount, prevRoot, batchId }) -> { txRef },
  async getConfirmation({ txRef }) -> { status, confirmations, blockRef },
  async readAnchoredRoot({ txRef }) -> { root, manifestHash, leafCount, prevRoot } | null
}
```

- `txRef` 为链无关引用，形如 `<chain>:<network>:<txId>`（EVM 为交易哈希）。
- 上链载荷为 `(root, manifestHash, leafCount, prevRoot)`，不含批次之外的任何数据。
- **EVM 适配器（先做）**：起步用 calldata memo，向固定 sink 地址发送一笔交易，calldata 为这四个字段的确定性编码；核验时从交易输入解析。后续可平滑替换为最小事件注册合约（发出 `Anchored(root, manifestHash, leafCount, prevRoot)` 事件），以便见证者与外部工具消费。
- **Solana 适配器（留桩）**：memo 指令承载四字段编码。
- **Tron 适配器（留桩）**：memo/tx data 承载同一编码。
- 适配器由 `resolveAdapter(chainId)` 从托管环境变量解析（RPC URL、sink 地址、签名密钥引用）。

### 2.4 提交主体（混合模型）

- 平台使用一个运营密钥默认提交，并出 gas。
- 任何具备有效 Person/Agent 身份与签名的见证者，可对同一 `root` 独立提交（`submitter_kind = witness`）。
- 同一 `root` 的多个提交去重；批次状态：
  - `confirmed`：至少一个提交达到确认阈值。
  - `witnessed`：达到 K 个独立见证者提交（K 可配置）。
- 见证者提交需绑定到现有身份体系；不新增身份类型。

### 2.5 数据可用性

- 平台提供公开只读接口返回批次与包含证明。
- manifest 同时写入内容寻址存储（R2，key = `sha256:<manifestHash>`），即使平台接口不可用也能取出叶子与证明。
- 链上只存根，不存全量清单。

### 2.6 信任边界

- 只上链哈希，无 PII，无原始证据字节。
- 运营密钥与任何链签名密钥按仓库既有托管密钥模式存放（参考 `RUNNER_CONTROL_PLANE_PRIVATE_KEY_JWK` 的 JWK 托管方式），绝不进入提交者的本地环境或 Lean 沙箱。
- 锚定只建立“存在 + 自 T 起不变 + 追加顺序”，正确性仍由现有审阅与收据流程承担。

## 3. 数据模型（D1/Turso，追加式 + 投影）

| 表 | 关键列 | 说明 |
| --- | --- | --- |
| `anchor_records` | `id, record_type, record_id, record_hash, leaf_hash, created_at, batch_id(nullable)` | 每条可锚定记录的叶子；唯一约束 `(record_type, record_id, record_hash)`。`batch_id` 为 `null` 表示待锚定。 |
| `anchor_batches` | `id, status(built/submitted/confirmed/failed/witnessed), root, leaf_count, manifest_hash, manifest_key, prev_batch_id, prev_root, created_at, anchored_at` | 一个 Merkle 批次。 |
| `anchor_submissions` | `id, batch_id, submitter_kind(platform/witness), submitter_id, chain, network, tx_ref, status(pending/confirmed/failed), confirmations, block_ref, submitted_at, updated_at` | 平台与见证者的链上提交；唯一约束 `(chain, network, tx_ref)`。 |
| `anchor_batch_events` | `id, batch_id, event_type, payload_hash, canonical_payload, created_at` | 不可变事件日志，沿用仓库既有“投影 + 事件”模式。 |

- 迁移：新增 `drizzle/00NN_add_anchor_*.sql`（编号按当时最新迁移顺延）。
- 状态投影与事件必须原子写入，违反时抛出一致性错误（沿用 `d1-run-store.mjs` 等既有 store 的做法）。
- 触发器不在数据库层实现；由 coordinator 按阈值判定。

## 4. 组件与接口

### 4.1 协议层（纯函数，`packages/protocol/`）

| 文件 | 导出 |
| --- | --- |
| `anchor-leaf.mjs` | `normalizeAnchorLeaf`、`anchorLeafHash`、`anchorLeafProtocolVersion` |
| `merkle-tree.mjs` | `buildMerkleTree(leaves)`、`generateInclusionProof(tree, index)`、`verifyInclusionProof(leafHash, proof, root)` |
| `anchor-manifest.mjs` | `canonicalAnchorManifest`、`anchorManifestHash`、`verifyAnchorManifest` |

要求：确定性、无副作用、无外部依赖，可被浏览器与 Worker 同时使用；篡改任一叶、根或证明必须导致校验失败。

### 4.2 服务层（`services/anchoring/`）

| 文件 | 职责 |
| --- | --- |
| `anchor-chain-adapter.mjs` | 接口定义、`resolveAdapter(chainId)`、适配器注册表、配置校验 |
| `evm-anchor-adapter.mjs` | EVM 实现（calldata memo 起步） |
| `solana-anchor-adapter.mjs` | 接口桩，返回“未实现”错误，禁止静默降级 |
| `tron-anchor-adapter.mjs` | 接口桩，同上 |
| `anchor-batch-builder.mjs` | 拉取待锚定 `anchor_records` → 排序 → 建树 → 生成 manifest → 计算 `manifestHash` |
| `anchor-coordinator.mjs` | 编排：建批 → 落库 → 内容寻址存储 → 提交 → 轮询确认 → 更新状态；幂等、可恢复 |
| `d1-anchor-store.mjs` | D1/Turso 读写，投影与事件原子写入 |
| `anchor-verifier.mjs` | 给定记录规范 JSON/哈希与批次，重算并核验（供接口与 CLI 复用） |

### 4.3 公开接口（匿名只读，无 PII）

| 方法 | 路径 | 返回 |
| --- | --- | --- |
| GET | `/api/anchors` | 批次列表（分页、状态筛选） |
| GET | `/api/anchors/:batchId` | 该批次 manifest |
| GET | `/api/anchors/proof?type=&recordId=&recordHash=` | 叶子、`leafHash`、包含路径、`root`、批次、提交记录 |

- 核验计算为纯函数，接口不写库。
- 锚定关闭时，接口返回明确状态 `anchoring_disabled`（对齐 Runner 的 paused 真实性语义），不返回伪造成功。

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
- **见证者**：同一 `root` 重复提交去重；提交方须有有效 Person/Agent 签名，否则拒绝。
- **密钥轮换**：运营密钥以 JWK 托管；轮换不影响批次内容（交易只含根与 manifest 哈希）。
- **关闭开关**：阈值为 0 或适配器未配置时，锚定整体关闭，所有接口返回 `anchoring_disabled`。

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

## 9. 未决事项（实现计划阶段确定）

- EVM 签名库选型：`ethers` v6 还是 `viem`。
- 阈值 N、T、确认数、见证者 K 的默认值。
- R2 内容寻址桶与公开读取策略（仅 manifest，不含任何私有字节）。
- 是否在首版即引入最小事件注册合约，或先 calldata memo 后替换。
