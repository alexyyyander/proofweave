# 研究写窗口运维指南（首批外部用户）

状态：工具与操作流程说明。本文不构成生产开放授权；实际开窗仍须按
[G3 研究写入门禁审计](research-write-gate-audit-2026-10-26.zh-CN.md) 和
[研究能力受控开放验收方案](research-reopening-acceptance-2026-10-20.zh-CN.md)
逐项审批、记录证据。

## 1. 工具做什么、不做什么

`scripts/research-window.mjs` 管理一份本地窗口文档（`pw-research-window-document-v1`），
其中 participant 与 mcp 两个 surface 各自独立。它：

- 用运行时的同一个解析器（`researchWriteAllowlistState`）校验文档；
- 增减 Person、Agent、Attempt，切换 `allowNewAttempts`；
- 输出可直接部署的 env 赋值行（`PROOFWEAVE_..._RESEARCH_WRITE_ALLOWLIST_JSON=...`）；
- 每次修改先校验、再写临时文件并原子 rename，失败时原文件不变。

它**不**做以下事情：

- 不部署、不构建、不提交 Git；
- 不修改 `PROOFWEAVE_PARTICIPANT_CONTROL_PLANE_MODE`、`PROOFWEAVE_MCP_CONTROL_PLANE_MODE`
  或 `PROOFWEAVE_DEPLOYMENT_STAGE`；
- 不连接或修改数据库；
- 不验证某个 Person/Agent/Attempt 是否真实存在、是否属于同一所有者（这些仍由服务端归属检查执行）；
- 不 gate 读请求，也不改变 UI。

窗口是 env-only 的：有效部署版本就是审计记录；清空 env 后门禁立即 fail closed，不需要数据库迁移。
工具原子写出的窗口文件权限为 `0600`，真实 ID 只应保存在这类仓库外的工作文件中。

## 2. 前提

- 已部署带 Person/Agent/Attempt allowlist 门禁的 release candidate；
- 当前 `PROOFWEAVE_DEPLOYMENT_STAGE=validation`；
- `PROOFWEAVE_CONTROL_PLANE_MODE=read_write`，但
  `PROOFWEAVE_PARTICIPANT_CONTROL_PLANE_MODE=read_only`、
  `PROOFWEAVE_MCP_CONTROL_PLANE_MODE=read_only`；
- account/oauth/connection surface 保持 `read_write`，登录与 Agent 连接不受研究冻结影响；
- 已确定研究 Person A、独立评审 Person B、窗口时间、部署版本记录人和回滚执行人；
- 已按审计要求处理 legacy v1 静态 token：在开放 MCP 写之前，`/api/v1/mcp/attempts*`
  必须停用或完成 installation 绑定，否则旧 token 是绕过路径。

工作目录建议放在仓库之外，例如 `~/proofweave-window/`。真实 Person/Agent/Attempt ID
不得写入仓库、文档示例、issue、聊天记录或提交信息。

## 3. 窗口文档格式

示例文件：`config/research-write-window.example.json`（占位符，不可直接部署）。

```json
{
  "schemaVersion": "pw-research-window-document-v1",
  "participant": {
    "persons": ["person:<uuid>"],
    "agents": ["urn:pw:agent:<uuid>"],
    "attempts": ["attempt:<uuid>"],
    "allowNewAttempts": false
  },
  "mcp": {
    "persons": ["person:<uuid>"],
    "agents": ["urn:pw:agent:<uuid>"],
    "attempts": ["attempt:<uuid>"],
    "allowNewAttempts": false
  }
}
```

字段语义：

- `schemaVersion` 必须精确为 `pw-research-window-document-v1`。
- `participant` 与 `mcp` 完全独立；一个 surface 的 env 不会影响另一个。
- 每个 surface 的 `persons`、`agents` 必填非空；`attempts` 可以为空；
  `allowNewAttempts` 必须是布尔值。
- ID 使用内部稳定 ID：`person:<uuid>`、`urn:pw:agent:<uuid>`、`attempt:<uuid>`。
  不要使用邮箱、provider subject、installation ID、Agent label 或显示名。
- 每个维度最多 100 条，单条 ID 最多 240 字符，同一列表内不得重复。
- participant/mcp 任一 surface 无效时，该 surface 的研究写 fail closed（HTTP 503；
  请求到达运行时门禁时为 `unavailable`，`validation` stage 下可能先被边缘以
  `deployment_read_only` 拒绝）；不影响 account/oauth/connection，也不影响另一个 surface。
