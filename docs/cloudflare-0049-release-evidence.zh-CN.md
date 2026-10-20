# Cloudflare / 0049 发布证据校验

这是 PR #166 源码整合之后的独立验收器变更。默认不开启研究写入、Runner 执行、定时任务或部署。旧 `check-credentialed-contribution-release.mjs` 的 v1 staging/0043 规则和生产拒绝保持有效；旧生产 drill 仍要求其原有 Sites 发布清单，不能拿新版离线结果替代该流程的批准。

## 三个入口

- `bindCloudflareReleaseEvidence`：离线检查一份组件清单和一次观测。可检查暂停生产状态，但不验证贡献链。
- `inspectCloudflareReleaseEvidence`：仅向清单内固定的 `/api/mcp/capabilities` 和 `/healthz` 发出无凭据 GET，拒绝重定向、非 JSON 和超过 64 KiB 的响应。其余提供商记录和账本必须独立采集后传入；公开诊断不能证明这些记录来自提供商。
- `checkCloudflareContributionRelease`：离线检查完整贡献链及前后两次组件观测。要求研究 surface 和 Runner 的执行态证据；暂停健康信息本身不能通过。结果为 `consistent`，不代表已授权、已发布或真实操作已完成。

单元测试使用测试身份和内存数据库；测试结果不能登记为真实 Person、真实生产 Run、独立数学评审或 Receipt 验收。

## 单独固定组件清单

清单 schema 为 `pw-cloudflare-component-release-v1`，只接受下列字段。新增字段必须修改 schema 和负例；缺失字段不能用猜测值补齐。

| 字段 | 必需内容 |
| --- | --- |
| `environment` | `kind` 为 staging 或 production；规范 HTTPS `origin` |
| `database` | `fingerprint`；完整原始账本的 `ledgerDigest` |
| `cloudflare` | `sourceKind`、`sourceRevision`、`deploymentId`、`artifactDigest` |
| `runner` | `origin`、40 位 `revision`、Render `serviceId` / `deployId`、Runner 自己报告的历史 `sitesVersion` / `siteProjectId` |
| `e2b` | 固定 `imageDigest`、`templateId`、不可变 `templateBuildId`、`leanToolchain`、`mathlibRevision` |
| `loginBridge` | `origin`、40 位 `sourceRevision`、独立 `sitesVersion` / `siteProjectId`、`artifactDigest` |
| `modes` | `global` / `participant` / `mcp` 的明确读写模式；Runner 为 paused 或 ready |

Cloudflare `sourceKind=git_commit` 要求 40 位 Git SHA；`migration_snapshot` 要求 64 位历史源码摘要。两种来源不能互换，源码摘要也不能充当构建产物摘要。Cloudflare 诊断的 Sites 字段必须为 null；Runner 的历史 Sites 标签只是它自己的声明，不是登录桥版本。

`artifactDigest` 是独立保留的实际发行产物的 SHA-256，格式 `sha256:<64 位小写十六进制>`。须对审核并保留的构建/发行产物计算，不能将源码 SHA、目录名、Worker 版本 UUID 或占位值当作产物摘要。若历史产物或提供商发布记录缺失，停在“证据不足”，不能生成一份自称已绑定的真实发布清单。

清单 hash 是 `releaseEvidenceHash(manifest)`：协议 `canonicalJson` 编码后计算 SHA-256。预期 hash 必须从独立审核记录取得，并单独传入；现算输入文件 hash 仅证明文件一致，不能证明审核批准或真实性。生产记录只接受正式 origin 与既有生产指纹的组合；staging 不能使用其中任一生产标识。此检查不确认 staging 是否共享其他生产资源。

## 观测格式及采集边界

每次观测具有且仅具有以下字段：

