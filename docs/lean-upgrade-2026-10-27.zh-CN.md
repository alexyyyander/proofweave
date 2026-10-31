# Lean 升级记录（2026-10-27）

用户允许升级到最新稳定版或 4.28 以上。新环境采用 Lean 4.35.0，取代
“新目标必须继续使用 4.27”的选择。历史目标、Attempt、Bundle 和 Receipt
仍按原始环境复现。

## 已固定的构建输入

- Lean：`leanprover/lean4:v4.35.0`。
- Mathlib：`56a005855ea17e0b0958f73ec801ae140b0a1679`，对应上游 `v4.35.0`。
- 构建 profile：`mathlib-4.35-56a00`，已设为镜像 workflow 的默认值。
- 官方 Linux/amd64 编译器归档 SHA-256：
  `7289597a44543246c9227b8cae501767e095ce17f6d448b95fc4a8dc97268f6d`。
- 根目录 `lean-toolchain` 固定同一版本；已有独立工具链的历史测试项目不变。
- Mathlib 镜像中的三个 smoke 源文件使用 `module` 头，以适配新版 Mathlib
  要求的 Lean module system；仍保留完整的外部 Lake 项目构建与离线检查。

版本和 SHA-256 来自 [Lean 官方 release API](https://api.github.com/repos/leanprover/lean4/releases/tags/v4.35.0)。
Mathlib commit 来自 [官方 tag](https://api.github.com/repos/leanprover-community/mathlib4/git/ref/tags/v4.35.0)，
并核对了该 commit 的 [lean-toolchain](https://github.com/leanprover-community/mathlib4/blob/56a005855ea17e0b0958f73ec801ae140b0a1679/lean-toolchain)。
检查时 Lean 最新稳定版为 4.35.0；4.36.0-rc1 不作为生产默认值。

## 构建输入与生产状态分开记录

4.35 的最终 Runner 镜像尚未构建，因此没有镜像 digest、E2B template/build ID，
也没有生产执行证据。不向 `config/runner-environments.json` 写入虚构镜像，
不把现有 4.31 镜像重新标成 4.35。Worker/Render 的批准列表与执行开关保持原值。

现有 4.27 和 4.31 profile 继续可显式选择，以复现历史环境。
根目录工具链和构建默认值升级不等于生产 Runner 升级。

## 目录迁移

38 个现有目录记录仍固定 Lean 4.27 和 Mathlib `a3a10db…`。
Formal Conjectures 上游默认分支在本次核对时使用 Lean 4.33.1；因此直接
重新导入默认分支，也不能宣称这些目标已经兼容 4.35。

每个需要迁移的目标应完成：

1. 保留原 source snapshot 与 problem revision，创建带明确来源的新 revision。
2. 在 4.35 + 上述 Mathlib commit 下检查完整源码和依赖，修复 API 迁移问题；
   保存源码哈希、依赖清单、编译诊断与声明差异。
3. 对声明语义变化单独复核。含 `sorry` 的目标即使能编译，也仍是未证明目标。
4. 在新版镜像获准并通过单 Run 后，才允许新 Attempt 使用该 revision。
   旧 Attempt、Bundle、评审与 Receipt 不迁移、不修改已有证据的版本字段。

`npm run environments:report` 应继续如实报告旧目标的环境错配，不能为了让
报告变绿而改写来源元数据。

## 后续生产验收

1. 从包含此变更的已提交 revision 构建 `mathlib-4.35-56a00`，取得最终镜像
   digest、SBOM、provenance 与离线 smoke 结果。
2. 用该 digest 创建 E2B template，记录 immutable build ID。
3. 将新版镜像和确切 Lean/Mathlib 对加入环境登记及部署批准列表。
4. 完成至少一个新 revision 的受控 Run，核对签名、输出哈希及 Lean 结果，
   再开放相应目标。恢复 Runner 执行不是本次本地配置变更的隐含效果。

本机检查时仅有约 6 GiB 可用磁盘，不在该空间上追加完整 Mathlib 镜像构建。
完整镜像和目录迁移验收仍需有足够磁盘的构建环境。

## 本次验证

- 已校验并安装官方 macOS/arm64 Lean 4.35.0 工具链；本项目内 `lean --version`
  返回 4.35.0，`lake --version` 返回 Lake 5.0.0 / Lean 4.35.0。未修改全局默认值。
- 安装归档 SHA-256：
  `c0c6f34f35ba1dcc5c4a5fd106fefab9eb5e8469712624dd2c868d51b63177c2`。
- 29/29 项镜像配方、CI 权限/预算、环境登记与目标匹配测试通过。
- 实际执行 workflow 的 profile 选择分支，确认新 profile 导出正确的版本、
  Mathlib commit 和编译器摘要；未知 profile 仍拒绝。
- 使用真实 4.35 编译器与本地 `ContainerLeanExecutor` 测试入口：正常证明
  `succeeded/accepted`；含 `sorry` 的证明 `rejected` 且公理检查失败；
  编译错误 `failed/not_run`。3/3 符合预期。
- 本地测试结果保存在 `outputs/lean-upgrade-4.35/core-results.json`。
  这是 Core 兼容性测试，不是 Mathlib 全量验收、生产隔离证明或签名 Run。
- `environments:report` 仍为 0/38 匹配：现有目标与生产批准镜像未被改写。