- `allowNewAttempts=true` 时，允许白名单 Person + Agent 创建新 Attempt，并且其已通过服务端
  归属检查的 Attempt 可在创建窗口内写入；关闭后只允许 `attempts` 显式列出的 Attempt。

导出格式（每个 surface 一行）：

```text
PROOFWEAVE_PARTICIPANT_RESEARCH_WRITE_ALLOWLIST_JSON={"schemaVersion":"pw-research-write-allowlist-v1","persons":[...],"agents":[...],"attempts":[...],"allowNewAttempts":false}
```

等号右侧是部署时使用的字面 JSON 值。导出内容只包含该 allowlist 键，不包含其他秘密；
但它包含真实 ID，应按个人数据保管。

## 4. 首批外部用户 provisioning 流程

以下步骤一次只打开一个门禁，每一步都回读证据。命令假定窗口文件为
`~/proofweave-window/window.json`。

### 步骤 0：准备本地窗口文件

```sh
mkdir -p ~/proofweave-window
chmod 700 ~/proofweave-window
cp config/research-write-window.example.json ~/proofweave-window/window.json
chmod 600 ~/proofweave-window/window.json
npm run research:window -- show --file ~/proofweave-window/window.json
```

预期：`valid: true`，两个 surface 各 `personCount: 1`、`agentCount: 1`、
`attemptCount: 1`，`allowNewAttempts: false`。这一步的计数来自示例占位符。

### 步骤 1：连接 Agent，捕获 Person/Agent ID

1. Person A 通过正式登录流程连接一个 research Agent（OAuth installation）。
2. 用 A 的已登录会话读取 `GET /api/me/delegation`，记录：
   - `profile.person.id`（Person ID）
   - `profile.agents[]` 中 `status: "active"` 且用于本次连接的 `.id`（Agent URN）
   - `profile.agentInstallations[]` 中 `status: "active"` 的安装记录（仅用于核对连接状态，
     不加入 allowlist）
3. Person B 独立连接自己的 Agent，记录 B 的 Person/Agent ID，用于负例验证。不要把 B 加入窗口。

`/api/me/delegation` 走 connection surface，研究写冻结期间仍可用。不要在命令行历史、
终端回放或日志里留下会话 cookie。

### 步骤 2：把 A 加入窗口，移除示例占位符

先添加真实 ID，再删除占位符；工具拒绝把 `persons`/`agents` 删空。

```sh
npm run research:window -- add-person --file ~/proofweave-window/window.json \
  --surface both --id 'person:<A-person-uuid>'
npm run research:window -- add-agent --file ~/proofweave-window/window.json \
  --surface both --id 'urn:pw:agent:<A-agent-uuid>'
npm run research:window -- remove-person --file ~/proofweave-window/window.json \
  --surface both --id 'person:<uuid>'
npm run research:window -- remove-agent --file ~/proofweave-window/window.json \
  --surface both --id 'urn:pw:agent:<uuid>'
npm run research:window -- remove-attempt --file ~/proofweave-window/window.json \
  --surface both --id 'attempt:<uuid>'
npm run research:window -- set-new-attempts --file ~/proofweave-window/window.json \
  --surface both --allow true
npm run research:window -- show --file ~/proofweave-window/window.json
```

预期：每个 surface `persons`/`agents` 各 1 条真实 ID，`attempts` 为 0，
`allowNewAttempts: true`。此时 B 不在任何列表中。

### 步骤 3：导出并部署 participant allowlist（surface 仍为 read_only）

```sh
node scripts/research-window.mjs export --file ~/proofweave-window/window.json \
  --surface participant
```

检查输出：只有一个 `PROOFWEAVE_PARTICIPANT_RESEARCH_WRITE_ALLOWLIST_JSON=` 行，
JSON 可解析，且**没有** placeholder 警告。把该键写入 Worker 环境变量并发布新版本；
不要写进已提交的 `wrangler.cloudflare.jsonc`，也不要把真实 ID 提交到 Git。

当前仓库的 Cloudflare/Wrangler 流程可参考（按你们审计过的部署方式调整）：

