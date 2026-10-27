# Runner 环境决策：采用 Lean 4.27（2026-10-26）

> 2026-10-27 决策更新：用户已允许采用最新稳定版或 4.28 以上版本。
> 新环境的构建默认值已改为 Lean 4.35.0 + Mathlib `56a0058…`，见
> [升级记录](lean-upgrade-2026-10-27.zh-CN.md)。下文保留为 4.27 历史环境的
> 构建与复现记录，不再表示新目标必须使用 4.27。

状态更新（2026-10-27）：4.27 镜像已构建，但尚未创建 E2B template，因此 **blocked，不可执行**。

## 决策

采用已评审的 `mathlib-4.27-a3a10` Runner 环境：

- Lean `leanprover/lean4:v4.27.0`
- Mathlib `a3a10db0e9d66acbebf76c5e6a135066525ac900`

不把现有 38 个目录目标重新 pin 到 Lean 4.31。现有目录全部使用 4.27；重新 pin 会引入大量数学与环境复验工作，且会破坏当前来源固定的目标。

## 已构建的 4.27 镜像（built_pending_template）

GitHub Actions workflow run `40450516816`（profile `mathlib-4.27-a3a10`）已成功构建并发布：

- 镜像：`ghcr.io/alexyyyander/proofweave-lean-runner@sha256:373c7ee722c69869ddde41cf90d2923b70d23afcae63275bc787ef10d6485223`
- 来源 commit：`8bd7409db9ae95110043bacc42f4b336ce3eabaf`
- Lean `leanprover/lean4:v4.27.0`
- Mathlib `a3a10db0e9d66acbebf76c5e6a135066525ac900`
- 环境状态：`built_pending_template`
- 构建产物：workflow 发布的 SBOM 与 provenance（以该 run 的产物为准）

当前部署面尚未切到 4.27：

- Worker 与 Render 的 `RUNNER_APPROVED_IMAGES_JSON` 仍只批准 4.31 镜像 `sha256:ca896ab39450…`。
- Render `PROOFWEAVE_E2B_RUNNER_IMAGE` 仍是 4.31 镜像。
- E2B template 仍是 4.31 环境对应的模板；4.27 没有专属 template。
- Runner `RUNNER_EXECUTION_ENABLED=false`。

结论：4.27 digest 已可追溯，但 **没有 E2B template，admissibility 明确 blocked**；digest 与 source revision 一致，不等于已获执行批准。

## 环境登记与校验

`config/runner-environments.json`（schema `pw-runner-environments-v1`）登记两个环境，每个环境包含 `profile`、`imageDigest`、`leanToolchain`、`mathlibRevision`、`state`（`approved` | `built_pending_template`）、`sourceRun`、`sourceCommit`：

- `mathlib-4.31-9a948` → `approved`
- `mathlib-4.27-a3a10` → `built_pending_template`（附 run `40450516816` 与来源 commit）

`scripts/check-runner-environments.mjs` 只读解析 `wrangler.cloudflare.jsonc` 的 Worker `RUNNER_APPROVED_IMAGES_JSON`，以及 `deploy/huggingface-runner/render.yaml` 的 `RUNNER_APPROVED_IMAGES_JSON`、`PROOFWEAVE_E2B_RUNNER_IMAGE`、`PROOFWEAVE_E2B_TEMPLATE_ID`，校验 schema、digest 格式、环境对唯一性、profile 唯一性与 state 合法性，并报告：

- 当前批准列表与 pending 环境之间的差异；
- 每个环境是否 admissible，以及 blockers（4.27 无 template 时为 `environment_state_pending` + `missing_e2b_template`）；
- digest 与 source revision 的一致性，以及 deploy 配置与登记表的绑定是否一致。

```bash
node scripts/check-runner-environments.mjs          # 人类可读
node scripts/check-runner-environments.mjs --json   # 机器可读
node scripts/check-runner-environments.mjs --strict # 配置不一致时退出 1
```

`--strict` 只在配置不一致、或 pending 环境被错误批准（出现在 Render 批准列表或成为 Render 执行镜像）时退出 1。4.27 当前 blocked 是登记表声明的预期状态，`--strict` 通过只表示配置自洽，**不代表 4.27 可执行**。该脚本不写入任何文件，也不修改部署配置。

## 依据

