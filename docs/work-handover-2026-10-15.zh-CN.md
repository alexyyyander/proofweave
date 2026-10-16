# 工作交接说明：链上锚定交付 + Web3 路线推进

**2026-10-16 运维更新**：用户已明确要求停止自动任务，`proofweave-nile` 当前为 PAUSED；下文 2026-10-15 的“已启用”仅为验收历史。生产锚定改用显式手工触发，不自动恢复调度。线上最后已验收版本为 v193 / `6780e404`，工作分支正在整理为独立提交；后续修复未发布前，不应视为线上已生效。


**当前验收状态（2026-10-15 22:07 CST）**：B 的生产业务闭环已完成。Sites **v193** / `6780e404accfad3e5e2c635bac71d7eab69e7ce9` 已部署；生产 Turso 迁移账本已到 `0047`；既有公开检查点入队后，经 R2 持久化、Nile 广播与固化确认，无私钥 CLI 返回 `verified`。实际交易见 [2513e836…734fe5689](https://nile.tronscan.org/#/transaction/2513e836ec425171a5013de7fddde39cc7179db4029ad5fa5e402be734fe5689)，核验时 135 确认，区块 71847049。公开批次只有 1 个、叶子只有 1 条，重复 tick 无新增交易；2 份内部 smoke-test 收据被排除。

[公开 manifest](https://proofweave.org/api/anchors/anchor-batch:ceaa9f2b-a45d-4933-9c4b-79b26954f7b9) 的响应头 `x-anchor-manifest-source: bucket` 已实测；本机证据 `outputs/anchor-production-closure-20261015/report.json`。99 项锚定测试、9 项收据存储测试、范围 typecheck、构建通过。Codex heartbeat `proofweave-nile` 每 15 分钟执行；依赖本机及 Codex 可运行，尚非全天候云 cron。Nile 为测试网，witnessCount=0，锚定不证明数学正确性。

以下复审与早期测试记录按时间保留；当前生产状态以 §3 为准。

日期：2026-10-15（Asia/Shanghai）
范围：`801abc4`（本会话起点）→ `bd00b18`（HEAD），39 个提交，53 文件，+8536 行
分支：`codex/public-research-aggregation`（未推远端）
交付时测试记录：`npm run anchor:check` 71/71；`check:fast` 全链、lint/typecheck 通过（原隔离工作区记录，非当前主目录的重新验证）。

**后续复审修复（本地，尚未提交或部署）**：已补齐独立链上确认、完整 calldata 与 manifest 哈希核验、确认投影中断恢复、R2 PUT 状态检查，以及 tick 的 `errors[]` / `partial_failure` / 退出码 2。新增 10 项回归测试后，`anchor:check` 为 **81/81**；修改文件 lint 通过；使用临时配置排除 `work/` 与 `outputs/` 后 typecheck 通过。当前不应以测试通过代替真实链上验收；检查点和证据包仍未接入自动入队，生产状态表仍为原交接快照。

**第二轮修复（同样仅本地）**：单批限制 96 条以满足 libSQL 的 100 语句事务上限；前驱未确认时，coordinator 与建批事务均拒绝追加后继，失败末端可经运营者核查后放弃并重建；SigV4 路径统一编码，测试服务器独立验证签名；EVM 只读核验无需私钥，交易提交仍要求签名密钥。门禁现为 **88/88**，包含新增真实 libSQL 回归测试；本轮修改文件 lint 和上述范围的 typecheck 通过。已有旧日志的非末端失败批次不自动改写，真实 R2 和链上交易仍需部署后验收。

**闭环实测补充（2026-10-15 19:17 CST）**：已在隔离 libSQL、文件 manifest 存储和 Ganache 7.9.2 本地 EVM（chain ID 1337）上完成 3 条工程测试记录、2 个串联批次的入队→落盘→签名广播→确认→核验。两笔交易读取时分别有 26/13 个确认；重开数据库后核验通过；独立 CLI 在无私钥、无 `.env.local` 的进程中返回 `verified` / 退出码 0。篡改记录、错误 calldata 与确认数不足均未误报成功。样本为合成 artifact bundle，未执行 Lean，不是正式研究记录。证据在本机 `outputs/anchor-closure-20261015/evm-1792063049453/report.json`；复跑脚本为同目录上一级的 `run-local.mjs --evm`（依赖临时目录中的 Ganache）。`outputs/` 不入 Git，需交接时单独保留。Base Sepolia 仍未完成：19:10 CST RPC 确认 chain ID 84532、运营余额 0；Alchemy 和 QuickNode 的实际请求均因主网余额条件被拒，Ethereum Ecosystem 页面显示部署暂停。本地 R2 S3 四项凭据缺失。本次未部署、未改生产数据库、未广播公共测试网交易。

**TRON Nile 公共测试网闭环（2026-10-15 20:23 CST）**：Nile 水龙头向独立运营地址 `TNQnA4PbQNBixU7LWt48Vmr1wzFsJdxDZn` 发放 1000 测试 TRX。已实现 TRON memo 适配器，并接入 tick、核验 CLI 与站点适配器注册。隔离数据库中的 2 条合成工程样本已锚定到 [Nile 交易 4593d8e…268b2220](https://nile.tronscan.org/#/transaction/4593d8e16057e5f099627e4111f5594c7e3482a273923acaf8e7f4ec268b2220)；固化后核验时有 34 个确认，无私钥 CLI 返回 `verified` / 退出码 0。手续费 1 TRX，转账额 1 SUN，余额 998.999999 TRX。证据位于本机 `outputs/anchor-tron-closure-20261015/report.json`，该目录的 `operator.private.jwk` 为权限 0600 的独立测试密钥，不入 Git；不得作为公开报告附件。manifest 使用本地文件持久化，未配置 R2、未改生产数据库、未部署或切换生产网络。新增 8 项适配器测试后门禁 **96/96**；相关文件 lint、排除 `work/` / `outputs/` 的 typecheck、完整构建均通过。公共测试网技术闭环已完成，生产业务闭环仍待部署验收。

## 1. 一句话概述

完成 Web3 路线三个子项目中 **B（防篡改锚定）的核心实现与生产站点到 Nile 测试网的业务闭环**（设计→计划→实现→生产迁移记录），**A（去中心化身份+VC）完成双评审设计**，并处理了锚定的 4 个评审遗留工单。B 已接通公开检查点、公开收据和其引用 bundle 的有界补偿入队；持续调度当前依赖本机。

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
| | `services/anchoring/tron-anchor-adapter.mjs` | 1 SUN 转账 memo 承载四字段；本地签名、已固化交易核验、只读适配器；Nile 已实测 |
| | `services/anchoring/solana-anchor-adapter.mjs` | 未实现占位适配器 |
| 核验 | `services/anchoring/anchor-verifier.mjs` | 7 步核验（含 prevRoot 连续性 XOR 边界；无 adapter → pending 不伪造 verified） |
| 公开面 | `app/api/anchors/*` + `app/lib/anchor-routes.ts` | GET 列表（**分页 limit/offset + status/witnessState 筛选 + total**，witness_state 由 `ANCHOR_WITNESS_THRESHOLD` 派生）/manifest（R2 优先+重建回退）/proof（零外部 RPC）；POST witness（会话+委派+限频，五道闸） |
| 脚本 | `scripts/verify-anchor-proof.mjs` | CLI 核验（退出码 0/1/2/3；`artifact_bundle`↔`evidence_bundle` 类型映射） |
| | `scripts/anchor-tick.mjs` | 单次 tick：resume→build→confirm；`R2_S3_*` 四项齐备时经 **S3 SigV4**（`services/anchoring/anchor-manifest-s3-storage.mjs`）持久化 manifest，否则 volatile 回退 |
| 接线 | `services/receipts/d1-contribution-receipt-coordinator.mjs` | 收据签发成功后 best-effort 入队（try/catch + 结构化审计，**绝不影响签发**） |
| 运维密钥 | `scripts/generate-anchor-operator-jwk.mjs` | secp256k1 运营密钥本地生成（私钥只进 `.env.local` 0600，只打印公开地址） |
| 门禁 | `package.json` | TRON 接入后 `anchor:check`（18 --check + 18 测试文件，96 项测试）已并入 `check:fast`；`.env.example` 完整变量文档 |

### 2.3 评审遗留工单（4/4 完成）

1. `GET /api/anchors` 分页+筛选（`1d5c7c4`）
2. `ANCHOR_WITNESS_THRESHOLD` 消费 → witness_state 派生（`8ba7912`）
3. `pollConfirmations` 逐提交错误隔离，返回 `errors[]`（`37aed56`）
4. R2 S3 manifest 持久化接线（`5600733`）

## 3. 生产状态

| 项 | 状态 |
| --- | --- |
| Turso 迁移 | ✅ 0046 + 0047，后者为共享 tick 租约；已读取生产账本确认 |
| 站点部署 | ✅ Sites v193，源码 `6780e404`，环境 revision 52；保留 v192 线上功能 |
| Nile 运营密钥 | ✅ 独立地址 `TNQnA4PbQNBixU7LWt48Vmr1wzFsJdxDZn`；签名配置存 Sites secret，本机私钥文件权限 0600 |
| 测试币 | ✅ Nile 水龙头已领取；首笔生产锚定成功 |
| 记录入队 | ✅ 公开检查点、research/public 收据及被公开证据引用的 bundle；排除内部 smoke tests 和未公开 staged bundle |
| R2 | ✅ `ANCHOR_MANIFEST_BUCKET` 已绑定，公开 manifest 从 bucket 实际读取 |
| 交易与投影 | ✅ 1 批次 / 1 叶子，Nile 固化且生产批次 confirmed，无私钥 CLI verified |
| 鉴权与重复调用 | ✅ 未授权 401；重复 tick 无新增批次，共享租约防并发 |
| 周期调度 | 已按用户要求暂停（2026-10-16）；当前手工触发 |
| 独立见证 | 未提供；witnessCount=0，不标为 witnessed |

## 4. 接手者操作

1. 保留忽略提交的 `outputs/anchor-production-closure-20261015/` 中的验收材料与 0600 调度凭据；私钥另存于 `outputs/anchor-tron-closure-20261015/operator.private.jwk`，不得随公开报告分发。
2. 手工触发：`node scripts/run-hosted-anchor-tick.mjs --credentials outputs/anchor-production-closure-20261015/tick-credentials.json`。不要直接用仍含 Base Sepolia 默认值的 `.env.local` 运行生产 Node tick。
3. 查看 `/api/anchors` 和 manifest；独立核验使用仅含公开地址/RPC 的 Nile 配置。需要本机休眠后仍持续运行时，再接入独立云调度器。
4. 广播成功与数据库写入之间发生中断时，先核查链上交易再恢复；租约不能提供跨链与数据库的原子事务。

## 5. 子项目 A（已设计，未实现）

按依赖序三阶段：did:web 标识符与文档（含平台根 DID `/.well-known/did.json`）→ 钱包登录（SIWE 链适配层、字节级消息比对、原子 nonce 消费、地址优先解析、`__Host-` cookie + 独立 `WALLET_FLOW_SECRET`）→ VC（收据 VC 服务端签发、**委派 VC 浏览器签发 + 服务端三重写校验防投毒**、信任边界：`trustedIssuerKeys` 必选）。

评审结论：安全视角 2 Critical（VC 写路径投毒、无密钥信任源）+ 7 Important，集成视角 5 Important——**全部已修入 spec**；cryptosuite 诚实命名为 `proofweave-ed25519-2020`（W3C 通用验证器不能直接验，需 Proofweave 验证器）。迁移编号需顺延：0047 已用于 anchor tick lease，A 的 wallet auth / delegation_credentials 应在实施时占用下一组未使用编号。

## 6. 常用命令

```bash
npm run anchor:check          # 锚定全部门禁（当前 99 测试）
npm run check:fast            # 仓库快速门禁（含 anchor:check）
npm run anchor:tick           # 单次 tick（幂等；--local <db> 可本地测）
node scripts/verify-anchor-proof.mjs --type contribution_receipt --record <r.json> [--local <db>]
npm run turso:plan|turso:migrate|turso:verify   # 生产迁移（.env.local 凭据）
node scripts/generate-anchor-operator-jwk.mjs   # 运营密钥（--force 覆盖）
```

## 7. 风险与注意

- **密钥**：Nile 运营私钥本地位于 `outputs/anchor-tron-closure-20261015/operator.private.jwk`（0600），线上位于 Sites secret；旧 Base Sepolia 配置仍在 `.env.local`。凭据不得进入 Git 或公开验收材料。
- **测试网语义**：当前已验收链为 TRON Nile；主网切换需单独核对网络、费用、密钥、恢复策略及运维条件。
- **git 身份**：本仓库未配置 user.name/email，提交使用自动推断身份（`alexyu@<host>`）；如需真实身份请配置后 amend。
- **主目录 typecheck 噪音**：未跟踪目录 `work/ai-record-release/` 会进 tsc 报错（与本次改动无关，worktree 内验证干净）。
- **诚实边界**：锚定只证明"哈希存在 + 未篡改 + 追加顺序"，不证明数学正确性；A 的 VC 验证需要 Proofweave 验证器。
