# Cloudflare 迁移记录（2026-10-16）

## 最新总览（2026-10-20，Asia/Shanghai）

**正式站迁移已验收；Runner PR #162 已获批准、合并并部署。一般研究写入和生产执行继续关闭。**
Runner `/healthz` 已恢复 HTTP 200 / `paused`，严格迁移校验通过至 0049。
剩余工作是整理已发布源码与工作区、补齐当前 Cloudflare 拓扑的验收工具，并准备受控开放方案。

本总览区分 10 月 19 日的登录、配对、DNSSEC 验收与 10 月 20 日的 Runner 发布和公开诊断回查；
没有把历史验收描述为当天重测。各组件记录在 [当前发布状态](releases/2026-10-20-release-state.json)。

| 组件 | 已核验版本或状态 | 证据边界 |
| --- | --- | --- |
| 正式 Cloudflare 站 | `https://proofweave.org`；版本 `c7af9e77-3afc-40bc-8c49-5365d68874b0` | 10 月 20 日 Chrome 可正常打开；公开 capabilities 诊断 `ready` |
| Cloudflare 源码 | `c89246e42ab30e205a4d0ca52f65dfa76a3ec24ab7caa1479b52d32b4296cca1` | 独立迁移快照的来源摘要，不是 Git main 的提交 SHA；37 个覆盖文件摘要已逐项回查 |
| Git main / Runner | `13c07955d7fc85e9ff6f47102d0a9d8806339aad` | [PR #162](https://github.com/alexyyyander/proofweave/pull/162) 经 thudubdoo 有效批准，按正常规则合并，合并提交签名 Verified |
| Runner 发布 | 2026-10-20 16:12（北京时间）上线该合并提交 | Render `dep-dbbi4fu1egvs7384b1n0`；HTTP 200 / `paused`，`executionEnabled=false`，自动部署 `no` |
| 数据库 | 原 Turso，指纹 `3f9e7934a04a22ec`，账本头 `0049_add_catalog_browse_index.sql` | 正式站与 Runner 的公开诊断一致；本次仅校验，未应用迁移 |
| E2B 模板 | `cbfjgbsrgtku0c7sliu5:workspace-modes-20261019-617de06` | build `4fd0e92f-9513-4c3d-8af3-6492e86c3f24`；本次未重建或启动 Sandbox |
| Google、ChatGPT 登录及 Agent | 10 月 19 日真实浏览器和只读 OAuth/MCP 验收通过 | ChatGPT 仍通过原 Sites 登录桥；不是直接 OpenAI 网站 OAuth |
| 生产能力 | global `read_write`；participant、MCP 均 `read_only`；Runner 暂停 | global 支持账号/连接生命周期，不等于研究写入开放；已停止的定时任务不自动恢复 |

PR 重签的六个提交均为 Verified；每组新旧提交的源码树、原作者、说明保持不变，
最终 tree 为 `1c8488c53791dba09ee680becaec95e6781cf358`。
[重签后快速 CI](https://github.com/alexyyyander/proofweave/actions/runs/39241869012)、
[重签后完整 CI](https://github.com/alexyyyander/proofweave/actions/runs/39241913414) 与
[main 合并后完整 CI](https://github.com/alexyyyander/proofweave/actions/runs/39391044158) 均通过。
八种暂停启动回归使用真实迁移校验器：两种合法历史健康且暂停，六种异常降级为 503，且不创建执行运行时或写入账本。

### 已完成与当前阻塞

- 域名、HTTPS、DNSSEC、Google/ChatGPT 登录、正式 Connector 和临时 Agent 配对已有 10 月 19 日证据。
- 一次受控生产 Lean Run 已在 10 月 19 日成功，核对过内核接受、结果签名和输出哈希；其单次授权已消费。
- PR #162 的批准、签名、合并、0049 源码对齐、Runner 暂停部署和健康恢复已完成，后台评审检查已停止。
- 本次新部署没有执行研究任务；此前 Lean 结果不等于当前版本完整贡献评审、回执或 Nile 存证验收。
- 现有完整贡献验收器 v1 只接受隔离 staging，且固定 0043；不能将生产 0049 记录送入它并声称通过。
- 现有严格发布绑定仍要求 Sites 身份。Cloudflare 诊断的 Sites 字段为 null；Runner 的 `sitesVersion=192` 是历史配置，不能代表当前桥接 Sites v204 已对齐。
- 主工作区按目录折叠计数约 151 项，展开为 204 个文件；已备份并形成[分拆清单](workspace-release-split-2026-10-20.zh-CN.md)。
  根目录 `app/auth.ts` 和 `wrangler.cloudflare.jsonc` 与已发布快照不同，不直接用于重新发布。

### 后续顺序

1. 按分拆清单整理 Cloudflare 迁移、Runner 重复修改、目录采集、UI 和共享构建文件，保留原工作区。
2. 为 Cloudflare／0049 拓扑补齐可审查的发布来源绑定和验收器；保留旧 staging 及凭据拒绝规则。
3. 按[受控开放验收方案](research-reopening-acceptance-2026-10-20.zh-CN.md)准备具体窗口、身份、Bundle、Run 和恢复步骤。
4. 门禁及具体执行范围另行获准后，才逐项开放研究能力；定时任务继续暂停。

### 证据位置

`outputs/cloudflare-migration-20261016/` 为本地忽略目录，不随本次文档提交上传：

- `pr162-ssh-signing-20261019/`：备份 bundle、逐提交 tree 对比、六个 GitHub 签名和 CI。
- `pr162-merge-20261020/`：有效批准、合并提交及生产保持暂停的核验。
- `pr162-deploy-20261020/`：main CI、部署 ID、公开健康响应及执行/自动部署关闭的回读。
- `project-capabilities-20261020.json`：Chrome 读取的正式站能力、0049 账本及两个研究写入门禁。
- `release-closeout-20261020/`：204 文件备份、改动前摘要及 37 文件发布来源对照。
- `formal-login-browser-verification-20261019.json`、`formal-connector-verified-20261019.json`：历史登录与连接验收。

直接 Python HTTP 请求正式站和 capabilities 曾返回 403，而同机 Chrome 页面和 capabilities 正常。
该访问路径差异仍待归因；未据此认定生产站故障，也未修改网络或防护配置。

## 历史记录阅读说明

以下按操作发生时间保留。早期“Google 登录待验证”“尚无跨站闭环”“验证阶段阻止所有 POST”等描述已被后续实现与验证取代。
判断当前状态时优先使用上方总览及末尾最新验证记录，不将不同阶段的待办合并为当前故障。

## 当前状态

独立 Cloudflare 验证站已部署，正式域名尚未切换。验证地址：
<https://proofweave.proofweave-alexyu.workers.dev>。

账户 `536799122b9ceaba8d5dc6d0570bbfc8`，Worker `proofweave`，
R2 bucket `proofweave-anchor-manifests`。数据库继续使用原 Turso，不建立第二套可写控制面。
原 Sites v196 已冻结研究写入，保留作为只读回滚目标。

## 发布源与安全边界

- 基线已更新为 Sites v196 的提交 `6db52b2c11ace065591ed8848765d81dc804028f`，保留最新发布的界面。
- 隔离源码在 `outputs/cloudflare-migration-20261016/source-v196`，没有将根工作区未发布的改动一并部署。
- `outputs/cloudflare-migration-20261016/source.json` 记录基线、迁移文件摘要和 sourceRevision。
  sourceRevision 是基线提交与迁移覆盖文件清单的 SHA-256，不是新 Git 提交。
- `worker/cloudflare.ts` 清除客户端提供的 `oai-*`、Sites dispatch 和版本覆盖头。
  独立站只接受应用自己的会话和协议凭据。ChatGPT Sites 登录入口不再展示。
- `PROOFWEAVE_DEPLOYMENT_STAGE=validation` 阻止非 GET/HEAD 请求；participant/MCP 均为
  `read_only`，数据库适配层阻止研究写 SQL。为验证登录，global 与独立的
  `PROOFWEAVE_ACCOUNT_AUTH_MODE` 为 `read_write`，仅账号身份/会话存储使用此能力。
  账号模式仍受 global 总开关限制；未配置时继承 participant 模式。
- 直接部署的诊断使用 `CF_VERSION_METADATA.id` 和独立 sourceRevision，
  `sitesVersion`、`siteProjectId` 返回 null；原 Sites 的诊断格式保持不变。

## 已验证

- 构建和隔离源码 typecheck 通过；鉴权、数据库适配和部署边界测试 27/27 通过。
- 首页、登录页、锚定列表返回 HTTP 200。
- 伪造 Sites 身份头访问 `/profile` 仍重定向到登录。
- POST 锚定 tick 返回 503 `deployment_read_only`，未触发上链。
- 数据库只有一个已确认批次；其清单已复制到新 R2 并回读逐字节比较。
  公共接口返回 `x-anchor-manifest-source: bucket`，摘要为：
  `sha256:2d62d4a66c94da674b06e3ca44b7b6fcb32a265371ef9b2cf5ae51821060cf13`。
- `/api/mcp/capabilities` 返回 HTTP 200、诊断 `ready`，数据库指纹
  `3f9e7934a04a22ec`，迁移账本到 `0048_add_anchor_submission_outbox.sql`。
- 本机直接连接 workers.dev 失败，经现有本机代理访问成功。这是不同网络路径的观测，
  不代表所有地区已验证可访问。

机器记录在 `outputs/cloudflare-migration-20261016/`：
`auth-tests.log`、`build.log`、`typecheck.log`、`deploy.log`、
`remote-checks-proxy.json`、`release-diagnostics.json`、`r2-readback.json`。

## Google 登录

复用 Google Cloud 项目 `proof-502608` 中的既有 Web 客户端。
已修正并通过用户下载的客户端 JSON 核实两个回调：

- `https://proofweave.org/auth/google/callback`
- `https://proofweave.proofweave-alexyu.workers.dev/auth/google/callback`

用户创建新 Client Secret 后，已通过 stdin 写入 Cloudflare Secret，
同时生成独立的 OAuth state 密钥。密钥不进入仓库、发布包或操作日志。
Google 登录仍需完成回调、会话建立和退出验证；已单独开放账号写入以进行真实登录测试。
品牌页的首页、隐私和条款链接已补齐，Google 授权页已显示这些链接。
用户已完成手机本人验证，但浏览器最终返回 `invalid_state`，尚未建立可验证的应用会话。
可能与等待期间 flow cookie 过期有关，尚未确认原因；需要重新发起并验证完整登录。
发起端已验证返回 Google 授权页（302），客户端 ID 匹配，PKCE 为 S256，
flow cookie 已设置，回调指向已登记的 workers.dev 地址。

## ChatGPT 登录：新增迁移验收项

用户要求独立站继续支持 OpenAI/ChatGPT 登录。当前 Cloudflare 验证站尚未接入独立的 OpenAI OAuth；原 Sites 登录桥已部署，2026-10-18 已完成真实浏览器登录与退出核验。
现有 Sites 登录依赖托管层注入的身份头，不能直接搬到公开 Worker；继续拒绝客户端伪造的身份头。

2026-10-16 核实的官方接入条件：

- [网站登录文档](https://developers.openai.com/siwc/website)支持 Authorization Code、PKCE 和 OIDC，
  需要该网站获批的 OAuth client ID、精确登记的回调和对应的客户端认证方式。
- [客户端申请说明](https://developers.openai.com/siwc/request-client-id)注明当前向部分商业合作伙伴开放，
  可通过官方意向表申请。当前项目源码及配置中未找到独立站客户端；未提交申请。
- 计划登记的回调为 `https://proofweave.org/auth/openai/callback` 与
  `https://proofweave.proofweave-alexyu.workers.dev/auth/openai/callback`，两者目前均未登记或实现。

接入时需完成：跨 Worker 实例原子消费的短期登录事务、state/nonce/PKCE 校验、OIDC 签名及声明校验、
按 issuer/client ID/sub 绑定身份、应用会话与退出。新身份与旧 Person 的关联需要明确验证和确认，
不能直接套用现有按邮箱自动合并的逻辑，也不能借用 Codex 或 Sites 的 OAuth 客户端。
验收包括新用户、老用户贡献记录连续性、取消/过期/重放拒绝、退出及 MCP 会话识别。

在取得客户端并完成真实登录验证前，此项保持未完成，不将仅显示登录按钮计为支持。

开源路径补充：用户目前没有公司。不能把“没有公司”认定为不具备接入资格；已查文档没有
确立这种判断。官方另有[开源客户端动态注册](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)：
初次使用 `dynamic_agent_client`，无需 client secret 或 partner API key，回调要求 HTTP `127.0.0.1`。
该路径可用于符合条件的本地开源工具，主要服务于用户在工具中使用 ChatGPT 计划。
[适用范围](https://developers.openai.com/siwc/token-sharing-open-source)另将付费或远程托管应用引向申请流程。
因此它值得用于 Proofweave 本地 Agent 的接入评估，但现有文档不能证明它可直接替代
Cloudflare 公共网站的 HTTPS 登录回调。不能仅因代码开源，就假定网站获得了该接入资格。

### 原 Sites 登录桥（2026-10-18 已验证登录、退出与原 Person 关联）

用户提出使用原 Sites 中转。Sites 技能的身份契约说明：平台向服务端注入站点内稳定的
`oai-authenticated-user-id`，原生登录必须顶层导航且 return path 为同源相对路径。
据此可以设计 Proofweave 自有登录桥：Cloudflare 发起绑定浏览器的 state/PKCE 事务，
跳到原 Site 的桥接页；桥接页通过平台原生登录回到该 Site，确认目标站点后签发短时一次性代码；
浏览器只携带代码和 state 返回固定 Cloudflare 回调；Cloudflare 后端验证并原子兑换代码，建立本地会话。
此设计不搬运 OpenAI Cookie/token，不接受客户端身份头，也不让平台原生 return_to 跨域。

桥的客户端和回调必须固定允许列表，兑换绑定 PKCE、客户端、回调与短期过期时间；
不得将邮箱或长期会话凭据放入 URL。稳定身份以原 Site ID 与平台用户 ID 为键，旧 Person 需审慎关联。
桥接只能获得必要的登录事务能力，保持旧研究写入关闭。桥接独立于现有 MCP token 授权。

这是根据现有身份契约提出的应用层设计，尚无实际跨站闭环结果，也未找到平台对外部身份桥的明确保证。
须验证 Sites 出站跳转、服务端兑换可达性和访问限制、重放拒绝及账号连续性后才可启用。
成功后无需为这条桥接路径另取 OpenAI 网站 OAuth 客户端，但 ChatGPT 登录将继续依赖原 Site，
不能宣称完全脱离 Sites；Google 登录可以独立运行。原 Site 不能在迁移完成后删除。

## 正式切换前的门禁

1. 回执密钥已轮换并通过历史验证；Runner 新旧公钥配置已保存。
   具体结果见 [签名密钥轮换方案](./cloudflare-key-rotation-2026-10-16.zh-CN.md)。
2. Render Runner 的 `RUNNER_EXECUTION_ENABLED=false`，本次没有启用它。
   补齐已执行的迁移文件后，提交 `19fa30db01502c0f7659651cd83521f61ff5b51c` 已上线并健康暂停。
   受信旧 key 的 10 条历史队列签名和新 key 的内存签名通过，测试消息未入队。
   Runner 诊断仍使用旧版 Sites 元数据格式，不能把其中的 Sites 192 视为当前网页版本；
   它实际运行在 Render，实际提交由 `revision` 给出。执行闭环仍待独立验证。
3. Nile 签名配置已从验证过的运营密钥重建并写入 Worker，未复制旧 EVM adapter。
   暂停的定时任务保持暂停。
4. 配置完整后进行 Google 登录、ChatGPT 登录、MCP/OAuth、签名和研究流程验证，再开放正常写入。
5. DNS 与证书切换。Cloudflare zone 仍待激活；注册商继续是 Spaceship。
   Cloudflare 分配的 NS 为 `brian.ns.cloudflare.com` 和 `edna.ns.cloudflare.com`。
   切换前核对完整 DNS（包括邮件记录），绑定正式 Worker 域名并验证 TLS。
   当前 Wrangler OAuth 能部署 Worker，但读取 zone DNS records 返回 403；DNS 操作需控制台或明确授予相应权限。

## 构建与回滚

在隔离源码目录执行：

```sh
node node_modules/vite/bin/vite.js build --config vite.cloudflare.config.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
NODE_OPTIONS=--dns-result-order=ipv4first WRANGLER_SEND_METRICS=false \
  node node_modules/wrangler/bin/wrangler.js deploy --config dist/server/wrangler.json
```

发布前必须记录覆盖文件摘要，并向该次配置提供 `PROOFWEAVE_RELEASE_SOURCE_REVISION`。
Wrangler 配置默认只读，不应为了通过诊断而填写虚假的 Sites 版本。
只有登录、密钥、Runner、存证和域名验证都通过后才能把正式流量切过来。
切换失败时恢复原 DNS/域名绑定到保留的 Sites 站点；不回滚或重建共用 Turso 数据库。

TRON Nile 是测试网。清单锚定提供存证，不能描述为数学正确性证明。

## 18:20 CST 验证快照

- Worker 版本 `2c3c050c-ec05-45a7-89d5-ca4b3910626c`。
- sourceRevision `ee94577807aee1219bfeb6479c77db1a222c9d9a391888421437e03b9ef35eb6`。
- v196 构建、typecheck 与账号/研究写入隔离等 22 项测试通过。
- 验证站 OAuth issuer/resource 暂时使用 workers.dev 自身地址；正式切换时一起改回 proofweave.org，
  并同步 Google redirect URI。OAuth discovery 返回 200，数据库诊断 ready。
- participant/MCP 写入仍为 false，tick 返回只读 503；伪造 Sites 身份头仍无法登录。
- Google 授权已进入用户手机本人验证，回调、会话与退出尚未完成。
- Runner 健康接口返回 200、paused、executionEnabled=false，迁移账本到 0048。
  修复 [PR #162](https://github.com/alexyyyander/proofweave/pull/162) 仍为草稿，未合并主分支。
  后续从主分支自动部署前必须合入迁移文件，避免再次出现账本不匹配。
- 正式域名 NS 仍为 `launch1.spaceship.net`、`launch2.spaceship.net`，未切换。
- 追加记录：`preview-authority-verification.json`、`runner-health-after.json`、
  `runner-repair-deployment.json`、`runner-repair-tests.log`、`auth-surface-tests.log`。

已恢复的凭据通过加密 Secrets 保存；本文及机器验证记录不包含凭据值。


## 19:24 CST 登录桥验证进展

- 用户明确授权将专用 `SITES_BRIDGE_SECRET` 写入原 Sites 与指定 Cloudflare Worker，已完成，两处均为加密 Secret。
- Sites v198 / `e6cefcba2bdbea358bbb491e44cbef9501e971e0` 已发布，环境 revision 55；旧研究控制平面保持只读。
- Cloudflare Worker `58f1b898-17af-4377-a258-5a0474475952` 已部署，sourceRevision
  `ec2cfe5a67eec0467801380551f85355dcb9c6bd63174c7bac6765ca0ece258f`。
- 仅登记 workers.dev 验证站接收方，未登记正式域名回调，未改 DNS。
- Cloudflare Durable Object 保存短期事务，跨请求原子消费；旧 Sites 不新增数据库写入。
- 30 项相关测试通过；两端构建、隔离源码 typecheck 通过。表单修复后的 8 项桥接测试通过。
- 首次真实浏览器提交因确认页 `no-referrer` 导致 `Origin: null` 而拒绝；仅将确认页改为
  `same-origin`，重定向仍为 `no-referrer`，仍拒绝空 Origin 和跨站提交。
- 公共入口验证：登录页 200，桥接入口 302，未登录/伪造 Sites 身份头均跳回原生登录；
  Cloudflare 伪造身份访问个人页仍跳转登录；tick 503 `deployment_read_only`。
- 本机 Python HTTP 客户端访问 workers.dev 出现边缘 1010；curl 与浏览器可访问，不能把客户端路径差异当作应用鉴权结果。
- 浏览器已显示原 Sites 身份确认页；个人页会话、退出及真实 Person 连续性仍待核验。

关闭桥接：先将 Cloudflare `SITES_BRIDGE_ROLE` 设为 disabled 并部署，随后关闭旧 Sites 桥接角色。
不会恢复研究写入，也不删除既有 Person 或研究记录。关闭桥接不会自动撤销已经建立的应用会话。


## 20:05 CST 登录桥失效恢复

- 20:00 的真实 POST 与 19:25/19:26 的 GET 使用相同 state，已超过 10 分钟期限；此次 Origin 已正确。
- 原 Sites v199 / `646ac83917a4a294da639d1b28cde2ed5e2d3dc5` 已部署，环境 revision 55。
- 失效或缺失确认 Cookie 显示明确提示，重试按钮只指向登记的 workers.dev 新登录入口。
- 拒绝请求时仅记录固定错误类别，不记录身份、Cookie、断言或完整 URL。安全校验与有效期不放宽。
- 9 项桥接测试通过，包括过期/缺失确认不发起身份交换、固定重试地址及不回显事务值。
- 此次只更新 Sites 发行端；Cloudflare 仍为此前版本 `58f1b898-17af-4377-a258-5a0474475952`。
- 已打开新浏览器事务；自动化无法读取确认页按钮，真实登录闭环仍待用户点击后核验。


## 20:10 CST Workers 运行时兼容修复

- 20:06 的新事务报 `internal`，不是过期。用本地 workerd 复现：`fetch` 不支持 `redirect: "error"`，发出请求前抛出 TypeError。
- 发行端改为 `redirect: "manual"` 并拒绝所有非 2xx 响应；不跟随重定向，不扩大身份接收方。
- 新增完整发行端的 workerd 测试，不再只模拟 fetch；验证成功交换以及拒绝 302/307，10 项测试通过。
- Sites v200 / `48e1ecb964e61ebc60f53fa931706bac22788713` 已发布，环境 revision 55；Cloudflare 接收端未变化。
- 此前确认页过期确有日志依据，但不是新会话失败的原因。浏览器会话闭环仍待验证，不能把测试通过视为真实登录成功。


## 2026-10-18 登录闭环验证完成

- 浏览器复现并定位到 CSP `form-action 'self'` 阻止表单后的跨站回调。v201 仅为已登记的 workers.dev 接收方增加表单重定向许可；其他脚本、嵌入和表单限制保留。
- Sites v201 / `bcd3bf2308d93a85b699e8a3faa511a3f63d6811` 发布成功，环境 revision 55。Cloudflare 接收端仍是版本 `58f1b898-17af-4377-a258-5a0474475952`。
- 10 项登录桥测试通过，包括 Workers 真实运行时、一次性消费、CSRF、过期、签名、目标限制和原 Person 关联。
- Google：账号选择和确认后进入 workers.dev `/profile`，菜单显示 Google；退出后再次访问 `/profile` 跳回登录页。
- ChatGPT：原 Sites 确认后进入 workers.dev `/profile`，菜单显示 ChatGPT；退出后再次访问 `/profile` 跳回登录页。
- 生产数据库只读比较：该测试账号有 1 个原 Person、1 个桥接身份，二者 person_id 一致。记录不保存邮箱、稳定标识、Cookie、OAuth code 或凭据。
- 个人工作区仍显示维护模式，研究写入与执行未开放，定时任务未恢复，DNS 未切换。登录成功不代表研究执行已验收。
- 后续：MCP/OAuth 与研究执行验证；修正登录页关于按邮箱自动关联的泛化文案（桥接不会自动合并 Google-only 账号）；正式域名回调、绑定、DNS 与 TLS 切换。
- 验证记录：`outputs/cloudflare-migration-20261016/login-browser-verification-20261018.json`。


## 2026-10-19 OAuth/MCP 验证版

- Cloudflare Worker `a95bb093-d15b-47c5-901a-413851087e60`，sourceRevision `9991f80969e05aaca99517aeb8b553f539ddf15b3e17e797da504245b165b6c9`。只更新验证站，Sites 仍为 v201。
- OAuth 新增独立的 `PROOFWEAVE_OAUTH_CONTROL_PLANE_MODE=read_write`，服从全局冻结上限；未配置时沿用 participant 模式。授权、令牌生命周期通过独立数据库入口，研究 HTTP 和 SQL 门禁仍关闭。
- validation 只放行已明确配置的 OAuth POST 与只读 MCP POST；未知/缺失 stage、未知路径、其他写方法仍返回 503。MCP 服务继续根据工具白名单和数据库只读包装拒绝研究变更。
- 统一 OAuth discovery 与 MCP resource metadata 的 issuer 字符串，消除结尾斜杠不一致。公开检查：metadata 200、未登录 MCP initialize 401、tick 503、capabilities 200。
- 真实浏览器发现授权页缺少 HTML Content-Type，已补齐；CSP 只允许登记的客户端回调 origin。授权页现已正常渲染，显示现有 Codex Agent 和 `catalog:read` 范围。
- 47 项 OAuth/MCP/数据库/域名回归测试通过；追加 HTML 与 CSP 断言后 6 项 browser-consent 测试通过；隔离源码 typecheck、构建通过。
- 真实 OAuth 验证器只在本机 127.0.0.1:44765 等待 PKCE 回调，code/token 保留在进程内；准备在完成后撤销本次测试令牌。目前等待用户确认最终只读授权，尚未将其标记为通过。
- 本地 `run-solo-contribution-smoke.mjs` 通过：真实 Lean 主运行、两次重放、测试评审、签名回执及公开样例重放。全部使用临时本地存储与生成的测试身份，不能描述为生产 Runner 验收或独立人类评审。
- 登录页已修正“相同邮箱一定自动关联”的泛化文案。生产 Connector 的保存连接仍指向 proofweave.org 并被旧边缘 HTTP 403 拦截，未修改其配置或重新授权。
- 普通 Agent pairing 仍受 participant 冻结约束；验证完成前不能宣传新 Connector 普遍可接入。Runner 和定时任务继续暂停，DNS 未切换。


## 2026-10-19 只读授权的确认页失效诊断

- 用户已明确同意既有 Codex Agent/client 在验证站取得 `catalog:read`，此范围无需再次确认。
- 手动提交旧页返回 `invalid_request`。只读数据库核验确认该挑战的 issued_at 为 `2026-10-18T18:11:27.407Z`、expires_at 为 `2026-10-18T18:16:27.407Z`，未消费；本机旧回调同时已超时。未签发测试令牌。
- 迁移验证器新增固定本机 `/start`：每次用户打开才生成新的 state/verifier/PKCE 请求，避免跨轮复用旧页。只延长本机等待窗口至 30 分钟；服务器确认页仍为 5 分钟，单次消费、CSRF 与回调校验保留。
- 原生浏览器控件和直接页面连接仍存在无 frame/超时问题；已提供本机新入口供用户完成一次已授权的按钮提交。真实令牌/MCP 验证尚未通过，不能据此宣布迁移完成。


## 2026-10-19 真实 OAuth/MCP 只读闭环通过

- 用户完成已批准的 `catalog:read` 授权。验证器于 `2026-10-18T18:49:28.117Z`（北京时间 2026-10-19 02:49）完成，10 项真实检查全部通过。
- 通过项：PKCE 授权码兑换、最小权限范围、授权码单次消费、已认证 MCP initialize、公开目录读取、研究变更拒绝、refresh 轮换、旧 refresh 重放拒绝、新 token 读取、本次 token 撤销后 401。
- 本次 access/refresh token 仅存进程内，均已撤销；本机回调监听已关闭。未修改用户已保存的生产 Connector 连接，未启用研究写入或 Runner。
- 成功后一次性确认页再次提交会返回 `This authorization request has expired or was already used.`；不能把旧页的重复提交拒绝解释为本次验证未成功。
- 完整无凭据记录：`outputs/cloudflare-migration-20261016/mcp-oauth-live-20261019.json`。数据库诊断与验证记录均不保存 OAuth code、token、Cookie 或用户标识。
- 下一项仍是经具体确认的一次生产 Runner 验证，以及普通 Agent pairing 和正式域名切换；本次通过只证明验证站已认证的只读 OAuth/MCP 链路。

## 2026-10-19 Runner 受控执行准备

- 最新只读检查确认 Runner HTTP 200，`state: paused`，执行关闭；Turso 指纹与 Worker 一致，账本到 0048。
  队列中 28 条 acknowledged、4 条 cancelled、1 条 dead_letter，无 queued/leased 项。
- 现有 [PR #162](https://github.com/alexyyyander/proofweave/pull/162) 已追加提交
  `ebc9eedde56803403b74ed30adb0746046a8763b`，新增可选 `RUNNER_ONLY_RUN_ID`。
  领取租约前限定精确 Run；目标缺失、暂不可领取或已终结时保持空闲，不回退到其他任务。
  空白或非法配置在连接数据库前失败；并发领取和原有租约围栏保持有效。
- 隔离 PR worktree 的 `npm run runner:check` 全部通过，共 286 项；4 个相关 MJS 文件的 ESLint 通过。
  首轮本机 HTTP 测试因沙箱禁止监听端口而失败，允许本地监听后重跑通过；生产任务未被执行。
  远端 Fast protocol and static checks 已通过；完整发布 CI 按草稿 PR 策略跳过。
- 具体 Run 草案保存在 `outputs/cloudflare-migration-20261016/runner-single-run-draft-20261019.json`：
  复用公开目标 `odd-sum-square` 的 active Attempt 与现有不可变 v2 Bundle，入口 `lake env lean OddSum.lean`；
  Bundle 哈希 `sha256:3a4649c47144116b165dcd78fc63fc37bb6ba10053e7ebc2aa028227df70ff4c`。
  草案固定 Run/idempotency 标识、三个已有对象哈希、现有镜像和资源限制：60 秒 CPU、120 秒墙钟、
  2 GiB 内存、1 GiB 磁盘、1,000,000 字节输出、一次投递。不上传本地证据文件。
- 当前停在具体草案的执行确认处；新限制尚未部署，草案尚未入队。
  确认后仍需核对所属授权、校验存储对象、部署并保持暂停、设置精确 Run 限制，才能临时启用执行；
  收集终态证据后恢复暂停。一般研究写入与定时任务保持关闭，不新增模拟独立评审或贡献回执。

证据：`runner-readiness-20261019.json`、`runner-restricted-full-20261019.log` 和
`runner-single-run-draft-20261019.json`，均位于 `outputs/cloudflare-migration-20261016/`。

运维登录补充：Render 本机 CLI 凭据请求 API 返回 401；已通过既有 Google 登录恢复浏览器控制台访问。
完整环境变量页面读取被自动审批拒绝（可能暴露生产密钥），已停止该读取，没有导出、显示或修改密钥。
暂停状态依据公开 `/healthz` 核验；本次没有触发新部署或改变执行开关。

## 2026-10-19 单次生产验证结果与模板修复

用户已明确批准固定 OddSum Bundle 的一次执行。单 Run 限制提交 `ebc9eed` 已上线，三个运行开关逐项回读确认；
自动部署关闭。Run `run:3f49596e-26ab-4db0-9030-27406b19b286` 只投递了一次，模板检查、沙箱创建、
网络隔离确认、工具链探测和私有服务启动均完成，但工作区传输的最终校验返回
`runner_workspace_finalization_rejected_4xx`。未发生 `run_started`，没有 Lean 结果、内核接受或新贡献回执。

失败后已将执行开关恢复 false、重新部署并通过公开健康端点确认 paused；失败 Run 通过正式状态存储取消，
不可变队列死信和事件保留。没有自动重试或启动第二个 Run。

根因复现：现行 `patch --posix` 跳过 `/dev/null` 到新增 `OddSum.lean` 的补丁，报 `No file to patch`。
保留路径校验、forward-only 与零 fuzz，仅移除该参数后，同三个已批准对象在本机重建成功，
7 个文件的最终树哈希精确匹配 `sha256:4494b295031e40884e68ddcae8823724ac77ae12beb5339a978759e5afe286e6`。
PR #162 已追加 `47862d65708604931667ad11f3483aa819c1b9e4`，包含此修复和新增文件回归；完整 Runner 门禁 287 项通过，lint 通过。

沙箱执行 `/opt/proofweave` 中由 E2B 模板固化的运行时代码，单独更新 Render 控制进程不能替换该代码。
准备沿用基础镜像、Lean 与 Mathlib，重建固定源码覆盖层：68 个 tracked 文件，共 576,678 字节，
源清单哈希 `sha256:12c38e7b668507b4b34396333a16e4dddf431e710ab35483838ef6f7fffc36cf`。
构建命令在启动前被自动审批拒绝，理由是读取 Render 中 E2B_API_KEY 并向 E2B 上传这份源码尚缺具体授权；
因此没有读取该密钥、上传源码或创建新模板。已向用户提出明确载荷、目的地和一次新 Run 的合并确认。

下一步必须先获得该确认，再构建并绑定不可变 template/build ID，暂停部署新版本、限定新 Run、执行并核验签名结果，最后恢复暂停。
旧的单次授权额度已消费，不能据此自行追加投递。一般研究写入与定时任务持续关闭。

证据位于 `outputs/cloudflare-migration-20261016/`：
`runner-single-run-execution-20261019.json`、`runner-single-run-cancel-stopped-20261019.json`、
`runner-restored-paused-health-20261019.json`、`runner-single-run-diagnose-20261019.json`、
`runner-workspace-fix-full-20261019.log`、`runtime-overlay-manifest-20261019.json` 和 `runner-retry-draft-20261019.json`。


## 2026-10-19 模板重建、第二次运行及权限修复

用户回复“批准”后，按固定清单向原 E2B 账户上传 68 个运行时源码文件（576,678 字节），
读取原 Render 服务的 E2B_API_KEY 仅用于进程内 API 调用，未打印或保存密钥。
模板构建成功，固定 build ID `52b0c74c-5762-433d-87e0-9ce06cc1cd69`；
Render 部署到 `47862d65708604931667ad11f3483aa819c1b9e4`。

第二次 Run `run:7d5fa867-1200-4fed-a387-c175316627dd` 复用原 Bundle 和三个存储对象，只投递一次。
工作区最终校验再次返回 `runner_workspace_finalization_rejected_4xx`，没有 `run_started`、Lean 结果或新回执。
于 `2026-10-19T04:03:03.859Z` 核实 Runner HTTP 200、paused、executionEnabled=false；
随后经正式状态存储取消该 Run，保留队列死信证据。此次单次执行额度已消费。

补充复现发现：内容型补丁在私有 `umask 077` 下新增文件为 `0600`，工作区协议要求 `0644` 或 `0755`。
GNU patch 2.7.6 的 Linux 断网合成样例也复现 `0600`；改为 `0644` 后文件内容摘要不变。
实际远程失败未返回底层细节，故不能断言远程 umask 已得到确认。

修复提交 `617de06aceff921ecde577dbfb022f3c2a3d35c5` 仅规范化补丁新增文件为 `0644`；
已有归档文件的模式仍严格检查，路径、符号链接和资源限制保留，最终树哈希仍必须与签名 Bundle 一致。
相同三个对象在本机私有 umask 下重建后的 7 文件树精确匹配原签名哈希。
另加入固定、有限的阶段错误码以区分补丁、权限和树哈希错误，响应不返回研究源码或任意错误正文。
完整 Runner 门禁 290 项通过，无跳过，相关文件 lint 通过；远端 Fast protocol and static checks 通过，
Full release gate 按草稿 PR 策略跳过。新修复尚未部署到生产或 E2B 模板。

下一份具体草案为 `runner-permission-retry-draft-20261019.json`，
源码清单为 `runtime-permission-overlay-manifest-20261019.json`：68 文件、578,966 字节，
清单哈希 `sha256:a05ba6400fdf1253f908b014f2c44150688f3403e50463baa603402ff2afe530`。
由于载荷已改变且先前一次投递已消费，等待用户对新模板及一个新 Run 的具体确认；
不覆盖旧清单或审批记录，不自行追加投递。一般研究写入、定时任务及正式域名均未改变。

证据位于 `outputs/cloudflare-migration-20261016/`：
`runtime-template-built-20261019.json`、`runner-retry-execution-20261019.json`、
`runner-retry-cancel-stopped-20261019.json`、`runner-retry-restored-paused-health-20261019.json`、
`runner-retry-diagnose-private-mode-before-20261019.json`、`runner-retry-diagnose-20261019.json`、
`workspace-linux-private-mode-20261019.log`、`runner-private-mode-verified-diagnose-20261019.json`、
`runner-permission-fix-full-20261019.log`。

## 2026-10-19 生产 Runner 单次闭环通过

用户回复“批准按新草案执行一次”后，按新清单构建模板并部署精确提交
`617de06aceff921ecde577dbfb022f3c2a3d35c5`。固定模板
`cbfjgbsrgtku0c7sliu5:workspace-modes-20261019-617de06`，
build ID `4fd0e92f-9513-4c3d-8af3-6492e86c3f24`；源清单哈希
`sha256:a05ba6400fdf1253f908b014f2c44150688f3403e50463baa603402ff2afe530`。

新 Run `run:74f76456-2b07-41d6-8b3d-04906a6f4f29` 复用原 OddSum Bundle 和三个存储对象，
没有上传本地研究文件。暂停部署与配置逐项回读通过后才启用该 Run，最多一次投递。
Run 于 `2026-10-19T04:30:26.499Z`（北京时间 12:30）开始，
`2026-10-19T04:30:49.931Z` 完成；状态 `succeeded`，队列 `acknowledged`、投递次数 1、无最后错误。
Lean 内核状态 `accepted`，退出码 0；`network`、`noSorry`、`allowedAxioms`、`leanBuild` 均为 `passed`。

结果身份、Bundle/请求哈希、活跃 Runner 公钥签名和规范化结果哈希均已核验；
stdout/stderr 的存储字节、长度和内容哈希与签名结果一致，stderr 为 0 字节。
结果哈希 `sha256:817ae52cf91f3e2f66a8bef889eddf0da8393e1818f6bad97697a576e9e4e91c`。
本次跨过了前两次失败的工作区最终校验；没有记录远程原始 umask，不能据此追溯断言前次底层错误。

完成后自动关闭执行并重新部署，`2026-10-19T04:32:29.133Z` 核实 HTTP 200、
`state: paused`、`executionEnabled: false`、精确 revision 与新模板 build 一致。
单 Run 限制和一次投递限制保留，自动部署关闭。一般研究写入、定时任务和正式 DNS 未改变。
前两次失败与取消记录保留，本次一次投递额度已消费，不追加运行。

此结果证明指定 OddSum Bundle 在固定工具链和策略下通过本次 Runner/Lean 检查；
不替代独立研究评审、完整贡献回执流程或正式域名上线验收，TRON 存证也不证明数学正确性。

无凭据证据位于 `outputs/cloudflare-migration-20261016/`：
`runner-production-controlled-closure-20261019.json`、`runner-permission-retry-verify-20261019.json`、
`runner-permission-retry-execution-20261019.json`、`runner-permission-retry-restored-paused-health-20261019.json`
以及 `runtime-permission-template-built-20261019.json`。


## 2026-10-19 连接控制面与正式域名准备

用户明确批准连接控制面部署后，Cloudflare 版本更新为
`cf8e450a-3f27-4665-9a40-b5ca8fb0c89a`，源码摘要
`001aaf3f3ab4d6d53ca4fc7b26a7230f9addbe43a2217faf51eb05ae7902d6f2`。
连接写入使用受限数据库能力，仅允许 Agent、公钥、委托、安装与 OAuth 生命周期操作。
研究、Run、评审、回执写入仍由独立门禁阻止；Runner 暂停，定时任务关闭。
22 项局部门禁测试和一项编译后 Worker 完整配对流程通过，typecheck、lint 和构建通过。

用户批准一次临时配对验证并亲自在浏览器确认后，真实 OAuth/MCP 验证 10 项全部通过：
授权码交换与单次消费、精确范围、MCP 初始化和目录读取、研究写入拒绝、刷新轮换与单次消费、
新令牌读取和撤销后拒绝。完成时间 `2026-10-19T05:04:09.983Z`。
临时 Agent、安装、委托、客户端及令牌已撤销；独立只读回查确认活跃测试访问令牌和刷新令牌均为 0。
回调监听器已关闭。此结果不表示已验证正式域名上的原生产 Connector。
证据：`connection-oauth-live-20261019.json`、`connection-cleanup-readback-20261019.json`。

Runner PR #162 已转为待评审，精确提交 `617de06` 的完整发布 CI 通过：
<https://github.com/alexyyyander/proofweave/actions/runs/39200944565>。
主分支仍要求一份批准评审，尚未满足；未绕过规则合并。

登录 Spaceship 后核对到完整 4 条 DNS 记录（两条根域 A、两个验证 TXT），TTL 均为 1800 秒。
现有 DNSSEC 已启用，自动 DS 为 Key Tag 19120、算法 13、摘要类型 2；
`.org` 父区权威查询确认 DS 原始 TTL 为 3600 秒。Cloudflare 仍为 pending，
已导入 3 条记录，缺少 `_openai-site-verification` TXT，尚未补入。
现有 Wrangler OAuth 的 DNS/DNSSEC 查询返回 403 / 10000，Zone 与 Worker 域名 API 查询成功。
浏览器可读取 Cloudflare 记录，但类型下拉框和滚动操作不稳定；未提交不完整表单。

Worker Custom Domain 变更预览通过，无冲突；该预览不绑定域名，也不签发证书。
官方要求 Zone 激活后添加 Custom Domain。切换需先保存完整 DNS 和旧 DS/NS，
经本人确认临时关闭旧 DNSSEC，核实父区 DS 移除并等待至少 3600 秒缓存期，
补齐 Cloudflare 记录且准备可用的过渡解析后，才切换名称服务器。
新权威 DNS 稳定后绑定 Worker、核验证书与正式登录回调，再发布并验证 Cloudflare 新 DS。
不能保留旧 Cloudflare SaaS IP 作为最终的橙云 Worker 源站；过渡解析必须先验证。
正式 Sites 桥接接收方变更仍需具体确认，Google 正式回调已获此前批准。
截至本记录，DNS、DS、NS、正式回调信任和 Worker 域名绑定均未改变。

完整记录、回退参数与验收门禁保存在
`spaceship-dns-inventory-20261019.json`、`domain-api-preflight-20261019.json`、
`formal-domain-cutover-plan-20261019.json` 和 `migration-status.json`。


## 2026-10-19 DNSSEC 过渡已开始，等待旧 DS 缓存到期

用户明确批准临时关闭旧 DNSSEC 并按方案恢复后，在 Spaceship 确认“Disable DNSSEC”，
页面显示“DNSSEC disabled”。随后 `.org` 三个权威节点均返回无 DS 的权威 NOERROR 应答。
统一确认时间 `2026-10-19T05:42:11.561649Z`，旧 DS 原始 TTL 为 3600 秒；
最早可继续 NS 切换的时间为 **2026-10-19 北京时间 14:42:12**，且切换前需再次核对无 DS。
当前 DNSSEC 处于获准的临时关闭状态，尚未恢复，不得将此阶段描述为 DNSSEC 迁移已完成。

Cloudflare 灰屏通过新标签页恢复。补入 `_openai-site-verification` TXT 后，页面显示 4 条记录，
直接查询 Brian/Edna 权威服务器也读到正确记录。两条旧 Sites A 记录已在尚未激活的 Cloudflare
Zone 中设置为 DNS-only，保留当前解析作为激活前后的过渡；尚未绑定 Worker 自定义域名。
当前正式站 HTTPS 返回 200，TLS 校验结果为 0。名称服务器仍为 Spaceship，未切换。
证据：`dnssec-transition-approval-20261019.json`、`dnssec-parent-removal-20261019.json`、
`cloudflare-dns-prepared-20261019.json`。

只读回查发现原 Sites 已更新到 v203（提交 `f208f6b76c14633c788372c67403adb69b93bc61`），
部署成功，环境 revision 56；后续调整桥接配置必须保留该最新保存版本，不能回退部署 v201。
当前导出的环境条目均隐藏值。桥接发行端实际使用 `SITES_BRIDGE_CLIENTS_JSON` 允许列表，
正式配置草案已据实现修正；不是向发行端写入接收端的两项变量。
新增正式接收方的具体确认已请求，尚未应用。Worker 正式域名配置草案已核对目标账户、
回调一致性、研究只读和无 cron，尚未部署。


### 正式接收方桥接配置已应用

用户随后明确允许“加入正式站并应用配置”。仅更新 `SITES_BRIDGE_CLIENTS_JSON`，
加入正式客户端 `proofweave-cloudflare` 和固定接收方 `https://proofweave.org`，
过渡期保留原验证客户端。原 Sites v203 以环境 revision 57 部署成功，
部署 ID `appgdep_6ad5aeca1e108191b09f894c3a0a5723`，保留代码与桥接密钥。
匿名 GET 的缺失状态请求按预期返回 400 重试页；新旧客户端的重试目标分别匹配正式站和验证站。
这只验证客户端允许列表与固定接收方配置，不表示完成正式站用户登录。
Cloudflare 接收端尚未改为正式域名，NS 尚未切换，等待 14:42:12 的安全门禁。
证据：`formal-bridge-trust-approval-deployed-20261019.json`、
`formal-bridge-allowlist-preflight-20261019.json`。


## 2026-10-20 PR #162 合并与暂停部署完成

thudubdoo 于 15:52:49（北京时间）对固定 `b54b5a8` 提交有效批准；main 的一份批准规则正常满足。
16:06:33 按 merge commit 合并为 `13c07955d7fc85e9ff6f47102d0a9d8806339aad`，未使用 admin/bypass。
main 自动触发的完整 CI 于 16:09:55 完成，通过后手动部署同一完整 SHA。
Render 于 16:12:20 完成部署，16:13 的只读回查确认 HTTP 200、paused、执行关闭、自动部署关闭。
账本头 0049、数据库指纹及源版本一致，迁移诊断 ready / failureCode=null。
只进行了代码部署和只读校验；没有应用迁移、重建模板、发送 wake 或追加研究 Run。
用于等待批准的 `pr-162` 后台任务已暂停，未恢复锚定定时任务。
