# Sites 入口 403 排查材料

此材料供站点所有者转交 Sites 平台管理员；尚未发送给任何第三方。

## 本机授权补查

用户已授权使用相关本地配置和已有登录。补查确认 Chrome 存在 Cloudflare 账户登录，本机 Wrangler 也有原 OAuth 配置；因此不能把“Sites 工具没有规则管理接口”等同于“用户没有任何管理权限”。

Wrangler 配置中的访问令牌到期时间为 `2026-08-17T12:55:57.037Z`，官方 `whoami` 报告过期且刷新失败。已按原有 scopes 尝试官方 OAuth 登录恢复，未扩大权限。自动化未能读取 Consent Application 正文，但用户截图能看到页面停在 `Authorizing…`；因此不能据自动化的空白画面判定页面没有加载。

其中一次回调被 Wrangler 明确报告为 state 不匹配，未写入新令牌；可能是旧授权页回到了后来启动的登录会话。另有等待回调超时。后续使用单一登录进程与对应的新授权页重试，保留 state 校验。尚未取得成功登录后的账户区域清单，不能宣称已有对应拦截规则的修改权限。

用户在 16:18 提供的截图显示，授权后已跳回 `localhost:8976/oauth/callback`，但得到 `ERR_CONNECTION_REFUSED`，与本地回调服务此前超时退出一致。随后临时运行官方 Wrangler 4.151.0 的 `login --device --browser=false`，改用无需 localhost 回调的设备授权流程（最长等待五分钟），未修改项目依赖。请求权限取原配置与新版支持列表的交集，仅移除新版不支持的 `websearch.run`，未增加权限。设备授权是否完成需以 CLI 结果和后续账户查询为准。

首次设备授权的浏览器页面已显示 `Authorization granted to Wrangler`，但 CLI 轮询令牌端点反复 `ECONNRESET`，另见 IPv6 连接超时，最终退出且本地凭据未更新。无凭据连通性测试确认 IPv4 优先的 Node 请求可收到令牌接口 HTTP 400（预期的无效请求响应）。随后以 `--dns-result-order=ipv4first` 重试官方设备流程，初始轮询已收到 HTTP 响应、无连接重置；这不等于最终登录成功，仍须等授权后核验。

第二轮设备授权最终也未完成：页面先提示无法连接授权服务，重试 Continue 后进入权限确认流程；16:31 的截图随后返回 `access_denied`，具体原因为 `The consent verifier has already been used.`。CLI 五分钟后超时退出，原凭据文件的修改时间和过期时间均未更新。后续日志仍有少量连接重置，因此 IPv4 优先只改善了初始连通性，不能称为网络问题已修复。停止重复该授权会话；此错误不能证明账户缺少站点管理权限。

域名绑定历史记录与当前 DNS 查询均显示 `proofweave.org` 的 NS 为 `launch1.spaceship.net` / `launch2.spaceship.net`，A 记录为 Sites 提供的 `162.159.143.30` / `172.66.3.26`。需要进一步区分域名 DNS 管理权限与 Sites 上游 Cloudflare 区域权限；不要仅凭某个 Cloudflare 账户已登录就修改无关区域。

16:35 用户截图进一步确认：该账户内已有 `proofweave.org` 的接入配置，页面位于 `confirm-scanned-records`，显示 `Review your DNS records`、扫描到 2 条 A 与 1 条 TXT、`DNS Setup: Full`。同轮实时 DNS 查询仍返回上述 Spaceship NS 与 Sites A 地址。由此可确认，这个账户里的 Full 接入尚未成为当前生效的权威 DNS 配置；不能把这里的安全菜单当作已定位到线上 Sites 拦截规则。仅为排查 403 而推进 NS 切换或打开额外代理，没有充分依据。

## 需要平台侧处理

最新复查仍显示项目 `active/public`、owner 权限、版本 194、`disabled_by=null`，自定义域名/provider/TLS 均 active。近 30 分钟 Worker 日志存在 `/history`、`/explore`、`/publications/openai-math/034` 的 HTTP 200，因此不能描述为全站对所有访客不可用。

本机最新无鉴权只读探测：`GET /` 返回 Cloudflare HTML 403，Ray ID `a4b5c938ab967d8f-LAX`；`GET /api/anchors/anchor-batch:ceaa9f2b-a45d-4933-9c4b-79b26954f7b9` 返回同类 403，Ray ID `a4b5c9300c1268e6-LAX`。本轮 Sites 默认地址探测为 `ECONNRESET`，不是已取得 HTTP 403。

Worker 日志的账户 ID 为 `7979fbd212715c4874b937da9cb25d4f`，不同于浏览器中用户个人 Cloudflare 账户 `536799122b9ceaba8d5dc6d0570bbfc8`。这进一步表明个人账户中新建域名接入不是已确认的拦截规则管理入口。应由 Sites 平台查询上述 Ray 对应的边缘安全事件，返回命中的规则及可支持的授权调用方式；目前工具未提供该层规则查询或修改能力。

请使用 Cloudflare Ray ID `a4b4570c2d6f2ae4-LAX` 检索入口安全事件，确认命中的规则、规则归属和处理方式。若请求应当获准，请仅修正对应的错误配置，保留站点及锚定接口鉴权。不要整体关闭 WAF 或扩大站点访问范围。

- 日期：2026-10-16（Asia/Shanghai）。精确事件时间以 Ray ID 对应的服务端记录为准。
- Sites project：`appgprj_6a54400d01a8819199224b722afae056`。
- 自定义域名：`https://proofweave.org`。
- Sites 官方地址：`https://proofweave-research.yualex031821.chatgpt.site`。
- 最新失败请求：`POST /api/internal/anchors/tick`，HTTP 403，Content-Type `text/html`，本地诊断 `edge_blocked`。
- 该接口使用独立的应用级 Bearer 鉴权；不要将凭据放入工单。

## 已确认的事实

1. Sites 管理接口仍可读取该项目：`active`、`public`、版本 194、未标记 disabled。
2. v194 的再次部署返回 `succeeded`，部署 ID 为 `appgdep_6ad1a7d6ee3c819199f5017e097a6277`，环境 revision 53。
3. 2026-10-16 的域名刷新结果：域名、provider、TLS 状态均为 active。
4. 之前对自定义域名及官方地址的只读请求均收到 Cloudflare HTML 拦截页；官方 Sites 服务鉴权探测同样返回 403，Ray ID `a4b44fe6eaf8c173-LAX`。
5. 再发布后的 Worker 日志有首页、工作台和研究页 HTTP 200。这个事实不能证明当前执行环境的锚定请求可达，也不能据此确定具体拦截规则。
6. 生产迁移 0048 已验证；原有 Nile 测试网存证经无私钥 CLI 核验为 verified。新版 hosted tick 和 R2 HTTP 验收仍未通过。
7. 自动任务 `proofweave-nile` 保持 PAUSED。没有为排查而创建新站点、改域名、放宽鉴权或重新启用调度。

## 修复后验收

在原执行环境手工运行既有脚本，凭据继续只从忽略提交的本地文件读取：

```sh
node scripts/run-hosted-anchor-tick.mjs --credentials outputs/anchor-production-closure-20261015/tick-credentials.json
```

检查真实 HTTP 状态及 `status`、`batchCreated`、`confirmedBatches`、`failedBatches`、`errors`。随后验证 `/api/anchors` 和已有批次的公开 manifest 是否可读，并检查 R2 来源响应头。正常空队列不应产生新交易。

即使验收通过，也继续保持自动任务暂停，除非用户另行要求恢复。Nile 存证不构成数学正确性证明。
