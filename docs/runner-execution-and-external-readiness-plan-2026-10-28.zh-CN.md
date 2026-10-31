# Runner 执行与外部用户落地计划（2026-10-28）

本文把“让一次真实研究闭环跑起来，再扩大到外部用户”拆成可执行阶段。它不是发布授权；Runner 执行、E2B/Render 变更、生产写入范围和链上交易仍需各自批准。

## 0. 当前基线

- `main` = `544dfac`；线上部署源码与该提交一致。
- 线上 participant 与 MCP 均为 `read_write`，gate 对 2 Person / 2 Agent / 4 Attempt 有效，`allowNewAttempts=true`。
- Runner 可达但 `state=paused`、`executionEnabled=false`；sandbox 仍是 4.31 `sha256:ca896ab…`。
- 4.27 镜像已构建：`sha256:3a7e335f…`（Node 22.23.4 安全重建，run `40469297704`，commit `c3461cf…`），但 **没有 E2B template**。
- 4.35 只有 build profile 与根 `lean-toolchain`，没有构建镜像。
- `ARTIFACT_BUCKET` 未绑定，工件仍走 1MB 内联路径。
- 评审 claim/accept/attestation 仍受同一 research allowlist 限制。
- `codex/public-research-aggregation` 与 main 因 squash 显示 1/69 分叉；**新工作从 main 开分支，不要继续用旧分支**。

## 1. 目标

先取得一次可公开回验的闭环：

```text
Person A 固定目标
  → 有界 Attempt
  → owner 批准的 Bundle
  → 4.27 隔离 Runner 接受
  → Person B 独立评审
  → Contribution Receipt
```

闭环完成前，不邀请外部用户；完成后才扩大到 3–5 位设计伙伴。

## 2. 阶段与验收

### P0 发布与凭据准备（0.5–1 天）

- 从 `origin/main` 开新分支（例如 `codex/runner-4.27-execution-20261028`），不要基于旧分支。
- 确认以下凭据/权限，缺一项就开始不了：
  - `E2B_API_KEY`：构建 4.27 template。
  - Render 控制台/API：更新 `PROOFWEAVE_E2B_RUNNER_IMAGE`、`RUNNER_APPROVED_IMAGES_JSON`、template/build ID，并重启 Runner。
  - GHCR `read:packages` 或 Docker login：独立回读 4.27 manifest digest 与 SBOM/provenance。
  - Cloudflare wrangler：部署 Worker 批准列表。
- 记录当前 Runner 回读：revision、paused、sandbox digest、template ID、approved images。
- 决定首个案例的 Person A、目标 revision、Bundle 来源，以及 Person B（不同 owner）。

**验收**：凭据清单全部可用；新分支从 main 建立；首案和 A/B 角色写入记录。

### P1 4.27 E2B template（0.5–1 天）

- 使用当前 4.27 digest：`ghcr.io/alexyyyander/proofweave-lean-runner@sha256:3a7e335f…`。
- 通过 `npm run runner:e2b:template:build` 从该 digest 构建 template；记录 immutable template ID 与 build ID。
- 回读确认 template 的来源镜像就是 4.27 digest；保留 SBOM、provenance、离线 smoke 结果。
- 回读 workflow 产出的 `runner-image-evidence/conformance.json`；把 `fixtureSetHash`、`reportHash`、`state: "passed"` 写入 4.27 环境的 `conformance` 块。
- 如果本机磁盘不足（约 6 GiB），在有足够磁盘/凭据的环境构建，不要跳过检查。

**验收**：template ID/build ID 已记录；来源 digest 可核对；4.27 conformance 报告通过并绑定当前 fixture set；4.27 environment 在 registry 中从 `built_pending_template` 变为 `template_ready`。

### P2 Worker 与 Render 批准（0.5 天）

- 详细部署清单见 [`runner-p2-deployment-runbook.zh-CN.md`](runner-p2-deployment-runbook.zh-CN.md)；0050 迁移已应用，template/Render 仍受凭据阻塞。
- 先应用迁移 `0050_add_runner_queue_environment.sql`（Turso 控制面）；Runner 启动会校验 migration ledger，未应用会 fail closed。
- 扩展 `config/runner-environments.json`：允许 `template_ready` 状态，登记 template ID/build ID（schema v2，已由 checker 校验）。
- 用 `scripts/generate-runner-environment-config.mjs` 从登记表生成 Worker/Render env 值，不手工复制 digest/template ID：
  `node scripts/generate-runner-environment-config.mjs --execution-profile mathlib-4.27-a3a10 --surface render`。
