# 链上锚定部署清单（2026-10-15）

本文是子项目 B（防篡改锚定）上生产的操作清单。生产 Turso 已应用迁移 `0046`（2026-10-15，`turso:verify` 通过）。剩余步骤按顺序执行。

## 1. 注资运营地址（人工，约 2 分钟）

运营地址：`0x3d9fc90f20bf53006487a13e8685f392b3fed88a`（私钥在本地 `.env.local` 的 `ANCHOR_OPERATOR_PRIVATE_KEY_JWK`，已验证可被适配器恢复出该地址）。

水龙头（均需人工登录，任选其一）：

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
| 其余既有变量 | 不变 | `TURSO_*`、`OAUTH_*` 等照旧 |

sink 地址当前为 `0x…dEaD`（纯 calldata 备忘录锚定，资金进入死地址的交易照常携带 calldata；每笔 gas 极低）。若后续部署事件注册合约，改 `sinkAddress` 即可。

## 4. 部署后验证（按序）

```bash
# ① 公开接口从 disabled 变为可用空列表
curl -s https://proofweave.org/api/anchors
# ② 生产控制面挂上收据（任意一次收据签发后）→ 本地触发一轮 tick
npm run anchor:tick
# ③ 批次出现：root/txRef 可见；随后 pollConfirmations 确认（阈值 2 个区块）
curl -s https://proofweave.org/api/anchors | jq '.batches[0]'
# ④ 链上独立核对 txRef 的 calldata（与批次 root/manifestHash 一致）
# ⑤ CLI 全链核验（对已锚定收据）
node scripts/verify-anchor-proof.mjs --type contribution_receipt --record <receipt.json>
```

## 5. 可选：R2 manifest 持久化 + cron

- R2 桶 → 取 S3 凭据（Access Key/Secret）→ 托管环境配 `R2_S3_ENDPOINT`、`R2_MANIFEST_S3_BUCKET`、`R2_S3_ACCESS_KEY_ID`、`R2_S3_SECRET_ACCESS_KEY`（tick 侧）+ Workers 侧 `ANCHOR_MANIFEST_BUCKET` 绑定。
- cron：任意调度器按间隔执行 `npm run anchor:tick`（幂等、单次语义；GitHub Actions scheduled workflow 或系统 crontab 均可）。

## 6. 已知边界

- Base Sepolia 是测试网——锚定提供的是"真实链上、测试网信任级"的存证；切主网只改 `network`/`rpcUrl`/换注资地址。
- 运营密钥当前仅存本地 `.env.local`；Sites 托管 secret 是其生产存放点，轮换见 `docs/anchor-contract.md`。
