# 外部用户就绪度审计（2026-10-27）

本文整理只读审计的结论，供后续开发直接使用。它不是发布授权。

> 2026-10-27 更新：4.27 镜像已用 Node 22.23.4 安全重建，当前登记 digest 为 `sha256:3a7e335f…`（run `40469297704`，commit `c3461cf…`）；下文早期记录的 `sha256:373c7ee…` 已被取代。

## 总判断

**外部读者今天可用；外部贡献者今天不可用。**

非白名单用户可以登录、连接 Agent，但第一次创建 Attempt 会被 403。白名单用户可以创建 Attempt，但 Runner 暂停/环境错配、评审受同一 allowlist 限制、工件约 1MB、没有评审 SLA，四道门使它无法走到 Contribution Receipt。

## 当前事实

- 线上源码 `3e330c6`，participant 与 MCP 写入均为 `read_write`，gate 为 2 Person / 2 Agent / 4 Attempt / `allowNewAttempts=true`。
- 线上 `/api/me/research-eligibility`、`/reviewers`、`/support` 在本次开发前均为 404；本批工作树已加入。
- Runner `/healthz` 可达但 `state=paused`、`executionEnabled=false`，sandbox 与 template 仍为 4.31；目录 38/38 目标是 4.27。
- 4.27 镜像已构建（`sha256:373c7ee…`），但没有 E2B template，Worker/Render 未批准，不可执行。
- 线上 review board 有 5 个 open job（100-credit pool，`odd-sum-square`），但评审 claim 仍被 research allowlist 限制，只有 2 Person 在窗口内。
- 出版目录 719 manuscripts / 372 families；8 条 claims、3 份 explanation draft、0 份 reviewed explanation。

## P0（外部贡献者可用的硬前提）

### P0.1 至少一个目标在批准 Runner 中真实跑通

验收：

- `config/runner-environments.json` 的 4.27 从 `built_pending_template` 变为可执行；checker 输出 E2B template/build/digest/workflow run 并 exit 0。
- Worker 与 Render 批准列表同时包含 4.27 + 4.31；Render 执行镜像切到 4.27；`executionEnabled=false` 直到单 Run。
- 单 Run（`RUNNER_ONLY_RUN_ID`）返回 `succeeded`、`kernelStatus=accepted`、四项检查通过、签名与输出 hash 可回验。
- 目标页显示 “Executable in approved Runner”；未覆盖环境的目标禁用 Run，并在准备 Bundle 前提示。

### P0.2 per-user eligibility、申请、撤销与统一禁用态

验收：

- 部署 `/api/me/research-eligibility`；非白名单返回 `canCreateAttempt=false`、`canWrite=false`、稳定原因；不含 ID；未登录 401。
- Workbench、目标页、`/propose`、`/reviews`、`/evidence`、`/integrations` 在动作前显示资格；非白名单看不到可点击的研究写按钮。
- 直接写入仍 403/503，且不泄露白名单。
- “Request access” 产生可追踪状态（pending/approved/rejected）；operator 有通知/队列；approve 后 UI 启用；revoke/expire 后立即关闭。
- Operator CLI 可添加/移除/到期/撤销，并记录操作人、时间、部署 SHA、窗口摘要。
- 覆盖 A allowed / B denied（participant + MCP）、创建窗口、Attempt 未列出、撤销、UI 禁用态、申请状态机；至少一次 live A/B 负例。

### P0.3 解耦并补齐评审供给

验收：

- 明确 review eligibility 与 research write window 的关系；当前 `/reviewers` 已改为“受同一窗口限制，独立 review window 是后续工作”。
- 外部 Person B 可以 claim、accept、打开 evidence、请求 replay、提交 signed attestation，不被 `review:claim` / `review:transition` / `attestation:write` 的窗口阻断。
- `/reviewers` 上线；至少 3 位独立评审者完成 onboarding；一个 active pool、至少 5 个 open job；作者看到 assignment age/SLA。
- 评审通知、到期提醒、>50 job 分页、并发 claim 负例。
- 一次真实 Person A → Person B → signed review → Receipt 的 live 记录。

### P0.4 消除 Runner / 评审 / Attempt 的 stuck limbo

验收：

- 状态 API/UI 暴露 runner reachability、executionEnabled、template/env 状态；paused/unreachable 时不再显示 “Bundle safely queued”。
- queued/preparing 超时阈值后显示最后状态、原因、下一步；允许 cancel/retry；`wake_failed` / `wake_unconfirmed` 可见。
- Review assignment 与 active Attempt 有 age/SLA/expiry 或 escalation。
- 测试模拟 paused、health timeout、queued timeout、cancel/retry。

