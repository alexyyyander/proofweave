# Runner P2 部署窗口 runbook（2026-10-31）

本文是 4.27 Runner 与 4.31 Runner 并行的受控部署清单。它不替代发布批准；每一步都要回读，失败就停在当前状态。

## 0. 当前事实

- 生产 Turso 控制面已应用 `0050_add_runner_queue_environment.sql`：51 migrations，latest `0050_add_runner_queue_environment.sql`，database fingerprint `3f9e7934a04a22ec`。
- `runner_queue_messages` 共 36 行，全部已回填 `runner_environment_key`：
  - 29 `acknowledged`、4 `cancelled`、3 `dead_letter`；
  - **没有 queued / leased** 的旧消息，不会在 P2 打开时被新 Runner 意外消费。
- 线上 Worker 仍是旧版本：`/api/mcp/capabilities` 没有 `runnerEnvironments`；`proofweave.org/healthz` 返回 404（该路由本来就不存在），capabilities 200 且 release diagnostics ready。
- Render Runner `https://proofweave-trusted-runner.onrender.com/healthz` 当前超时；P2 前必须先恢复 4.31 Runner 的可达性。
- 本机没有 `E2B_API_KEY`、Render API 凭据、GHCR read token；可用磁盘约 1.4 GiB。4.27 template 构建被凭据阻塞。

## 1. 凭据与入口检查

需要以下任一操作者能力；缺一项就停：

| 能力 | 用途 |
| --- | --- |
| `E2B_API_KEY` | 从 4.27 digest 构建 template |
| Render 控制台/API | 更新/新增两个 Runner 服务与 wake token |
| GHCR `read:packages` 或 Docker login | 独立回读 4.27 manifest、SBOM、provenance |
| Cloudflare wrangler | 部署 Worker 的批准列表和执行声明 |
| Turso（已完成） | 0050 迁移 |

```bash
node scripts/manage-turso-control-plane.mjs verify
# 期望：51 migrations, latest 0050_add_runner_queue_environment.sql
```

## 2. 构建 4.27 E2B template

使用当前登记 digest：

```text
ghcr.io/alexyyyander/proofweave-lean-runner@sha256:3a7e335f2f1acae3296f7e0c5933e5b160ccdc37fe4e363c2c81aa73118f86b0
```

```bash
export E2B_API_KEY='<operator secret>'
export PROOFWEAVE_E2B_RUNNER_IMAGE='ghcr.io/alexyyyander/proofweave-lean-runner@sha256:3a7e335f2f1acae3296f7e0c5933e5b160ccdc37fe4e363c2c81aa73118f86b0'
export PROOFWEAVE_E2B_TEMPLATE_NAME='proofweave-lean-runner:4.27-20261031'
npm run runner:e2b:template:build > /tmp/e2b-template-4.27.json
```

回读 `/tmp/e2b-template-4.27.json`：

- `schemaVersion = pw-e2b-template-build-v1`
- `imageReference` 等于上面的 4.27 digest
- `templateReference`（或 `templateId`）与 `buildId` 非空

如果构建环境磁盘不足，在有足够磁盘/凭据的环境构建；不要跳过 digest 回读。

## 3. 登记 template 并生成部署值

```bash
npm run runner:environments:record-template -- \
  --profile mathlib-4.27-a3a10 \
  --report /tmp/e2b-template-4.27.json
```

该命令只允许把 `built_pending_template` / `template_ready` 环境更新为 `template_ready`，并校验报告镜像就是登记 digest；不会改写 4.31 或批准状态。

生成两个 Runner 的单镜像值：

```bash
# 4.31 Runner
node scripts/generate-runner-environment-config.mjs \
  --execution-profile mathlib-4.31-9a948 --surface render

# 4.27 Runner
node scripts/generate-runner-environment-config.mjs \
  --execution-profile mathlib-4.27-a3a10 --surface render

# Worker 分发列表：两个已部署环境
node scripts/generate-runner-environment-config.mjs \
  --profile mathlib-4.31-9a948 --profile mathlib-4.27-a3a10 --surface worker
```

Worker 还需要执行声明（4.27 先关闭）：

```json
[
  { "leanToolchain": "leanprover/lean4:v4.31.0", "mathlibRevision": "9a9483a92959bc92bd6a60176dd1fe597298c1f8", "executionEnabled": false },
  { "leanToolchain": "leanprover/lean4:v4.27.0", "mathlibRevision": "a3a10db0e9d66acbebf76c5e6a135066525ac900", "executionEnabled": false }
]
```

## 4. Render 增加 4.27 服务

保留现有 4.31 服务不动。新增 `proofweave-trusted-runner-427`，每个服务只放自己的单镜像：