- **每环境一个 Runner + 队列路由**：每个 trusted Runner 仍只服务一个 E2B template/镜像，但部署可以同时包含多个 Runner；队列消息携带从签名 request 派生的 `runner_environment_key`，每个 Runner 只 claim 自己的环境。
  - Worker `RUNNER_APPROVED_IMAGES_JSON` = 4.27 + 4.31（前提是两个环境都有对应 Runner）：
    `node scripts/generate-runner-environment-config.mjs --profile mathlib-4.31-9a948 --profile mathlib-4.27-a3a10 --surface worker`；
  - Worker `RUNNER_EXECUTION_ENVIRONMENTS_JSON` = 4.31（`executionEnabled:false`）+ 4.27（`executionEnabled:false`）。它驱动 capabilities、目标页状态和分发前的 typed error；未声明的环境会以 `runner_environment_unavailable` 拒绝；
  - 新增一个 4.27 Render 服务，`RUNNER_APPROVED_IMAGES_JSON` = 4.27 单镜像；
  - 现有 4.31 Render 服务保持 `RUNNER_APPROVED_IMAGES_JSON` = 4.31 单镜像；
  - 不要在一个 Runner 里放两个镜像：它仍会启动失败；多环境必须通过多个 Runner + 队列路由实现。
- 4.27 Render env：
  - `PROOFWEAVE_E2B_RUNNER_IMAGE` = 4.27 digest
  - `RUNNER_APPROVED_IMAGES_JSON` = 4.27
  - `PROOFWEAVE_E2B_TEMPLATE_ID` / `PROOFWEAVE_E2B_TEMPLATE_BUILD_ID` = 新 template
  - `RUNNER_EXECUTION_ENABLED=false`（先 preflight）
- 4.31 Runner 可保持原状态；Worker 同时分发两个环境，队列按环境路由，不再有 4.27 Run 被 4.31 Runner 领取后 dead-letter 的问题。
- 配置 Worker `RUNNER_WAKE_ROUTES_JSON`，把两个 Lean 环境映射到各自的 `/v1/wake` 与 token；未配置时只有单一 `RUNNER_WAKE_URL`，另一个 Runner 仍能通过轮询取到任务，但唤醒延迟更高。
- `/api/mcp/capabilities` 与各 Runner `/healthz` 回读一致。

**验收**：两个 Runner 的 `runnerPolicy.sandboxImageDigest` 分别为 4.27 / 4.31；4.27 `executionEnabled=false`；Worker 批准列表包含两个环境；`check-runner-environments.mjs --strict --render deploy/huggingface-runner/render.yaml`（两个 service 在同一文件）退出 0，`runners=2`、`dispatchable=2`、`routed=2`、`selected=2`，4.27 为 `executing=0`。

### P3 单 Run 受控验收（1 天）

- Person A 用固定 4.27 目标创建有界 Attempt，准备并 stage 一个真实 Bundle（不是 fixture）。
- 只对 4.27 Runner 配置：
  - `RUNNER_ONLY_RUN_ID=<run>`
  - `RUNNER_MAX_DELIVERY_ATTEMPTS=1`
- Worker 的 `RUNNER_EXECUTION_ENVIRONMENTS_JSON` 把 4.27 的 `executionEnabled` 设为 `true`（4.31 保持 `false`）；4.27 Runner 只消费指定 Run，其他 4.27 请求会排队但不会被消费。
- 临时启用 4.27 Runner 的消费者，发送一次 wake；4.31 Runner 不受影响，不开放普通队列。
- 队列按 `runner_environment_key` 路由，4.27 Run 只会被 4.27 Runner claim；4.31 Runner 不会领取它。
- checker 只有在 `RUNNER_EXECUTION_ENABLED=true` 与 `RUNNER_ONLY_RUN_ID` 同时存在时，才允许 `template_ready` 环境执行；缺少任一条件时 `--strict` 会拒绝。
- 验证：
  - 工作区哈希、工具链 4.27、Mathlib `a3a10db…`；
  - Lean accepted；`noSorry`、allowed axioms、lean build 四项检查；
  - 结果签名、输出哈希、acknowledged 终态；
  - 签名结果中的 `environment` 块包含 4.27 image digest 与 E2B template ID/build；
  - 没有其他 Run 被消费。
- 无论结果如何，立即把 4.27 Runner 恢复为 `executionEnabled=false` 并回读暂停状态。
- Run 通过后把 4.27 从 `template_ready` 晋升为 `approved`，移除 `RUNNER_ONLY_RUN_ID`；Worker 声明保持 4.27 `executionEnabled:true`，再回读 4.27 的 `executing=1`。