- `open-catalog/catalog/problems.json` 的 38 条记录全部为 Lean 4.27 + Mathlib `a3a10db…`。
- 当前生产批准的 Runner 镜像是 Lean 4.31 + Mathlib `9a9483a…`，因此 `npm run environments:report` 显示 **0/38 executable**。
- 仓库已有可复现的 4.27 构建 profile：`.github/workflows/build-e2b-lean-runner-image.yml` 的 `mathlib-4.27-a3a10`。它固定 Node 基础镜像、Lean 归档 SHA-256 和 Mathlib commit，输出 SBOM、provenance，并在无网络条件下 smoke test；该 profile 现已完成一次构建（run `40450516816`）。

## 发布链

```text
GitHub Actions (profile=mathlib-4.27-a3a10)            已完成：run 40450516816
  → GHCR proofweave-lean-runner@sha256:373c7ee…       已发布
  → Worker RUNNER_APPROVED_IMAGES_JSON（4.27 + 4.31 可并存）
  → E2B template（从 digest 构建，需 E2B_API_KEY）     当前缺口
  → Render runner env（PROOFWEAVE_E2B_RUNNER_IMAGE、RUNNER_APPROVED_IMAGES_JSON）
  → 一次受控 Run（RUNNER_ONLY_RUN_ID / 单次投递）
  → 环境验收后再开放 MCP/participant 研究窗口
```

构建命令（已完成，保留以复现）：

```bash
gh workflow run build-e2b-lean-runner-image.yml -f profile=mathlib-4.27-a3a10
```

## 当前状态与阻塞

- 生产窗口 stage 1 已上线：Worker `cd1d7480`，participant `read_write`，MCP `read_only`，gate 对 2 Person / 2 Agent / 4 Attempt 有效。线上无未授权写入（未登录返回 401）。
- **4.27 镜像构建已完成**：run `40450516816`，digest `sha256:373c7ee…`，来源 commit `8bd7409…`；SBOM 与 provenance 以该 run 产物为准。
- **4.27 仍被 template 阻塞**：没有 4.27 的 E2B template，Render 执行镜像与批准列表仍是 4.31，因此不能执行 4.27 Run。
- GHCR 包是私有的；本机 GitHub token 没有 `read:packages`，Docker 也未登录 GHCR。digest 来自 workflow 结果，本机无法独立回读 manifest；需要 `read:packages` token、`docker login ghcr.io` 或构建日志/SBOM/provenance 复核。
- `.env.local` 中没有 `E2B_API_KEY`，也没有 Render API 凭据；E2B template 和 Render 环境更新需要操作者控制台或凭据。
- Render Runner 的 `/healthz` 当前无响应（连接失败），说明服务不可达；这不只是 `executionEnabled=false` 的暂停。

## 验收顺序（下一步）

1. 已完成：构建并取得 4.27 镜像 digest，记录 workflow run `40450516816`、source commit `8bd7409db9ae95110043bacc42f4b336ce3eabaf`，并保留 SBOM 与 provenance。
2. 用该 digest 构建 E2B template（需要 `E2B_API_KEY`）；记录 template id 与 immutable build id，并回读确认 template 来源镜像就是 4.27 digest。
3. 更新 Render env：`PROOFWEAVE_E2B_RUNNER_IMAGE`、`RUNNER_APPROVED_IMAGES_JSON`（4.27 + 4.31 并存）、`PROOFWEAVE_E2B_TEMPLATE_ID` / `PROOFWEAVE_E2B_TEMPLATE_BUILD_ID`；保持 `RUNNER_EXECUTION_ENABLED=false` 做一次 preflight。
4. 如需 Cloudflare Container 路径，在 Worker 的 `RUNNER_APPROVED_IMAGES_JSON` 中加入该 digest（与 4.31 并存），部署并回读。
5. 只允许一个 Run（`RUNNER_ONLY_RUN_ID`、单次投递），在 4.27 环境验证 Lean accepted、四项检查、结果签名与输出哈希。
6. 该 Run 通过后，再把 MCP surface 切到 `read_write`，并用 Person A/Person B 完成真实闭环。

## 边界

批准 4.27 环境 **不等于**：

- 批准恢复 Runner 执行；
- 批准开放 MCP 写入；
- 批准公开评审或收据；
- 批准任何链上交易。

同样，镜像已构建（`built_pending_template`）**不等于**环境获批：在 E2B template 与该 template 的 immutable build id 经操作者复核、Render 执行面切换并完成单 Run 验收之前，4.27 保持 blocked。以上每一步仍需单独开关与证据。
