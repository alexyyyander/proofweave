# 工作交接说明：链上锚定交付 + Web3 路线推进

日期：2026-10-15（Asia/Shanghai）
范围：`801abc4`（本会话起点）→ `bd00b18`（HEAD），39 个提交，53 文件，+8536 行
分支：`codex/public-research-aggregation`（未推远端）
测试：`npm run anchor:check` 71/71 ✅；`check:fast` 全链 ✅；lint/typecheck ✅

## 1. 一句话概述

完成 Web3 路线三个子项目中 **B（防篡改锚定）的全量交付**（设计→计划→实现→生产迁移），**A（去中心化身份+VC）完成双评审设计**，并处理了锚定的 4 个评审遗留工单与生产部署准备。

## 2. 交付内容

### 2.1 设计与文档

| 文档 | 状态 |
| --- | --- |
| `docs/superpowers/specs/2026-10-14-onchain-anchoring-design.md` | ✅ 5 轮评审通过（子项目 B spec） |
| `docs/superpowers/plans/2026-10-14-onchain-anchoring.md` | ✅ 5 轮评审通过（18 任务实现计划，含执行期修正记录） |
| `docs/anchor-contract.md` | ✅ 锚定契约（面向使用者/运维） |
| `docs/anchor-deployment-2026-10-15.md` | ✅ 生产部署清单（§4 有逐项验证命令） |
| `docs/superpowers/specs/2026-10-15-decentralized-identity-design.md` | 📝 子项目 A spec：双 subagent 评审（安全+集成）+ 两轮自审，所有 Critical/Important 已修入 spec；**代码未实现** |

### 2.2 锚定实现（全部合入，生产 Turso 已应用迁移）

| 层 | 文件 | 要点 |
| --- | --- | --- |
| 协议 | `packages/protocol/anchor-leaf.mjs` | RFC6962 叶子（0x00 域分隔，只加一次） |
| | `packages/protocol/merkle-tree.mjs` | 预哈希叶子、k-分裂、叶优先包含证明（Python oracle 交叉验证） |
| | `packages/protocol/anchor-manifest.mjs` | 规范 manifest（叶子排序、根复算验证） |
| | `packages/protocol/anchor-witness.mjs` | 见证签名负载（Ed25519，绑定 batchId/root/manifestHash/txRef） |
| 存储 | `drizzle/0046_add_anchor_tables.sql` | 5 张表 + 部分唯一索引（失败批次可重建同 root） |
| | `services/anchoring/d1-anchor-store.mjs` | 原子建批（head-binding CAS 防分叉 + leaf guard）、一次性提交事件、放弃批次三重守卫、`markBatchConfirmed` |
| 编排 | `services/anchoring/anchor-intake.mjs` / `anchor-batch-builder.mjs` / `anchor-manifest-storage.mjs` | 入队→建批→内容寻址存储 |
| | `services/anchoring/anchor-coordinator.mjs` | 触发阈值（N/T/首运行基线）、见证五道闸、确认轮询（**逐提交错误隔离**）、崩溃恢复（fail-closed manifest 重建校验） |
| 链 | `services/anchoring/evm-anchor-adapter.mjs` | 确定性 calldata（4×32B）、ethers 仅动态引入 |
| | `services/anchoring/solana|tron-anchor-adapter.mjs` | 桩（501 语义） |
| 核验 | `services/anchoring/anchor-verifier.mjs` | 7 步核验（含 prevRoot 连续性 XOR 边界；无 adapter → pending 不伪造 verified） |
| 公开面 | `app/api/anchors/*` + `app/lib/anchor-routes.ts` | GET 列表（**分页 limit/offset + status/witnessState 筛选 + total**，witness_state 由 `ANCHOR_WITNESS_THRESHOLD` 派生）/manifest（R2 优先+重建回退）/proof（零外部 RPC）；POST witness（会话+委派+限频，五道闸） |
| 脚本 | `scripts/verify-anchor-proof.mjs` | CLI 核验（退出码 0/1/2/3；`artifact_bundle`↔`evidence_bundle` 类型映射） |
| | `scripts/anchor-tick.mjs` | 单次 tick：resume→build→confirm；`R2_S3_*` 四项齐备时经 **S3 SigV4**（`services/anchoring/anchor-manifest-s3-storage.mjs`）持久化 manifest，否则 volatile 回退 |
| 接线 | `services/receipts/d1-contribution-receipt-coordinator.mjs` | 收据签发成功后 best-effort 入队（try/catch + 结构化审计，**绝不影响签发**） |
| 运维密钥 | `scripts/generate-anchor-operator-jwk.mjs` | secp256k1 运营密钥本地生成（私钥只进 `.env.local` 0600，只打印公开地址） |
| 门禁 | `package.json` | `anchor:check`（16 --check + 16 测试文件）已并入 `check:fast`；`.env.example` 完整变量文档 |