```sh
value="$(node scripts/research-window.mjs export --file ~/proofweave-window/window.json \
  --surface participant | sed 's/^[^=]*=//')"
NODE_OPTIONS=--dns-result-order=ipv4first WRANGLER_SEND_METRICS=false \
  node node_modules/wrangler/bin/wrangler.js deploy --config dist/server/wrangler.json \
  --var "PROOFWEAVE_PARTICIPANT_RESEARCH_WRITE_ALLOWLIST_JSON:${value}"
```

此时 participant/MCP 仍为 `read_only`，边缘层继续拦截研究 POST。

### 步骤 4：回读 capabilities

```sh
curl -s https://proofweave.org/api/mcp/capabilities | jq '.researchWriteGate'
```

预期 participant：

```json
{
  "surface": "participant",
  "configured": true,
  "valid": true,
  "failureCode": null,
  "personCount": 1,
  "agentCount": 1,
  "attemptCount": 0,
  "allowNewAttempts": true
}
```

MCP 此时应为 `configured: false`、`failureCode: "missing"`。同时检查
`participantOperations.mode`、`mcpOperations.mode`、`globalControlPlaneOperations.mode`
仍为预期值。capabilities 只返回聚合计数，不返回具体 ID。

### 步骤 5：单独打开 participant surface

这是本工具之外的部署变更：把 `PROOFWEAVE_PARTICIPANT_CONTROL_PLANE_MODE` 改为
`read_write`，发布新版本；MCP 保持 `read_only`，`PROOFWEAVE_DEPLOYMENT_STAGE` 保持
`validation`。然后验证：

- A 的研究写请求成功（先以创建 Attempt 为验证动作）；
- B 对同一路径的研究写返回 HTTP 403 `forbidden`，且错误文本不泄露白名单内容；
- 未登录请求返回 401/403；
- 登录、Agent 连接、token refresh、只读页面仍正常；
- 数据库只出现 A 的记录（不直接改库，只读计数）。

此阶段 MCP 写仍被冻结；A 的 MCP 写工具若被调用，应返回工具错误而非成功。

### 步骤 6：A 创建 Attempt，记录 ID，收紧为显式 Attempt

1. A 通过 participant `POST /api/me/attempts`（请求体包含 `problemSlug`、
   `delegationCertificateId`、`delegationScope`）创建一个 Attempt。此时 MCP 仍为
   `read_only`，不能通过 MCP 创建；MCP 的 `create_attempt` 只在 MCP surface 打开后可用。
2. 从响应中记录 `attempt.id`。也可在 participant 写窗口仍打开时用
   `GET /api/me/attempts` 回读；participant 恢复 `read_only` 后该接口会返回 503。
3. 收紧窗口：

```sh
npm run research:window -- add-attempt --file ~/proofweave-window/window.json \
  --surface both --id 'attempt:<A-attempt-uuid>'
npm run research:window -- set-new-attempts --file ~/proofweave-window/window.json \
  --surface both --allow false
npm run research:window -- show --file ~/proofweave-window/window.json
```

4. 重新导出 participant allowlist，发布新版本，回读 capabilities：
   `attemptCount: 1`、`allowNewAttempts: false`。
5. 验证：
   - A 可继续写该 Attempt；
   - A 再创建新 Attempt 返回 403 `forbidden`（`new_attempts_disabled`）；
   - B 任何研究写仍为 403；
   - B 使用 A 的 Attempt ID 时先触发归属检查，返回 404 而不是泄露白名单。

### 步骤 7：打开 MCP surface

前提：legacy v1 静态 token 已停用或完成 installation 绑定；participant 已收紧为显式 Attempt。

```sh
node scripts/research-window.mjs export --file ~/proofweave-window/window.json \
  --surface mcp
```

把 MCP 键写入 Worker 环境变量并发布；然后把
`PROOFWEAVE_MCP_CONTROL_PLANE_MODE` 改为 `read_write`，再次发布。回读：

```sh
curl -s https://proofweave.org/api/mcp/capabilities | jq '{gate: .researchWriteGate.mcp, mcp: .mcpOperations}'
```

预期 `configured: true`、`valid: true`、`personCount: 1`、`agentCount: 1`、
`attemptCount: 1`、`allowNewAttempts: false`、`mcpOperations.writesEnabled: true`。

验证 A 的 MCP 写工具（progress、checkpoint、artifact、Run）成功且绑定到同一
Person/Agent/Attempt；B 的写工具必须返回 HTTP 200 但 `result.isError: true`，
错误文本以 `research_write_not_allowed:` 开头。不要只看 HTTP 状态码。

