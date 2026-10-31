# 本地全链路验收的 Lean Runner 镜像

此镜像仅用于本地临时 D1、合成身份和确定的 Lean Core fixture。它不代表生产发布、安全认证、外部用户就绪或独立人类评审通过。Runner helper 仍要求具体 Bundle manifest hash 白名单；默认禁止未显式授权的宿主执行替身。

## 已验证的输入

- Lean：`leanprover/lean4:v4.35.0`，Mathlib：`none`。
- 官方发行包：[lean-4.35.0-linux.tar.zst](https://github.com/leanprover/lean4/releases/download/v4.35.0/lean-4.35.0-linux.tar.zst)。
- 官方 release API 公布并已核验的 SHA-256：`7289597a44543246c9227b8cae501767e095ce17f6d448b95fc4a8dc97268f6d`。
- 本机已有的 Node 22.23.4 runtime base：`sha256:ddc3ae8b3a6944c2ea33e0cf574c1924777fd1cee43e2dcc75fd1f5b5cd4824e`。
- 2026-10-28 实际构建的 OCI manifest ID：`sha256:8e0f46b2c3af9543ab8593b8350ad1b7677c4c45ae3c463b9552f1b84a931539`。

镜像保留 Lean/Lake 可执行文件、共享库、全部 `.olean`、`.olean.private`、`.olean.server`、`.ir` 及许可证；省略 `.a` 静态库、`.ilean` IDE 信息、`src` 和 `include`。4.35 编译器实际需要 private/server 元数据，不可进一步删除。该精简方式支持本次 `lake build Main` 和 `lake env lean`，不承诺本机代码链接、Mathlib 或任意外部 Bundle。

## 复跑构建

需要 Node、Docker/Colima、curl、zstd、tar，且 Docker 使用 containerd image store。脚本默认使用上面已经存在于本机的不可变 base，不会隐式拉取或替换它。另一台机器必须先准备包含 Node **22.23.4**、原生 zstd 支持、`patch`、`tar` 的 Linux/amd64 base，再通过 `PROOFWEAVE_ACCEPTANCE_BASE_IMAGE` 指定其不可变 ID 或 digest 引用。现有完整 Runner base 的生产构建流程另见 `runner-container-image.md`。

```sh
bash scripts/build-local-acceptance-runner-image.sh
```

可用 `PROOFWEAVE_ACCEPTANCE_IMAGE_BUILD_ROOT` 指定下载与证据目录。若目录已有发行包，脚本仍核验 SHA-256 后才解包。脚本打印并保存 `build-record.json`，包含新的 `dockerImageId`、协议 `imageDigest`、base、发行包 hash 和构建时间；同时保留 `lean-probe.log`、镜像 inspect 和下载包。

每次构建在唯一命名、无网络的临时容器内完成。脚本结束时只删除该容器，保留新镜像；不执行 prune，不清理已有容器、镜像或卷，不挂载宿主目录和凭据，不推送 registry。下载包约 567MiB，解压过程和镜像存储还需数 GiB 空间。脚本重现构建方法与输入校验，**不保证逐字节相同的镜像 digest**：当前源码和镜像创建时间会改变 digest。每次必须使用新记录的实际 digest。

## 验证隔离与真实执行

构建阶段执行真实定理证明和 `#print axioms`，期望 `local_acceptance` 不依赖任何公理。构建探针不等同于完整运行时隔离测试。完成构建后，使用输出的镜像 ID 执行：

```sh
PROOFWEAVE_LOCAL_ACCEPTANCE_DOCKER_IMAGE_ID=sha256:8e0f46b2c3af9543ab8593b8350ad1b7677c4c45ae3c463b9552f1b84a931539 \
  node --test tests/local-acceptance-runner.test.mjs
```

`createLocalAcceptanceRunner` 接收 `dockerImageId` 及 `local/proofweave-acceptance@<相同 digest>`。每个实际 Run 使用独立容器，核验 `network=none`、网络连接实际返回 `ENETUNREACH`、只读根文件系统、非 root UID、memory/swap 上限、1 CPU 配额、CPU rlimit、128 进程、受限 tmpfs、删除 capabilities、no-new-privileges。容器不开放宿主端口，也不接收数据库或签名密钥。私有 HTTP 通过 `docker exec` 访问容器内部 loopback。

实际 job 必须由 Worker/MCP 入队，经过 lease、控制面签名验证、真实工件 hash/patch/tree 校验、Lean 编译、公理审计、stdout/stderr hash、Runner 签名、持久化和 ACK；镜像探针本身不能替代这些全链路证据。正常 Docker 路径报告 `isolationVerified:true`；本地合成身份验收始终报告 `productionAcceptance:false`。