### 2.3 评审遗留工单（4/4 完成）

1. `GET /api/anchors` 分页+筛选（`1d5c7c4`）
2. `ANCHOR_WITNESS_THRESHOLD` 消费 → witness_state 派生（`8ba7912`）
3. `pollConfirmations` 逐提交错误隔离，返回 `errors[]`（`37aed56`）
4. R2 S3 manifest 持久化接线（`5600733`）

## 3. 生产状态

| 项 | 状态 |
| --- | --- |
| 生产 Turso 迁移 `0046` | ✅ 已应用 + `turso:verify`（47 个迁移） |
| 运营密钥（Base Sepolia） | ✅ 生成；地址 `0x3d9fc90f20bf53006487a13e8685f392b3fed88a`；私钥仅在本地 `.env.local` |
| `ANCHOR_ADAPTERS_JSON` | ✅ 已在本地 `.env.local` 拼装好（evm/base-sepolia/阈值 2/私钥 JWK），待复制到托管 secret |
| 适配器 JWK→地址恢复 | ✅ 实测与生成地址一致 |
| tick 全链验证 | ✅ 真实配置+生产控制面跑通（无待锚定记录，未发交易） |
| **站点代码部署** | ❌ 线上仍为 `f9d05ad`（Sites v188）；锚定代码未上线 |
| **注资** | ❌ 余额 0；程序化水龙头不可用（均需人工登录） |
| cron 调度 | ❌ 未配置 |

## 4. 下一位接手者待办（约 10 分钟人工）

1. **注资**：https://www.alchemy.com/faucets/base-sepolia 给上述地址领测试币（核对命令见部署清单 §1）。
2. **部署代码**：在 Sites 后台发布当前分支；确认 `/api/mcp/capabilities` 的 `sourceRevision` 更新、`/api/anchors` 返回 `anchoring_disabled`。
3. **托管环境变量**：粘贴 `.env.local` 中的 `ANCHOR_ADAPTERS_JSON`（secret 通道）。
4. **闭环验证**：`npm run anchor:tick` → 按 `docs/anchor-deployment-2026-10-15.md` §4 逐项验证。
5. 可选：R2 桶 + `R2_S3_*` 四项 + `ANCHOR_MANIFEST_BUCKET` 绑定；cron 触发 tick。

## 5. 子项目 A（已设计，未实现）

按依赖序三阶段：did:web 标识符与文档（含平台根 DID `/.well-known/did.json`）→ 钱包登录（SIWE 链适配层、字节级消息比对、原子 nonce 消费、地址优先解析、`__Host-` cookie + 独立 `WALLET_FLOW_SECRET`）→ VC（收据 VC 服务端签发、**委派 VC 浏览器签发 + 服务端三重写校验防投毒**、信任边界：`trustedIssuerKeys` 必选）。

评审结论：安全视角 2 Critical（VC 写路径投毒、无密钥信任源）+ 7 Important，集成视角 5 Important——**全部已修入 spec**；cryptosuite 诚实命名为 `proofweave-ed25519-2020`（W3C 通用验证器不能直接验，需 Proofweave 验证器）。迁移将新增 0047（wallet auth）/0048（delegation_credentials）。

## 6. 常用命令

```bash
npm run anchor:check          # 锚定全部门禁（71 测试）
npm run check:fast            # 仓库快速门禁（含 anchor:check）
npm run anchor:tick           # 单次 tick（幂等；--local <db> 可本地测）
node scripts/verify-anchor-proof.mjs --type contribution_receipt --record <r.json> [--local <db>]
npm run turso:plan|turso:migrate|turso:verify   # 生产迁移（.env.local 凭据）
node scripts/generate-anchor-operator-jwk.mjs   # 运营密钥（--force 覆盖）
```

## 7. 风险与注意

- **密钥**：运营私钥现仅存本地 `.env.local`（0600）；托管 secret 是其生产存放点，轮换见 `docs/anchor-contract.md`。聊天与 git 历史中无任何私钥。
- **测试网语义**：Base Sepolia 锚定 = 真实链上、测试网信任级；切主网改 network/rpcUrl/换注资地址。
- **git 身份**：本仓库未配置 user.name/email，提交使用自动推断身份（`alexyu@<host>`）；如需真实身份请配置后 amend。
- **主目录 typecheck 噪音**：未跟踪目录 `work/ai-record-release/` 会进 tsc 报错（与本次改动无关，worktree 内验证干净）。
- **诚实边界**：锚定只证明"哈希存在 + 未篡改 + 追加顺序"，不证明数学正确性；A 的 VC 验证需要 Proofweave 验证器。
