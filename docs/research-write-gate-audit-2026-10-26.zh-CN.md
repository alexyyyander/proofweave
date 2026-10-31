# G3 研究写入门禁审计（2026-10-26）

本文是只读审计的整理，不是发布授权。生产研究写入继续保持冻结。

## 结论

**G3 未关闭。** 当前代码有身份绑定、资源归属、配额和幂等检查，但**没有任何 Person/Agent/Attempt 级 allowlist 或 canary**。一旦把 participant 或 MCP surface 切成 `read_write`，任何已登录 Person 都可以写自己的研究数据。发布状态文件也明确记录 `fineGrainedWriteGateVerified: false`（[scripts/check-cloudflare-contribution-release.mjs:31](../scripts/check-cloudflare-contribution-release.mjs:31)）。

## 现有守卫

| 守卫 | 位置 | 行为 |
| --- | --- | --- |
| 全局/表面模式 | [services/database/control-plane-operation-mode.mjs:25](../services/database/control-plane-operation-mode.mjs:25) | 缺失或非法一律映射为 `read_only`；每个 surface 与 global 取 AND。 |
| participant 总闸 | [db/index.ts:54](../db/index.ts:54) | `global && participant` 才返回可写数据库。 |
| MCP 总闸 | [db/index.ts:102](../db/index.ts:102) | `global && mcp`。 |
| connection 表级能力 | [services/database/connection-write-capability.mjs:3](../services/database/connection-write-capability.mjs:3) | 只能写身份/连接相关表，研究表全部拒绝。 |
| 边缘传输闸 | [services/hosting/cloudflare-boundary.mjs:14](../services/hosting/cloudflare-boundary.mjs:14) | `validation` 阶段只放行连接、OAuth 和只读 MCP；研究 POST 一律 503。 |
| participant 归属 | [app/api/me/attempts/route.ts:44](../app/api/me/attempts/route.ts:44) | owner、active Agent、delegation scope、有效期、配额、幂等。 |
| MCP Agent/Attempt 绑定 | [services/proofweave-mcp-gateway/d1-gateway-store.mjs:676](../services/proofweave-mcp-gateway/d1-gateway-store.mjs:676) | installation active、client 匹配、Agent owner/active、delegation scopes、Attempt owner/agent。 |
| 评审独立性 | [services/verification/d1-verification-market-store.mjs:180](../services/verification/d1-verification-market-store.mjs:180) | 不同 Person、review delegation、配额、原子 claim。 |

这些检查能阻止**跨 Person 的越权写**，但不能阻止**非白名单 Person 创建自己的研究记录**。

## 四个必须先处理的缺口

1. **没有研究写 allowlist。** 全仓库搜索 `allowlist|canary` 只命中 OAuth client、Runner 镜像/签名密钥和 workspace dotfile，没有研究写白名单。
2. **边缘层仍是全冻结或全放行。** `PROOFWEAVE_DEPLOYMENT_STAGE=validation` 会拦截研究 POST；改成 `production` 会一次性移除所有 POST 的传输层总闸。不能靠改 stage 来开放研究。
3. **legacy v1 静态 token 绕过 Agent/installation 绑定。** [app/lib/mcp-api.ts:22](../app/lib/mcp-api.ts:22) 只按 Person 认证；[db/repositories/mcp.ts:219](../db/repositories/mcp.ts:219) 的 `createAttempt` 检查 delegation 的 agent 匹配，但不检查 `agents.status/revoked_at`，也不要求 installation。撤销 installation 不会撤销旧静态 token。
4. **存储层不是统一的表级围栏。** 只有 connection 有表白名单；`getD1()` / `getAccountAuthD1()` / `getOAuthD1()` / `getMcpD1()` 在 `read_write` 时都返回原始数据库。研究写入只能依赖 repository 的显式检查，缺少第二道保险。

## 最小实现方案

### 配置

两个独立 env key，分别控制 participant 与 MCP：

```json
PROOFWEAVE_PARTICIPANT_RESEARCH_WRITE_ALLOWLIST_JSON
PROOFWEAVE_MCP_RESEARCH_WRITE_ALLOWLIST_JSON

{
  "schemaVersion": "pw-research-write-allowlist-v1",
  "persons": ["person:<uuid>"],
  "agents": ["urn:pw:agent:<uuid>"],
  "attempts": ["attempt:<uuid>"],
  "allowNewAttempts": false
}
```