**验收**：唯一 Run 的真实终态与无凭据证据；不声称数学正确性、独立评审或 Receipt。

### P4 独立评审与 Receipt（1–2 天）

- Person B（不同 owner）连接 review-scoped Agent。
- 当前 review 动作受 research allowlist 限制；首案采用**受控方式**：把 B 的 Person、Agent 和该 author Attempt 临时加入 allowlist，完成评审后再移除。长期方案见 P5。
- B 领取 accepted assignment，执行全新 replay，签署 claim-specific attestation。
- 收据协调器在全部必需声明满足后签发 Receipt；公开入口回验签名、哈希、依赖与所有权分离。
- Receipt 的 `run.environment` 必须与 Bundle 的 Lean/Mathlib pin 一致，并保留 image digest 与 E2B template ID/build；不一致时拒绝签发。

**验收**：一次真实 Person A → Person B → Receipt 的 live 记录；不在评审过程中使用同一 Person 的两个 Agent。

### P5 外部用户前的能力补齐（2–4 周）

1. **独立 review window**：不要让外部评审者依赖 research allowlist；新增 review 专用窗口（persons/agents + 可评审 Attempt 范围），或明确把 reviewer 加入 allowlist 的运营流程。
2. **R2 工件绑定**：创建 `proofweave-artifacts` bucket，绑定 `ARTIFACT_BUCKET`，部署 hybrid store；验证旧 inline 对象可读、>1MB 新对象走 R2。
3. **stuck/limbo**：Runner 健康状态 API/UI；queued/preparing 超时、浏览器 cancel、wake_failed 可见。
4. **配额与成本**：用户可见 active attempts/12、reviews/8、run requests、bundle bytes；Runner 单次预算。
5. **内容覆盖**：50 个 claim cards / reviewed explanations；目标页“证了什么/没证什么/下一步”。
6. **外部 onboarding**：窗口 CLI、申请状态、支持/法律入口（已上线）与首个外部 cohort 的 runbook。

**验收**：3 位外部评审者可 claim/attest；R2 大工件可用；非白名单用户 UI 不显示可写按钮；至少 1 个外部用户完成一次有界贡献。

### P6 扩大到 10 位外部用户（4–8 周）

- 3 位设计伙伴 → 5 位外部用户，分批开放 allowlist。
- 每批记录：time-to-first-write、review latency、Runner cost、失败原因、reuse rate。
- 任何一批出现越权、stuck 或收据错误，立即收紧窗口并停止扩量。

## 3. 发布与开关纪律

- 每个阶段只改一个门禁；改完回读 capabilities、healthz、deploy version、allowlist 摘要。
- 生产写入窗口保持窄；Runner 执行只在单 Run 窗口临时开启。
- 所有生产变更从 main-based 已提交源码构建，记录 sourceRevision；不在旧分支上部署。
- 回滚优先级：暂停 execution → 恢复 participant/MCP read_only → 回滚 Worker 版本；不重建或回退 Turso。
- 不删除证据、不重写账本、不用直接 SQL 修饰终态。

## 4. 关键阻塞与责任

| 阻塞 | 需要谁 | 解除条件 |
| --- | --- | --- |
| E2B template | 持有 `E2B_API_KEY` 的操作者 | 4.27 template + immutable build ID |
| Render 切换 | Render 控制台/API 权限 | 执行镜像、批准列表、template ID 更新并可回读 |
| GHCR 独立核验 | `read:packages` 或 Docker login | 4.27 manifest、SBOM、provenance 可回读 |
| Person A Bundle | 有本地 Codex Agent 的账号 | 真实的 4.27 目标 Bundle |
| Person B | 不同 owner 的评审账号 | review delegation + signed attestation |
| 评审窗口 | 产品/代码 | review 与 research allowlist 解耦 |

## 5. 指标

- 首次可验证贡献时间（注册 → Receipt）。
- Runner 单次成本、排队/执行时延、失败率。
- 评审首响/完成时延、评审者数量。
- 复用率：引用前序节点的 Attempt 占比。
- 非白名单用户触发 403 的次数（UI 应趋近 0）。
- 外部用户 30/90 天留存与第二次贡献率。

## 6. 下一步（立即）

1. 确认 E2B/Render/GHCR 权限与 Person A/B。
2. 从 `origin/main` 开新分支并登记首案。
3. 构建 4.27 E2B template，回读 template/digest。
4. 更新 Worker/Render 批准列表（execution 仍 false）。
5. 执行单 Run 验收，再进入评审与 Receipt。
