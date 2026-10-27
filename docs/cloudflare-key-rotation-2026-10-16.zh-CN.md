# Cloudflare 签名密钥轮换方案

本文保留 2026-10-16 的密钥轮换过程和当时观察，不作为当前部署或开放指令。
后续合并、0049 和暂停部署状态见[迁移最新总览](cloudflare-migration-2026-10-16.zh-CN.md)。

状态：回执密钥已于 `2026-10-16T09:53:14.135Z` 完成轮换。旧公钥退休保留，新公钥已激活。
旧 Sites v196 已用环境修订 54 重新部署并冻结研究写入；Runner 仍未启用。
两组新 Ed25519 密钥已在本机生成，通过签名/验签配对检查。私钥文件权限为 0600，
目录为 0700，位于 Git 忽略的迁移输出目录中；不会进入代码仓库。

## 核验到的现状

| 项目 | 当前值 |
| --- | --- |
| Cloudflare 目标 | 账户 `536799122b9ceaba8d5dc6d0570bbfc8` / Worker `proofweave` |
| 原控制面 | Turso，指纹 `3f9e7934a04a22ec` |
| 数据库实际有效回执 key ID | `issuer:build-week-live-v1` |
| 旧 Sites 配置的回执 key ID | `receipt-issuer:sites-alpha-2026-07-17`，与登记不一致 |
| Runner 当前队列验签 key ID | `control-plane:sites-render-free-2026-07-23` |
| Runner | Render `srv-d9gs77rrjlhs73d1hdgg`，执行开关为 false |
| 队列统计 | acknowledged 28、cancelled 4、dead_letter 1；没有 queued / leased |

回执轮换必须以数据库的有效登记为前驱，不能直接照抄旧 Sites 配置。
这些状态在实际执行前需要重新读取，防止准备期间发生变化。

## 已配置的新公钥

| 用途 | 新 key ID | 公钥 |
| --- | --- | --- |
| 回执签名 | `receipt-issuer:cloudflare-2026-10-16` | `wCKr1gD89vc5MbOqsbTYpvACAcxG6ATHEa0vdOKHeyA` |
| 队列签名 | `control-plane:cloudflare-2026-10-16` | `GzQiE4S_Sev6XtJE7FF2-3aDj9rJ59HBFpZ6fXV60Rc` |

机器可读方案：`outputs/cloudflare-migration-20261016/key-rotation-plan.json`。
其中记录目标资源、预期前驱公钥、保留旧公钥后的 Runner 列表，以及本机私钥文件位置；
不含私钥值。`proposed-signing-keys.json` 保存配对验证结果。
本地公钥登记和便携回执验证测试已通过 5/5，覆盖退休后历史验证及撤销行为；
日志在 `outputs/cloudflare-migration-20261016/key-rotation-tests.log`。

## 执行顺序

1. 再次读取数据库有效公钥、队列和双方配置，与方案的预期值逐项比较；不一致则停止。
   保存现有公开回执和公钥集合，先验证一遍历史证据。
2. 在切换维护窗口冻结旧 Sites 的 participant/MCP 写入，保持 Runner 执行暂停。
   Cloudflare 新站继续禁止研究写入，避免双入口同时签发。
3. 将两组新私钥写入目标 Worker 的加密 Secrets。配置中的 key ID、公钥必须与私钥
   配对验证结果一致。向 Render 的 `RUNNER_CONTROL_PLANE_ISSUER_KEYS_JSON` 追加新公钥，
   保留原公钥；不更改 Runner 的结果签名密钥。
4. 使用现有 `D1ContributionReceiptIssuerKeyStore.rotate()`，在一个事务中将
   `issuer:build-week-live-v1` 标为 retired，并登记新 issuer 为 active。
   轮换时间在执行时确定，并同时写入新站的 `RECEIPT_ISSUER_ACTIVATED_AT`。
   不执行 revoke，不删除旧公钥或历史事件。
5. 配置原 Runner 唤醒凭据和 Nile 测试网 adapter；新 Worker 只获得运行所需的凭据。
   禁止复制 `.env.local` 中的旧 EVM adapter；暂停的定时任务保持暂停。
6. 验证历史回执仍可信、新旧队列签名均能验签、新 issuer 只能在生效时间之后签发。
   完成 Google 回调/会话/退出、MCP/OAuth 和研究流程验证，再开放对应写入能力。
   Runner 的启用应有独立验证与范围控制，不能随环境变量复制而自动开启。
7. 最后绑定正式域名、切换 Spaceship 的 nameservers，验证 DNS、TLS 与原域名入口。
   此前原域名继续使用旧部署。

## 为什么不能只替换私钥

回执的可信性依赖 key ID、公钥和有效时间。只改 Secret 会使新签名无法通过旧公钥验签；
把旧公钥撤销则会影响历史回执。现有模型支持“退休后保留历史验证”，本次使用这一机制。
Runner 保留旧公钥，因此已有签名记录不必重签。

## 回滚边界

密钥生命周期是审计历史，轮换后不能通过删除事件或重新激活前驱来回滚。
若切换失败，可以先把网页流量恢复到旧 Sites 的只读入口；若需要恢复旧入口写入，
必须给它配置已登记的新密钥，不能重新使用退休密钥。数据库和历史回执不做回滚。

## 执行结果

- 两组签名私钥已写入指定 Worker；线上公钥接口确认旧 issuer 为 retired、新 issuer 为 active。
- 数据库中 2 份历史回执重新验签与历史信任检查通过；退休密钥被拒绝继续签发。
- 用户逐项授权后，Runner 唤醒令牌、tick 令牌和 Nile adapter 已写入 Worker。
- Render 公钥配置保留旧 key 并添加新 key；受信旧 key 的 10 条历史队列签名及新 key 的内存测试签名通过，测试消息未入队。
- 23 条更早的已完成/取消队列记录属于其他历史 issuer，未扩大信任列表，也未声称通过本次验签。
- Runner 最初重载因源码仅到 0045、数据库已到 0048 而失败。补齐原始迁移文件后，提交
  `19fa30db01502c0f7659651cd83521f61ff5b51c` 已上线，健康接口返回 200、paused、账本 0048。
  新进程已加载更新后的环境配置，执行开关保持 false；暂停分支不会实例化实际执行器，
  因此队列验签结论来自同一公钥配置的独立核验，不能声称真实任务已执行。
- 机器记录：`receipt-key-rotation-result.json`、`runtime-secrets-result.json`、`runner-signature-verification.json`。
- 修复草稿 PR：[#162](https://github.com/alexyyyander/proofweave/pull/162)，27 项相关测试通过。
- Google 回调/退出、研究执行闭环和域名切换仍待完成，密钥配置完成不等于迁移全链路完成。
