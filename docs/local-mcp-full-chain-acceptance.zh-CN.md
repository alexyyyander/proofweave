# 本地 MCP 全链路验收

这套验收在 Mac 上启动真实编译后的 Cloudflare Worker、临时 D1、两路 stdio Connector 和隔离 Docker Runner。两个 Person 均为合成测试身份，不表示两名真实外部用户。测试不连接生产数据库，不产生生产 credit。

## 验收范围

1. 本轮临时 HTTPS 证书仅由测试客户端信任；生产 issuer 的 HTTPS 校验保持生效。
2. 两路 Connector 各自完成 Person key proof、签名 delegation、浏览器审批 API、PKCE code exchange 和权限回读。合成登录 session 由测试夹具建立，不声称完成 Google 登录。
3. Research Agent 创建 Attempt，重复创建返回同一 Attempt；随后收紧研究窗口，只允许该 Attempt。
4. 发布签名 checkpoint，预览和上传实际 workspace archive、patch、Lake manifest，stage Bundle 并请求 Run。
5. Runner 消费真实 D1 queue，核验控制面签名与工件内容，在独立的受限容器中运行 Lean 4.35，保存签名结果并 ACK。
6. Owner 发布评审；从公开 review-jobs API 取得任务。作者自评必须失败。Review Agent 领取三项 claim，其中两项各执行一次新的隔离重放。
7. 提交与精确 evidence hash 绑定的签名 attestation，签发并验证 Receipt，核对真实 D1 credit ledger。无上游依赖时共 5 个不可转让记账单位：作者 2、评审者 3；重复提交不得增加 credit。

目录、初始活跃 pool 和合成 Person/session 是测试输入。成功 Run、assignment、attestation、Receipt、credit 均通过真实业务路径产生。当前验收为 **D1 inline 小工件路径**；不覆盖 R2 大工件、Mathlib 目标、生产 Runner cutover、独立人类评审或生产服务 SLA。

## 运行

先按照 [Runner 镜像说明](local-acceptance-runner-image.zh-CN.md) 构建或核验镜像，使用本次实际输出的不可变 ID。Node 版本遵循 package.json。

```sh
npm run build:cloudflare
npm run acceptance:local -- --isolated-test \
  --image-digest local/proofweave-acceptance@sha256:<实际镜像摘要> \
  --docker-image-id sha256:<同一实际镜像摘要> \
  --keep-open
```

脚本打印临时证据目录和阶段进度。`acceptance-report.json` 保留实际 Run、Bundle、Receipt、credit 和无凭据的 MCP 调用记录。`primary.json` 保留主 Run 的执行与隔离证据。失败保存 `failure.json`，不能据此宣称通过。脚本默认关闭所有自己启动的 Connector、Worker 和容器；`--keep-open` 在成功后保留 Worker，供额外 Codex 联调，按 Ctrl-C 关闭。

临时目录还包含私有合成测试密钥和短期 token。不要提交整个目录或复制 Connector 配置到生产。公开验收报告仍须保持 `syntheticIdentities:true`、`independentHumanReview:false`、`productionAcceptance:false`。

## 额外 Codex 进程

在成功验收仍保持运行时，执行：

```sh
npm run acceptance:local:codex -- /绝对路径/client-profiles.json
```

它启动额外的真实 `codex exec`，通过一次性的 MCP 配置接入该 HTTPS Worker，调用 `connection_status`、`get_connection_authority` 和 `list_review_assignments`。不修改全局 Codex 配置，不改变原有生产 Agent。三次真实 MCP 调用均成功后才保存 `codex-witness-report.json`；原始 CLI 事件只保存在私有临时目录。

此 Codex 进程是额外客户端的联通验证，不代表第二个人，也不替代前面的三项签名评审。真实生产验收仍需不同实际 Person 执行评审，并单独验证已部署的 Runner、工件存储和 OAuth 连接。