### 步骤 8：关闭窗口

按“先 MCP、后 participant、再清 env”的顺序：

1. `PROOFWEAVE_MCP_CONTROL_PLANE_MODE=read_only`，发布并回读；
2. `PROOFWEAVE_PARTICIPANT_CONTROL_PLANE_MODE=read_only`，发布并回读；
3. 从部署配置中移除 `PROOFWEAVE_MCP_RESEARCH_WRITE_ALLOWLIST_JSON` 和
   `PROOFWEAVE_PARTICIPANT_RESEARCH_WRITE_ALLOWLIST_JSON`，发布并回读
   `configured: false`、`failureCode: "missing"`；
4. 保持 `PROOFWEAVE_DEPLOYMENT_STAGE=validation`，不要为了开关窗口把整个部署切到
   `production`；
5. 保留已产生的研究行、评审、Bundle、Run 和负例证据；不删除、不重写；
6. 本地窗口文件按证据保留或归档（若保留，保持 `0600`）。

## 5. 命令参考

通过 npm 执行时，`--` 之后的参数才会传给工具：

| 命令 | 作用 |
| --- | --- |
| `npm run research:window -- show --file <path>` | 校验并输出两个 surface 的非标识摘要 |
| `npm run research:window -- add-person --file <path> --surface participant\|mcp\|both --id person:<uuid>` | 添加 Person；重复添加为幂等 no-op |
| `npm run research:window -- remove-person ...` | 删除 Person；不存在或删除最后一个 Person 时报错且不写文件 |
| `npm run research:window -- add-agent\|remove-agent ... --id urn:pw:agent:<uuid>` | Agent 操作，规则同上 |
| `npm run research:window -- add-attempt\|remove-attempt ... --id attempt:<uuid>` | Attempt 操作；Attempt 列表可删空 |
| `npm run research:window -- set-new-attempts --file <path> --surface ... --allow true\|false` | 切换创建窗口 |
| `npm run research:window -- export --file <path> --surface participant\|mcp\|both` | 输出一个或两个 env 赋值行 |

也可以直接运行 `node scripts/research-window.mjs <command> ...`。需要机器解析输出时使用
`npm run --silent research:window -- ...` 或直接调用 node，避免 npm 的脚本横幅混入 stdout。

退出码：`0` 成功（包括幂等 no-op）；`1` 校验/文件/写入错误；`2` 命令行用法错误。
所有修改都是“先校验、后原子写”；错误时文件字节不变，目录中不会留下 `.tmp` 文件。

`show` 输出示例：

```json
{
  "file": "/Users/operator/proofweave-window/window.json",
  "schemaVersion": "pw-research-window-document-v1",
  "valid": true,
  "failureCode": null,
  "surfaces": {
    "participant": {
      "schemaVersion": "pw-research-write-allowlist-v1",
      "surface": "participant",
      "configured": true,
      "valid": true,
      "failureCode": null,
      "personCount": 1,
      "agentCount": 1,
      "attemptCount": 1,
      "allowNewAttempts": false
    },
    "mcp": { "...": "同结构" }
  }
}
```

## 6. 常见错误