### P0.5 大工件与 1MB 上限的可解释路径

验收：

- 生产绑定 `ARTIFACT_BUCKET`，部署 hybrid store；>1MB 且 ≤32MB 的对象可 stage、回读、hash 一致；旧 inline 对象仍可读。
- 若暂不绑定 R2：插件在本地测量 archive/patch/lake-manifest，超出时返回精确字节数与修复建议，不等 `put_artifact_object` 泛化报错。
- Runner 输出 >1MB 走 R2 或明确 `output_too_large`。
- `RUNNER_DEFAULT_LIMITS_JSON.outputBytes` 与 store ceiling 一致；checker 检测不一致。

### P0.6 外部注册所需的法律/支持最小集

验收：

- Footer 有 Privacy / Terms / Support / Issue / Security；导航同时可达 `/privacy`、`/terms`、`/support`；登录页显示 Terms/Privacy 同意提示。
- Terms 增加公开贡献许可、删除后公开记录处理、滥用/下架、年龄、支持渠道；Privacy 增加保留期限、删除/导出、处理器清单、联系渠道。
- 有可监控的 support/abuse/security 入口，并明确无 SLA。
- 一次外部用户可用 1 页回答“数据在哪、怎么删、找谁”。

## P1（第一次贡献之后）

1. 用户可见配额与成本面板：active attempts/12、active reviews/8、run requests、bundle bytes、last failure/retry。
2. 50+ claim cards / reviewed explanations；目标页“证了什么/没证什么/下一步”。
3. 评审运营：通知、48h 首响 SLA、到期提醒、opt-in reviewer pool、20 条 calibration set。
4. 支持/状态/滥用/账户删除导出；status page。
5. 中文阅读路径、375px 移动端首跑、axe/pa11y 与键盘 only 测试。
6. 发布状态单一真相：release docs、capabilities、wrangler/Render env 一致。

## P2（生态与长期）

- 评审声誉与结算（非现金）。
- 非 Codex MCP 客户端首次贡献。
- 公开指标与成本透明。
- 自助提案到目录。
- 法律扩展（管辖、DPA、cookie/tracking、无障碍声明）。
- Sybil/重复/图分裂审计。

## 本批已处理

- `/reviewers` 的“review eligibility 独立于 write window”错误文案已修正。
- Footer/导航/登录页加入 Privacy、Terms、Support、Issue、Security 入口；新增 `/support` 页。
- Terms/Privacy 补充公开贡献许可、删除/导出、处理器、保留期限、支持/安全渠道。
- 混合 D1/R2 工件存储代码与测试、Runner 环境登记/checker、窗口 CLI、外部用户计划均已落地（工作树，未部署）。

## 仍需注意的不一致

- `docs/releases/2026-10-20-release-state.json` 仍写 research 写入关闭，线上已开放；`docs/ordinary-user-readiness.md` 说 Google 未配置，线上已可用。发布状态需要单一真相。
- `docs/credit-market-v1.md` 说首个 pool 是 draft/未 active，线上已有 active pool 与 5 个 job。
- render.yaml 的 template/sites 版本已按线上回读修正，但实际 Render env 仍以控制台为准。

## 本批验证结果（2026-10-27）

- `npm run external:check`：44/44 通过（eligibility 19、window CLI 13、runner environment 11、hybrid artifact 1）。
- `npm run external:surfaces:check`：1/1 通过（未登录 401、允许/拒绝 Person 的 eligibility、Workbench 提示、/support、/terms、/privacy、/reviewers、Footer 链接）。
- `tests/rendered-html.test.mjs`：38/38；`tests/ordinary-user-journey.test.mjs`：14/14；gateway store：13/13。
- `npm test`：通过（含 build、渲染、外部用户 surface、ordinary journey、publication 测试）。
- `npm run cloudflare:check`：通过（构建 + 真实 Worker journey）。
- 源码 typecheck 0 错误；scoped ESLint 0 错误；UI check 7/7。

仍未解决的产品决策：

- **评审窗口是否独立**：当前 review claim/accept/attestation 仍受 research allowlist 限制；`/reviewers` 已如实说明。若要外部评审者独立参与，需要新增 review window（persons/agents 与可评审 Attempt 范围）或明确把 reviewer 加入 research allowlist。
- **R2 工件 binding**：hybrid 代码已就绪，但生产没有 `ARTIFACT_BUCKET`；绑定后旧 inline 对象可读、>1MB 对象走 R2。
- **4.27 执行**：镜像 digest 已有，缺 E2B template、Render env 切换和单 Run 验收。