- `RUNNER_APPROVED_IMAGES_JSON` = 4.27 单镜像
- `PROOFWEAVE_E2B_RUNNER_IMAGE` = 4.27 digest
- `PROOFWEAVE_E2B_TEMPLATE_ID` / `PROOFWEAVE_E2B_TEMPLATE_BUILD_ID` = 第 2 步报告值
- `RUNNER_EXECUTION_ENABLED=false`
- 独立的 `RUNNER_CONSUMER_ID`（例如 `runner:render-free-alpha-427`）
- 独立的 `PROOFWEAVE_RUNNER_WAKE_TOKEN`
- `RUNNER_RESULT_KEY_ID` / `RUNNER_RESULT_PRIVATE_KEY_JWK`：可以复用现有 Runner key，或按环境分开；复用时要确认 `runner_keys` 仍 active
- `PROOFWEAVE_RUNNER_REVISION`、`PROOFWEAVE_RELEASE_*`：与当前发布一致
- 资源、timeout、CPU/memory 沿用 4.31 服务

Render 更新后回读两个服务的 `/healthz` 和 `runnerPolicy.sandboxImageDigest`，确认 4.31 / 4.27 各自正确。

## 5. Worker 部署与 checker

`wrangler.cloudflare.jsonc` 需要：

- `RUNNER_APPROVED_IMAGES_JSON` = 4.27 + 4.31
- `RUNNER_EXECUTION_ENVIRONMENTS_JSON` = 两个环境，`executionEnabled=false`
- `RUNNER_WAKE_ROUTES_JSON` = 两个环境分别映射到各自的 `/v1/wake` 与 token（未配置时另一个 Runner 依赖轮询）
- 4.27 / 4.31 的 `RUNNER_APPROVED_IMAGES_JSON` 在每个 Render 服务内仍各只有一个镜像

部署前本地 checker：

```bash
node scripts/check-runner-environments.mjs --strict \
  --render deploy/huggingface-runner/render.yaml
```

期望：

- `runners=2`、`dispatchable=2`、`routed=2`、`selected=2`
- 4.27 / 4.31 都 `executing=0`（P2 执行关闭）
- `Inconsistencies: none`
- 4.27 `conformance` 若是 `missing`，先补第 2 步 workflow 产出的 `conformance.json`（`imageDigest`、`fixtureSetHash`、`reportHash`、`state: passed`）

Worker 从已提交源码构建，部署后回读：

```bash
curl -sS https://proofweave.org/api/mcp/capabilities | node -e '
  let s=""; process.stdin.on("data", d => s += d).on("end", () => {
    const c = JSON.parse(s);
    console.log(JSON.stringify(c.runnerEnvironments, null, 2));
  });
'
```

期望 `state=configured`、两个环境 `deployed=true`、`executionEnabled=false`；目标页显示 paused（4.31）或 no hosted Runner image（4.27 在 4.27 镜像批准前）。

## 6. P2 验收与 P3 单 Run

P2 通过条件：

- [ ] Turso 51 migrations，latest 0050
- [ ] 4.27 template 报告与 digest 一致
- [ ] 两个 Render Runner healthz 可达，sandboxImageDigest 分别 4.27 / 4.31
- [ ] Worker capabilities 返回两个环境，均 `executionEnabled=false`
- [ ] checker `--strict` 无配置不一致
- [ ] 队列无 queued/leased 的旧消息

P3 单 Run 窗口（详见主计划）：

1. 4.27 Render 服务设置 `RUNNER_ONLY_RUN_ID=<run>`、`RUNNER_MAX_DELIVERY_ATTEMPTS=1`、`RUNNER_EXECUTION_ENABLED=true`。
2. Worker 的 4.27 执行声明临时改为 `executionEnabled=true`。
3. 发起唯一 4.27 Run；确认它只被 4.27 Runner claim，4.31 Runner 不消费。
4. 无论结果如何，4.27 服务立即恢复 `executionEnabled=false`；Worker 声明恢复 false。
5. Run 通过后把 4.27 晋升 `approved`，移除 `RUNNER_ONLY_RUN_ID`，再按需要打开执行。

## 7. 回滚

- 先关 4.27 服务的 `RUNNER_EXECUTION_ENABLED`，再关 Worker 的 4.27 执行声明。
- 回滚 Worker 到上一版本；不要删除 0050 迁移或回退 Turso。
- 4.31 服务保持原状态；Runner key 不轮换，除非确认泄露。
- 队列消息是追加式证据；不要直接 SQL 删除或改写。dead-letter 用受控 redrive。

## 8. 当前阻塞

- 4.27 E2B template：缺 `E2B_API_KEY`。
- Render 4.27 服务：缺 Render 控制台/API 凭据。
- 4.27 manifest 独立核验：缺 GHCR `read:packages` 或 Docker login。
- 4.31 Runner 当前 healthz 超时：P2 前必须恢复。