| 现象 | 含义与处理 |
| --- | --- |
| `window document not found` | 路径错误；先执行步骤 0。 |
| `invalid_json` | 文件不是合法 JSON；工具不会写入。从备份/上一版本恢复；不要手工修补后直接部署。 |
| `invalid_schema_version` | `schemaVersion` 不是 `pw-research-window-document-v1`。 |
| `invalid_participant` / `invalid_mcp` + `invalid_persons` / `invalid_agents` | 列表为空、重复、超过 100 条、含空字符串或超长 ID。注意每个 surface 独立。 |
| `unknown_field` | 顶层或 surface 内出现未知字段；删除拼写错误字段。 |
| `invalid_allow_new_attempts` | `allowNewAttempts` 不是布尔值。 |
| `not found in participant` / `not found in participant and mcp` | 删除不存在的 ID；ID 精确匹配、区分大小写。`both` 操作要求两个 surface 都存在，否则整体不写。 |
| `refusing to remove the last person/agent from ...` | 不能把某个 surface 的 persons/agents 删空；先添加替补，再删除。 |
| `... id must start with person:` / `urn:pw:agent:` / `attempt:` | ID 维度或前缀错误；不要使用邮箱、subject 或 installation ID。 |
| `--surface must be participant, mcp, or both` | surface 参数错误。 |
| `missing required option --id` | 通过 npm 运行时漏了参数或漏了 `--`。 |
| export 出现 placeholder 警告 | 仍在使用示例占位符；不要部署该值。 |
| capabilities `configured: false` / `failureCode: "missing"` | env 键未写入、写到了错误的 Worker、部署未生效或键名拼写错误。 |
| capabilities `valid: false` 及具体 `failureCode` | 部署的 env 值被运行时解析器拒绝；用 `export` 重新生成并部署。 |
| A 仍收到 503 `deployment_read_only` | 边缘/stage 未放行：检查 `PROOFWEAVE_DEPLOYMENT_STAGE`、global 与对应 surface 是否为 `read_write`、allowlist 是否 valid。 |
| A 收到 503 `unavailable` | 请求已到达运行时门禁，但该 surface 的 allowlist 缺失或无效（fail closed）；回读 capabilities。 |
| B 收到 403 `forbidden` | 预期的窗口外拒绝。participant 的 403 不泄露白名单内容。 |
| B 的 MCP 工具 HTTP 200 | 必须检查 `result.isError` 与 `research_write_not_allowed:` 前缀，HTTP 200 不是成功。 |

## 7. 回滚

按优先级：

1. **最快**：把 `PROOFWEAVE_MCP_CONTROL_PLANE_MODE` 与
   `PROOFWEAVE_PARTICIPANT_CONTROL_PLANE_MODE` 恢复为 `read_only` 并发布。存储层围栏立即
   阻断研究写；读请求、登录和 Agent 连接保持可用。
2. **第二道**：清空两个 allowlist env 键并发布。即使误把某个 surface 设成 `read_write`，
   门禁仍会 fail closed：`validation` stage 下边缘先返回 503 `deployment_read_only`；
   若请求已到达运行时，则返回 503 `unavailable`。
3. **边缘**：保持或恢复 `PROOFWEAVE_DEPLOYMENT_STAGE=validation`；不要依赖
   “切到 production 再切回”来开关研究写。
4. **代码**：如需回退 Worker 版本，必须同时保持两个研究 surface 为 `read_only`。
   旧版本可能没有 allowlist 门禁；在旧版本上误开 `read_write` 会移除细粒度限制。
5. **数据**：不删除、不重写已产生的研究行、评审、Bundle、Run、Receipt；不重建数据库。

env-only 窗口的局限：

- 变更只有在部署/传播完成后才生效；部署版本本身是审计记录，回滚也是新的部署动作。
- 运行时每次请求读取 env，但边缘与 Worker 的版本切换仍有传播窗口；不要把“已保存文件”
  当成“已生效”。
- 没有 per-user eligibility 端点；capabilities 只给聚合计数，必须用真实 B 做负例验证。
- legacy v1 静态 token 尚未绑定 installation；撤销 installation 不会自动撤销旧 token。
- 边缘研究路径名单需要随新增 mutation route 维护；UI 尚未按 gate 状态隐藏写按钮。
- 窗口只限制“哪些 Person/Agent/Attempt 可以写”，不替代所有者、Agent 状态、delegation
  scope、配额和幂等检查。
- `allowNewAttempts=true` 是创建窗口，范围比显式 Attempt 宽；应尽快收紧。
- 清空 env 后研究写返回 503（`validation` stage 的边缘为 `deployment_read_only`，
  运行时门禁为 `unavailable`），不是 403；这是 fail-closed 设计。

## 8. 窗口记录模板

每次开窗保留以下非秘密记录（ID 可只记录 SHA-256 或后四位）：

- 研究 Person A/B、Agent URN、Attempt ID，以及 A/B 所有者不同的证明；
- 窗口开始/结束时间、操作人、部署版本与 deploy SHA；
- 两个 surface 的模式、allowlist 摘要（计数、`allowNewAttempts`）和 env 值 SHA-256；
- capabilities 回读、A 成功、B 403/工具错误、数据库只读计数、回滚回读。

计算 allowlist 值哈希（不把值本身写入记录）：

```sh
node scripts/research-window.mjs export --file ~/proofweave-window/window.json \
  --surface participant | cut -d= -f2- | shasum -a 256
```

真实 ID 和 `export` 输出按个人数据管理：不进入 Git、issue、PR、聊天或长期日志。
