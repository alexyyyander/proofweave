# 链上锚定部署清单（2026-10-15）

**2026-10-16 运维更新**：用户已明确要求停止自动任务，`proofweave-nile` 当前为 PAUSED；下文 2026-10-15 的“已启用”仅为验收历史。生产锚定改用显式手工触发，不自动恢复调度。线上最后已验收版本为 v193 / `6780e404`，工作分支正在整理为独立提交；后续修复未发布前，不应视为线上已生效。


**当前状态（2026-10-15 22:07 CST）**：已部署 Sites v193（`6780e404`，环境 revision 52），生产账本已到 0047。Nile 的真实公开检查点已完成入队→R2→广播→固化→独立验证；交易 [2513e836…734fe5689](https://nile.tronscan.org/#/transaction/2513e836ec425171a5013de7fddde39cc7179db4029ad5fa5e402be734fe5689)，区块 71847049，核验时 135 确认。公开 [manifest](https://proofweave.org/api/anchors/anchor-batch:ceaa9f2b-a45d-4933-9c4b-79b26954f7b9) 实际从 R2 读取，无私钥 CLI verified，重复 tick 不新建批次。Codex heartbeat `proofweave-nile` 已启用，每 15 分钟调用 hosted tick，依赖本机及 Codex 可运行。完整本机证据：`outputs/anchor-production-closure-20261015/report.json`。

§1–§7 保留此前 Base Sepolia 操作与隔离测试历史，不是当前生产待办；当前生产使用 §8 的 hosted Nile 路径，不要把旧 `.env.local` EVM 配置覆盖到线上。


本文是子项目 B（防篡改锚定）上生产的操作清单。生产 Turso 已应用迁移 `0046`（2026-10-15，`turso:verify` 通过）。剩余步骤按顺序执行。

上述生产信息为交接时的记录，不能代替当前环境验收。后续本地修复补充了链上确认与完整载荷核验、manifest 哈希重算、确认投影恢复、R2 上传失败检查和 tick 部分失败报告。TRON Nile 公共测试网已取得真实交易与独立核验结果（见 §7）；仍需部署修复后的代码并验收生产业务流程。

## 1. 注资运营地址（人工，约 2 分钟）

运营地址：`0x3d9fc90f20bf53006487a13e8685f392b3fed88a`（私钥在本地 `.env.local` 的 `ANCHOR_OPERATOR_PRIVATE_KEY_JWK`，已验证可被适配器恢复出该地址）。

Base Sepolia 水龙头候选（可用性需实际核对；本次 Alchemy / QuickNode 均因主网余额门槛拒绝）：

- Coinbase Developer Platform：https://portal.cdp.coinbase.com/products/faucet （选 Base Sepolia）
- Alchemy：https://www.alchemy.com/faucets/base-sepolia
- QuickNode：https://faucet.quicknode.com/base/sepolia

领取后用以下命令核对余额：

```bash
curl -s -X POST https://sepolia.base.org -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["0x3d9fc90f20bf53006487a13e8685f392b3fed88a","latest"]}'
# result 非 "0x0" 即到账；测试网 ETH 够支付数百笔锚定交易
```

## 2. 部署新代码到 Sites

生产当前源码版本 `f9d05ad`（Sites v188），需部署包含锚定实现的分支（本地 `codex/public-research-aggregation` @ 合并后 HEAD）。部署方式按既有 Sites 流程执行；部署完成后确认：

- `/api/mcp/capabilities` 的 `sourceRevision` 更新为新提交；
- `GET /api/anchors` 返回 `{"status":"anchoring_disabled","batches":[]}`（尚未配置适配器时的正确状态）。

## 3. 配置托管环境变量（Sites 后台，值来自本地 `.env.local`）

| 变量 | 值来源 | 说明 |
| --- | --- | --- |
| `ANCHOR_ADAPTERS_JSON` | `.env.local` 已拼装好（含私钥 JWK） | **含密钥，走 secret**。配置：`evm` / `base-sepolia` / `https://sepolia.base.org` / sink `0x…dEaD` / 确认阈值 2 |
| `ANCHOR_CONFIRMATION_THRESHOLD` | 测试网验收按批准策略设置，例如 `2` | coordinator 与核验 CLI 共用，默认 `12`。必须同时满足它与适配器内部阈值；只修改适配器 JSON 不会把全流程阈值降为 2。 |
| 其余既有变量 | 不变 | `TURSO_*`、`OAUTH_*` 等照旧 |

sink 地址当前为 `0x…dEaD`（纯 calldata 备忘录锚定，资金进入死地址的交易照常携带 calldata；每笔 gas 极低）。若后续部署事件注册合约，改 `sinkAddress` 即可。

## 4. 部署后验证（按序）

```bash
# ① 公开接口从 disabled 变为可用空列表
curl -s https://proofweave.org/api/anchors
# ② 生产控制面挂上收据（任意一次收据签发后）→ 本地触发一轮 tick
npm run anchor:tick
# 等待确认阈值后再次执行 tick；首次提交时通常尚未达到阈值。
# 输出 partial_failure 或退出码 2 时，检查 errors[] / failedBatches，不能视为验收成功。
# ③ 批次出现：root/txRef 可见；随后 pollConfirmations 确认（阈值 2 个区块）
curl -s https://proofweave.org/api/anchors | jq '.batches[0]'
# ④ 链上独立核对 txRef 的 calldata（与批次 root/manifestHash 一致）
# ⑤ CLI 全链核验（对已锚定收据）
node scripts/verify-anchor-proof.mjs --type contribution_receipt --record <receipt.json>
```

## 5. 可选：R2 manifest 持久化 + cron

- R2 桶 → 取 S3 凭据（Access Key/Secret）→ 托管环境配 `R2_S3_ENDPOINT`、`R2_MANIFEST_S3_BUCKET`、`R2_S3_ACCESS_KEY_ID`、`R2_S3_SECRET_ACCESS_KEY`（tick 侧）+ Workers 侧 `ANCHOR_MANIFEST_BUCKET` 绑定。
- cron：任意调度器按间隔执行 `npm run anchor:tick`（幂等、单次语义；GitHub Actions scheduled workflow 或系统 crontab 均可）。
- tick 退出码：`0` 为成功、未启用或可重试的建批冲突；`1` 为配置/IO 等错误；`2` 为确认轮询部分失败。调度器应保留 JSON 输出并对非零退出码告警。
- 已确认提交的批次状态或见证计数写入中断后，下次 tick 会重新查找未完成投影并修复，无需重发交易或重写确认事件。
- R2 PUT 的非 2xx 响应会阻止该批次继续上链；恢复存储后可重跑 tick。配置缺失时仍使用原有内存存储回退，不能据此宣称 R2 已持久化。
- SigV4 的规范路径与实际请求路径使用相同 URI 编码（如 `sha256:` 的冒号编码为 `%3A`）；本地门禁独立校验 PUT/GET 签名，但仍需部署后验证真实 R2 凭据与权限。
- 单批容量为 96 条，保留整批原子事务；默认 100 条触发后，余量等待后续数量或时间触发。
- `reason: awaiting_predecessor` 表示前驱尚未确认，tick 仍会轮询确认。若前驱交易已失败，运营者核查后按锚定契约调用 `abandonBatch` 放弃末端批次，再重跑 tick；不会自动删除或改写旧批次。
- 只读核验配置可以去掉 `operatorPrivateKeyJwk` 和 `sinkAddress`，保留公开 RPC、网络与确认阈值。CLI 仍需要本地锚定数据库快照或相应数据库读权限；这不是仅凭公开 URL 的完整离线核验工具。

## 6. 已知边界

- Base Sepolia 是测试网——锚定提供的是"真实链上、测试网信任级"的存证；切主网只改 `network`/`rpcUrl`/换注资地址。
- 运营密钥当前仅存本地 `.env.local`；Sites 托管 secret 是其生产存放点，轮换见 `docs/anchor-contract.md`。

## 7. TRON Nile 替代路径（已完成公共测试网技术闭环）

2026-10-15 20:23 CST 验收：水龙头 https://nileex.io/join/getJoinPage 发放 1000 测试 TRX；交易 [4593d8e…268b2220](https://nile.tronscan.org/#/transaction/4593d8e16057e5f099627e4111f5594c7e3482a273923acaf8e7f4ec268b2220) 已固化，无私钥 CLI 返回 `verified` / 退出码 0。测试使用隔离 libSQL、合成工程样本和本地文件 manifest；不代表 R2、线上部署或研究证明正确性已经验收。

公开核验配置如下；签名进程另外从 secret 提供 `operatorPrivateKeyJwk`。Nile 测试私钥在本机 `outputs/anchor-tron-closure-20261015/operator.private.jwk`（0600，忽略提交），与 Base Sepolia 密钥独立。不要公开或连同报告打包该私钥。

```json
[{"id":"tron","network":"nile","rpcUrl":"https://nile.trongrid.io","sinkAddress":"T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb","operatorAddress":"TNQnA4PbQNBixU7LWt48Vmr1wzFsJdxDZn","confirmationThreshold":12}]
```

TRON 每笔发送 1 SUN，并消耗 bandwidth / memo 费用。本次手续费为 1 TRX。确认必须来自 `/walletsolidity` 的成功交易与收据，同时满足深度阈值；仅能在 FullNode 查到交易不算完成。

本次没有修改 `.env.local` 的默认 EVM 配置。tick 使用配置数组的第一个适配器；生产控制面的日志已有批次时，不应直接切换其规范网络。测试中使用单独数据库、仅含 Nile 的适配器配置。上线时仍按 §2–§5 完成部署、secret 配置与生产验收。

## 8. Hosted Nile 生产路径（已部署验收）

发布基线更新为 Sites v192 的 `acc9b1c`；在独立目录保留线上阅读页与既有功能，追加本地锚定实现。迁移 `0047_add_anchor_tick_lease.sql` 新增共享调度锁，未修改既有迁移。Drizzle 旧 journal 仅覆盖早期迁移，沿用仓库 SQL 文件与 `_proofweave_migrations` 账本，避免重写已应用的历史。

`POST /api/internal/anchors/tick` 使用 `ANCHOR_TICK_TOKEN` secret，必须提供 R2 绑定 `ANCHOR_MANIFEST_BUCKET`，不允许降级到内存。每次最多补入各类型 24 份公开证据；收据必须为 research/public，检查点所属项目必须公开，bundle 必须被公开证据引用。检查点重新验证签名与哈希。tick 共享数据库租约，并在广播前续租。

线上只配置 Nile；运营私钥通过 Sites secret 注入，不更改本地 `.env.local` 的旧 EVM 值。生产调度请调用 hosted tick，不要直接运行仍读取旧 EVM 环境的 `npm run anchor:tick`。

本机调用命令：

```bash
node scripts/run-hosted-anchor-tick.mjs --credentials outputs/anchor-production-closure-20261015/tick-credentials.json
```

凭据文件权限 0600、忽略提交。已启用 Codex heartbeat 每 15 分钟调用，依赖本机和 Codex 可运行，不等同于全天候云 cron。公开 manifest 响应头 `x-anchor-manifest-source: bucket` 用于验证 R2 读取路径。链上记录证明内容绑定与存在性，不证明数学正确性，也不构成独立见证。

异常边界：网络广播成功但本地提交投影写入失败，仍须先核查链上交易再决定恢复操作；租约防止并发调用，不提供跨链广播与数据库提交的原子性。


## 9. 0048 outbox 修复上线前检查（本次未部署）

本地新增 `0048_add_anchor_submission_outbox.sql`。发布前必须停止所有旧版本 tick 入口并等待在途请求结束，再应用迁移、部署新代码，最后手工验证；不要只停定时任务而继续允许旧 worker 被手工调用。迁移会将既有 built 批次标记为 legacy_unknown，防止历史广播状态不明时重新签名。已 submitted/confirmed 批次仍按原投影读取与确认。

新路径：manifest → 签名交易持久化 → 查询/广播同一交易 → 写入 submitted → 确认。落库或响应中断不生成新 txRef。遇到过期 TRON 或未知旧批次，返回失败并等待运营核查；不能通过删除 outbox、换 nonce 或重签名自动绕过。新迁移尚未应用到生产，线上仍是此前验收的 v193。

自动任务 `proofweave-nile` 已按用户要求暂停，后续发布也不应自动恢复。人工验收与是否需要持续调度是两个独立事项。

本地验收：`anchor:check` 115/115，`portable:database:check` 22/22，修改文件 ESLint、隔离源码 typecheck 与构建通过。故障测试覆盖写入前失败、写入后响应丢失、广播响应丢失、广播后投影失败、投影提交后响应丢失、进程重启、并发写入、旧批次迁移隔离、TRON 过期和 EVM nonce 冲突。未用生产凭据或发送新的链上交易。