- `persons`、`agents` 必填非空；`attempts` 可为空；`allowNewAttempts` 默认 false。
- `allowNewAttempts=true` 时允许创建；调用方已验证归属的 Attempt 可在该创建窗口内写入。关闭后只允许 `attempts` 显式列出的 Attempt；严格窗口按“先创建并捕获 ID，再关闭创建并把 ID 加入 `attempts`”执行。
- 精确匹配内部稳定 ID，不用邮箱、provider subject 或 installation ID。
- 缺失、非法 JSON、错误 schemaVersion、重复或超长 ID 一律 fail closed；不影响 Worker 启动和 account/oauth/connection。
- 每次请求读取 env，不做长期 isolate 缓存，保证回滚即时生效。

### 检查位置

- **主检查放在 repository/store 的实际写方法入口**：participant 的 `db/repositories/mcp.ts`、`problem-proposals.ts`、`research-graph.ts`、`reviews.ts`、`verification-market.ts`；MCP 的 `services/proofweave-mcp-gateway/d1-gateway-store.mjs`。
- 顺序：先 owner/归属检查（避免枚举），再 allowlist，最后写。
- **不要**在共享低层方法里 gate Runner finalizer 等系统动作；只在用户入口 gate。
- 可增加研究表级 `researchWriteCapability(database, context)` 作为第二道防御，但它只做表级隔离，不承担身份判断。
- 路由层可新增 `currentResearchWriteIdentity()` 作为第二道 fail-closed；不要改 `currentDelegationIdentity()`，否则会误伤 GET 读。

### 边缘层

推荐扩展 `cloudflareValidationResponse`：仅当 global + 对应 surface 都为 `read_write` 且 allowlist 有效时，放行明确的 participant 研究路径与 `/api/mcp`；其他未知 POST 继续 503。**不要**为 G3 把整个部署切成 `production`。

### legacy v1

在开放研究写之前，要么把 `/api/v1/mcp/attempts*` 设为 410，要么给静态 token 增加 `agentInstallationId` 绑定并执行与 `requireInstallation` 等价的检查。否则旧 token 是绕过路径。

### 错误映射

- participant：未配置/非法 → 503 `unavailable`；身份/Agent/Attempt 不在白名单 → 403 `forbidden`，不泄露是否存在。
- MCP：工具错误文本带稳定前缀 `research_write_not_allowed:` / `research_write_gate_unconfigured:`；测试和 smoke 必须检查 `result.isError`，不能只看 HTTP 200。
- `/api/mcp/capabilities` 增加 `researchWriteGate` 摘要（配置是否有效、计数、`allowNewAttempts`），不返回具体 ID。

## 开窗顺序

1. 部署 gate + 空 allowlist，participant/MCP 保持 `read_only`；验证 A/B 研究写都 503，connection/account/oauth 正常，数据库计数不变。
2. 设置 participant allowlist：`persons=[A]`、`agents=[A 的 Agent]`、`attempts=[]`、`allowNewAttempts=true`；participant 改 `read_write`，MCP 仍 `read_only`。A 创建一个 Attempt，记录 ID；B 仍被拒绝。
3. 更新 allowlist：`allowNewAttempts=false`、`attempts=[新 Attempt ID]`；验证 A 可写该 Attempt、不能再创建，B 被拒绝。
4. 设置 MCP allowlist 指向同一 Person/Agent/Attempt，MCP 改 `read_write`；验证 progress/checkpoint/artifact/run 可写，B 被工具错误拒绝。
5. 每一步只改一个门禁；回读 capabilities、allowlist 摘要、deploy version、数据库计数和 A/B 响应。
6. 窗口结束：MCP `read_only` → participant `read_only` → 移除边缘研究放行 → 清空 allowlist；保留证据行。

## 回滚

- 最快：把 participant/MCP 恢复为 `read_only`，现有存储围栏立即阻断研究写。
- 第二道：清空 allowlist env；即使误把 surface 设为 `read_write`，gate 仍拒绝。
- 边缘：移除研究路径放行或恢复 `validation`。
- 代码：回退到上一个 Worker 版本；env-only 设计不需要数据库迁移。
- 数据：不删除、不重写已产生的行；connection/account/oauth 保持 `read_write`，登录与 token refresh 不受影响。