```text
observedAt: UTC ISO-8601
collectionWindow: 在线采集时必需；离线历史记录可不带
  providerObservedAt: 提供商记录的原采集时间
  startedAt: 实际公开探测开始时间
  completedAt: 实际公开探测完成时间；必须等于 observedAt
cloudflare:
  origin
  capabilities: 原始公开 capabilities JSON
  deployment: { id, sourceRevision, artifactDigest }
runner:
  origin
  health: 原始 /healthz JSON
  deployment: { serviceId, id, revision, autoDeploy }
e2b: { imageDigest, templateId, templateBuildId, leanToolchain, mathlibRevision }
loginBridge: { origin, sourceRevision, sitesVersion, siteProjectId, artifactDigest }
database:
  fingerprint
  ledger: [{ name, sha256, applied_at, statement_count }, ...]
```

在线入口使用系统时钟记录探测起止时间，不沿用输入的 observedAt。提供商采集时间必须不晚于探测开始，且最多早 5 分钟；否则在发出 GET 前拒绝。整个探测窗口最多 30 秒，时钟倒退也会拒绝。输出把原采集时间保存在 collectionWindow，并以探测完成时间作为 observedAt。离线校验会核对此时间关系；贡献窗口须开始于 before 探测完成之后，结束于 after 探测开始之前。离线保存的真实历史观测仍可按原时间检查，不触发网络请求。测试注入时钟或 HTTP 实现会明确标为 fixtureOnly，不构成真实生产证据。

从发行记录、Cloudflare 部署、Render 部署、E2B 模板 build 和 Sites 登录桥版本分别采集各自记录，保留采集时间和只读审计来源。当前公开 API 没有提供的字段不能从另一个组件复制。只传无凭据投影，不导出 provider token、cookie、OAuth code 或私有研究内容。数据库仅导出 `_proofweave_migrations` 的上述四列，按 name 排序；采集动作不得应用迁移。

校验器从当前仓库加载真实迁移 SQL，复用数据库迁移校验中的账本身份函数，要求恰好 0000–0049 共 50 条；名称、摘要、语句数、时间和完整性均检查。仅保留既有 0039 的窄兼容身份；0049 仍要求仓库中的确切摘要和 38 条语句。未知后续迁移、旧账本或输入账本摘要漂移全部拒绝。它不打开数据库，不能单凭导出的 JSON 证明数据库当前结构或状态。

## 贡献链 v2

证据 schema 为 `pw-cloudflare-contribution-release-evidence-v2`。顶层字段为 `schemaVersion`、`release: { before, after }`，以及 v1 使用的 `researcher`、`attempt`、`bundle`、`runner`、`reviews`、`receipt`、`publicReceiptVerification`。两个观测必须匹配同一份组件清单、账本和模式，所有贡献事件必须位于窗口内。

新版复用原有贡献图校验，保留不同 Person 所有者、review 委托、对应 assignment 的新鲜重放、Run/Bundle/Receipt 关联及时间顺序检查。它不调用旧版发布校验，也不伪造相同 SHA 或 0043 观测来取得通过。

```sh
npm run release:cloudflare:evidence -- \
  --evidence-file /secure/path/evidence.json \
  --manifest-file /secure/path/reviewed-components.json \
  --expected-manifest-hash sha256:REPLACE_WITH_INDEPENDENTLY_REVIEWED_DIGEST
```

若只检查一份暂停组件观测，在同一命令的参数最前面加 `--binding-only`，并把 evidence-file 指向单次观测 JSON。此模式不接收贡献图，也不返回贡献通过结论。公开 GET 检查仅通过明确调用 `inspectCloudflareReleaseEvidence` 执行，CLI 默认保持离线。

输入限每文件 512 KiB，必须是普通非符号链接文件。CLI 不读取凭据环境变量，失败仅输出错误类别。示意命令中的占位 hash 无法通过；仓库不提交一份伪造的真实生产通过证据。

即使生产形状的离线证据返回 consistent，`executionAuthorized`、`releaseApproved`、`liveProviderStateVerified`、`fineGrainedWriteGateVerified` 和密码学签名重新验证均保持 false。需要另行完成真实来源核验、细粒度 Person/Agent/Attempt 写门禁、实际签名/回执验证、资源与执行窗口批准，以及真实独立评审。现有生产仍应保持暂停；本变更本身不解除这些阻塞。