## 测试矩阵（摘要）

| 组 | 场景 | 期望 |
| --- | --- | --- |
| 配置 | 缺失/空/非法 JSON/错误 schemaVersion/重复/超长/空 persons | 研究写 503；Worker 与 connection 正常 |
| 配置 | A 允许；A 的 Agent 允许；Attempt 允许 | 通过 |
| 配置 | Agent 不在列表；Attempt 不在列表；`allowNewAttempts=false` | 403 / 工具错误；create 拒绝 |
| participant | A 创建/上报/暂停/恢复；B 同样操作 | A 成功，B 403，数据库只有 A 的行 |
| participant | B 用 A 的 Attempt id | 先触发 owner 检查，返回 404 |
| participant | proposal / research source | A 成功，B 403 |
| participant | submit-review / claim / accept | A 成功，B 403；owner 自领被拒 |
| MCP | A 的 installation 调写工具 | 成功，绑定正确 |
| MCP | B 调写工具 | `result.isError`，稳定前缀，数据库不变 |
| MCP | A 的第二个未列入 Agent | 工具错误 |
| MCP | installation/agent/delegation/signer key 撤销或过期 | 401 或工具错误 |
| legacy v1 | B 的旧 token；A 的已撤销 installation | 必须拒绝；修好前不能开窗 |
| 跨 surface | 同一 idempotency key | 只产生一条记录或 409 |
| 边缘 | `read_write` + 有效 allowlist，但 stage 仍 validation | 未加放行时 503；加放行后 A 201，B 403 |
| 回滚 | 恢复 read_only | 研究写 503，读 200，connection 正常 |
| live | release candidate 上真实 A/B 两 Person | 记录 deploy SHA、allowlist hash、数据库计数、时间窗 |

## 判定

在完成上面的实现，并在 release candidate 上取得真实 A/B 两 Person、真实 Agent/Attempt 的负例证据之前：

- `fineGrainedWriteGateVerified` 必须保持 `false`；
- 生产 participant/MCP 研究写保持冻结；
- 不能把全局 `read_write` 描述为“小范围开放”。

## 本次实现记录（2026-10-26）

已落地的最小切片：

- 新增 [services/database/research-write-allowlist.mjs](../services/database/research-write-allowlist.mjs)：解析、校验、`assertResearchWriteAllowed`、无标识符的 `researchWriteGateSummary`。缺失、非法 JSON、错误 schemaVersion、未知字段、重复或超长条目一律 fail closed。
- 配置键：`PROOFWEAVE_PARTICIPANT_RESEARCH_WRITE_ALLOWLIST_JSON` 与 `PROOFWEAVE_MCP_RESEARCH_WRITE_ALLOWLIST_JSON`，两个 surface 独立。
- 语义：`persons` 与 `agents` 必填非空；`attempts` 在 `allowNewAttempts=false` 时精确匹配；`allowNewAttempts=true` 时，调用方已验证归属的 Attempt 可在创建窗口内写入。关闭窗口后只允许显式列出的 Attempt。
- 接线：participant 的 Attempt、提案、外部来源、评审领取/接受/拒绝、公开评审；MCP gateway 的 Attempt、进度、检查点、工件、Run、评审重放与 Attestation；legacy v1 通过共享 repository gate；边缘层只在 global + surface 均为 `read_write` 且 allowlist 有效时放行明确的研究路径；`/api/mcp/capabilities` 增加无标识符的 gate 摘要。
- 回归测试：allowlist 单元测试、MCP 存储负例、participant 未配置/窗口外负例、边缘路径放行与拒绝、以及原有 rendered/ordinary-user/gateway 套件。

仍未完成：

- 生产窗口没有打开；没有真实 A/B 两 Person 的 live 证据，`fineGrainedWriteGateVerified` 仍为 false。
- legacy v1 静态 token 仍未绑定 installation；allowlist 提供 Agent 维度，但撤销 installation 不会自动撤销旧 token。
- UI 还没有按 gate 状态隐藏写按钮；`/api/mcp/capabilities` 只提供摘要，不提供 per-user eligibility。
- 边缘路径名单需要随新 mutation route 增加而维护；应补一个源码扫描测试。
