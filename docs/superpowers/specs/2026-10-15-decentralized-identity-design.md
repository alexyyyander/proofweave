# 子项目 A 设计：去中心化身份 + 钱包登录 + 可验证凭证

日期：2026-10-15
状态：待评审
范围：Proofweave Web3 路线的子项目 A（B 防篡改锚定已交付；C 链上结算为后续）
依赖顺序：阶段 1 DID → 阶段 2 钱包登录 → 阶段 3 VC（三阶段可独立交付）

## 1. 目标与非目标

### 1.1 目标

- 给平台 Person/Agent 提供 W3C 标准的去中心化标识符（did:web）与可解析 DID 文档。
- 新增第四种登录方式（链上钱包，SIWE/EIP-4361），通过链适配层支持 EVM 先行、Solana 预留，摆脱对 OpenAI/Google 账号的入口依赖。
- 把贡献收据与委派证书签发为 W3C Verifiable Credentials（VC 2.0 + DataIntegrityProof），第三方可离线验证归属与授权。

### 1.2 非目标（本子项目不做）

- 不做链上身份注册/身份锚定（哈希锚定属子项目 B，已交付）。
- 不做 KYC、信用评分或身份等级。
- Solana 登录只留桩（接口 + 明确"未实现"错误），不做实现。
- 不建 VC StatusList 撤销列表（撤销语义 = 平台记录状态）。
- 不把 email、display_name 等 PII 写进 DID 文档或 VC。
- 不改变现有 ChatGPT/Google/Demo 登录的行为。

## 2. 阶段 1：DID 标识符与文档（did:web）

### 2.1 标识符规则

- Person：`did:web:proofweave.org:did:person:<uuid>`，解析为 `https://proofweave.org/did/person/<uuid>`。
- Agent：`did:web:proofweave.org:did:agent:<agentId>`，解析为 `/did/agent/<agentId>`。
- 钱包账户：`did:pkh:eip155:<chainId>:<address>`（地址小写），仅作为关联 Person 文档的 `alsoKnownAs` 出现，不创建独立 DID 文档。

did:web 的冒号段按 W3C did-web 规范解码为路径：`did:web:proofweave.org:did:person:X` → `https://proofweave.org/did/person/X`。**字符集约束（防解析歧义）**：DID 路径段不得包含 `:`（与既有 agentId 字符集冲突处，含 `:` 的 agentId 不签发 DID，构造函数明确抛错）；`parseDidWeb` 拒绝 fragment、空段、`..`、以及不能 round-trip 的百分号编码段。

**平台根 DID（收据 VC 的 issuer）**：`did:web:proofweave.org`，文档由 `/.well-known/did.json` 提供（阶段 1 交付的一部分），携带收据签发公钥（`RECEIPT_ISSUER_PUBLIC_KEY`）的 verificationMethod——使收据 VC 的 issuer/verificationMethod 不悬空。

### 2.2 DID 文档

```json
{
  "@context": ["https://www.w3.org/ns/did/v1",
               "https://w3id.org/security/suites/ed25519-2020/v1"],
  "id": "did:web:proofweave.org:did:person:<uuid>",
  "verificationMethod": [{
    "id": "did:web:...#key-<公钥指纹 sha256 前 16 hex>",
    "type": "Ed25519VerificationKey2020",
    "controller": "did:web:...",
    "publicKeyMultibase": "z<base58btc(Ed25519 32 字节原始公钥)>"
  }],
  "authentication": ["did:web:...#key-<同上>"],
  "alsoKnownAs": ["did:pkh:eip155:8453:0x..."],
  "created": "<注册时间>", "updated": "<最近更新时间>"
}
```

- verificationMethod 从 `person_keys`（Person）或 `agents`（Agent）现表投影；`publicKeyMultibase` 的底层数据与现有 Ed25519 公钥（base64url 存储）同源，格式转换在投影时完成。
- method 的 fragment 用**公钥指纹**（如 `#key-<sha256 前 16 hex>`），不用插入序号——确定性、跨实例稳定。
- **撤销即失效**：`person_key_revocations` / `agent_installation_revocations` 生效的密钥不出现在文档中；全部密钥被撤销时返回空 verificationMethod 数组（文档仍在，可验空性）。
- **隐私**：文档只含公钥与公开 ID；不含 email、display_name、任何 PII。`alsoKnownAs`（钱包地址）是公开关联——仅在用户显式绑定后展示（绑定即同意公开关联），解绑后从文档移除。
- 未注册的 person/agent → 404。文档响应 `cache-control: no-store`（撤销需即时生效）。

### 2.3 组件

| 文件 | 职责 |
| --- | --- |
| `packages/protocol/did-web.mjs` | 纯函数：`personDid(personId)`、`agentDid(agentId)`、`parseDidWeb(did)`、`resolveDidDocument({kind, id, keys, walletAccounts, createdAt, updatedAt})`、base58btc/multibase 编码工具（零依赖实现） |
| `app/did/[kind]/[id]/route.ts` | GET 文档（Person 与 Agent 两种 kind：Person 投影 `persons`+`person_keys`+`person_key_revocations`；Agent 投影 `agents`+`agent_installation_revocations`）；撤销判定与既有代码一致（`COALESCE(key_revocation.revoked_at, key.revoked_at)` 双机制）；404 语义见上；平台根文档 `/.well-known/did.json` 亦由此模块提供 |
| `app/lib/did-routes.ts` | 路由的可测试逻辑层（模式同 `app/lib/anchor-routes.ts`） |

数据模型：无新表。

## 3. 阶段 2：钱包登录（SIWE 链适配层）

### 3.1 适配器接口

```js
// services/identity/wallet-chain-adapter.mjs（JSDoc 标注）
{
  id,  // "evm" | "solana"
  async buildChallenge({ domain, uri, nonce, statement, chainId }) -> { message },
  async verifyChallenge({ message, signature, expected }) -> { address, chainId }  // 失败抛 WalletChallengeError
}
```

- **`expected` 是服务端重建的期望上下文**（`{ domain, uri, nonce, chainId, statement }`——从 cookie/DB/配置推导），**绝不接受客户端传入的 prepared**：verify 逐字段比对 message 与 expected，任何不一致抛错。这使钓鱼域/篡改的 SIWE 消息无法通过。

- **EVM 适配器（实现）**：构造标准 EIP-4361（SIWE）消息文本（domain、address、uri、version、chainId、nonce、issuedAt、expirationTime、statement）；`verifyChallenge` 先做消息字段完整性校验，再用 `personal_sign` 语义做 `ecrecover`（使用已装 ethers 的 `verifyMessage`），恢复地址必须与消息声明的 address 一致，chainId 必须在白名单内。零新增依赖。
- **Solana 适配器（留桩）**：所有方法抛"not implemented"；Sign-In With Solana（signMessage + Ed25519）后续填充。
- `resolveWalletAdapter(id)` 注册表 + 配置校验，模式与锚定的 `anchor-chain-adapter.mjs` 一致。

### 3.2 登录流程

```
POST /auth/wallet/start    → 生成 32 字节随机 nonce；nonce 原文写入 __Host-pw_wallet_flow cookie
                             （HMAC 签名复用抽出的 signed-flow-cookie 帮助函数；HttpOnly、Secure、
                             SameSite=Lax、Path=/auth/wallet、10 分钟，含 return_to 与 intent=login|link）；
                             DB 的 wallet_auth_challenges 只存 sha256(nonce)（库泄露不泄露可用 nonce）
                             密钥用独立 WALLET_FLOW_SECRET（未配置 → 钱包登录整体不可用，不回落 Google 密钥）
GET  /auth/wallet/challenge → 从 cookie 取 nonce 原文，按 expected 上下文构造 SIWE 消息返回
POST /auth/wallet/verify   → { message, signature }
                             ①条件原子消费：UPDATE wallet_auth_challenges SET consumed_at=?
                               WHERE nonce_hash=? AND consumed_at IS NULL AND expires_at > now
                               ——以 changes()==1 作为唯一放行依据（双提交/重放竞态只放行一个）
                             ②**字节级比对**：服务端按 expected 重建完整 SIWE 消息字符串，
                               要求 message === expectedMessage（不做字段级解析比对，杜绝解析器分歧）
                             ③ethers.verifyMessage（personal_sign 前缀）恢复地址 == 消息地址
                               （签名畸形/长度错 → WalletChallengeError → 400，不得 500）
                             ④chainId 白名单 → ⑤同一 batch() 内写会话（消费与会话同事务，防"消费了没发会话"）
```

- 会话复用现有 `__Host-pw_session` 30 天会话路径；登录页第四入口 "Continue with Wallet"，受 `WALLET_LOGIN_ENABLED=true` 门控（默认关）。
- 现有 ChatGPT/Google/Demo 登录行为不变。

### 3.3 Person 合并规则（安全要点）

- 钱包登录**默认创建新 Person**：`person_identities` 新增 `provider="wallet"`、`provider_subject="did:pkh:eip155:<chainId>:<address>"`、email 为 NULL、`email_verified_at` 为 NULL（现表结构已允许）。displayName 取截断地址（如 `0x1234…abcd`）。
- **地址优先解析（单行模型）**：`did:pkh` 含 chainId，同一地址在不同链产生不同 subject，但密钥是同一把。解析顺序强制为：①按 `wallet_address`（小写）查既有身份行 → ②按 `(provider, subject)` → ③创建新行。**一个地址只有一行 wallet identity**（`provider_subject` 更新为最近登录的 did:pkh），所有已接受 chainId 的登录进入同一 Person。`person_identities` 迁移增加可空列 `wallet_address`（小写）+ 部分唯一索引（`WHERE provider='wallet'`）。
- 不做"同邮箱合并"——钱包身份没有 email；合并只能通过**显式绑定**：已登录用户在 `/settings` 提交"绑定此钱包"，复用同一三条路由（SIWE statement 带 link 语义，intent 通过签名 flow cookie 传入，登录/绑定消息不可互换），写入 wallet identity 指向现有 Person。
- 绑定冲突：并发绑定同一地址由部分唯一索引裁决，失败方返回 409 `wallet_already_bound`（不是 500）；已绑定其他 Person → 同样 409。不做自动迁移。解绑 = 删除 identity 行 + DID 文档 `alsoKnownAs` 随之消失。

### 3.4 防重放与传输安全

- nonce 单次消费：`consumed_at` 在 verify 成功事务内写入；已消费/过期 → 400 `invalid_challenge`。
- 时间窗：challenge 有效期 `WALLET_CHALLENGE_TTL_SECONDS`（默认 600）；SIWE `expirationTime` 同步。
- domain/uri 必须精确等于当前请求 origin（防跨域钓鱼）；cookie 签名密钥复用现有会话签名体系。
- 适配器层不得接受任何客户端提供的"已验签"声明——验签只发生在服务端。

### 3.5 组件与数据模型

| 文件 | 职责 |
| --- | --- |
| `services/identity/wallet-chain-adapter.mjs` | 接口、注册表、`resolveWalletAdapter`、配置校验 |
| `services/identity/evm-wallet-adapter.mjs` | SIWE 构造 + 验签（ethers 动态引入，仅在适配器内） |
| `services/identity/solana-wallet-adapter.mjs` | 桩 |
| `app/auth/wallet/start|challenge|verify/route.ts` | 三条路由（薄），逻辑放 `app/lib/wallet-auth.ts`；start/verify 加每 IP 限频（复用 remote-MCP 限频模式）；响应 `no-store` |
| `app/lib/wallet-auth.ts` | 可测试逻辑：challenge 创建/校验、**地址优先的 identity 解析**（`wallet_address` → `(provider,subject)` → create）、cookie 处理、`return_to` 两侧走 `safeRelativeReturnPath` |
| `packages/auth/signed-flow-cookie.mjs` | **新共享模块**：从 `packages/auth/google-oidc.mjs` 抽出的 HMAC 签名 flow cookie 帮助函数（Google 与 wallet 共用；wallet 用独立密钥 `WALLET_FLOW_SECRET`，缺省拒绝启用） |
| `app/auth.ts`（修改） | `AuthUser.provider` 联合加 `"wallet"`；`email` 改为可空（`email: string \| null`）；`getCurrentUser` 放行 wallet 会话（现在只认 `google\|proofweave` 且要求 email 非空——不改此处钱包登录会**静默变匿名**）；`providerLabel = "Wallet"`；`toPersonIdentity` 对 wallet 不再强制 `emailVerified: true` |
| `db/repositories/delegation.ts`（修改） | `PersonIdentity.provider` 联合加 `"wallet"` |
| `db/schema.ts`（修改） | `persons.identityProvider` 枚举值加 `"wallet"` |
| 迁移 `0049_add_wallet_auth.sql` | 新表 `wallet_auth_challenges`（`id, nonce_hash(唯一), created_at, expires_at, consumed_at`）；`person_identities` 加列 `wallet_address TEXT NULL` + 部分唯一索引（`WHERE provider='wallet'`） |
| 迁移 `0050_add_delegation_credentials.sql` | 新表 `delegation_credentials`（`delegation_id(唯一), vc_payload_hash, canonical_vc, created_at`） |
| `app/auth/wallet/*` 限频与清理 | 过期 challenge 行定期清理（tick 或查询时顺带删除） |

配置：`WALLET_LOGIN_ENABLED`（默认关）、`WALLET_ACCEPTED_CHAINS_JSON`（默认 `[8453,1]`）、`WALLET_CHALLENGE_TTL_SECONDS`（默认 600）、`WALLET_FLOW_SECRET`（flow cookie HMAC，独立密钥）。

**适配器语义限制（如实声明）**：EVM 验签仅支持 EOA（`personal_sign` + ecrecover）；ERC-1271 智能合约钱包（Safe/Argent）不在支持范围，尝试登录返回明确 `unsupported_wallet_type`。SIWE 消息 `version` 固定 `"1"`，nonce 字符集限定 `[A-Za-z0-9]{32}`。

## 4. 阶段 3：W3C Verifiable Credentials

### 4.1 协议模块

```js
// packages/protocol/verifiable-credential.mjs（纯函数，零外部依赖）
export async function createVerifiableCredential({ credential, signingKey, verificationMethodId })
  // proof.type = "DataIntegrityProof", cryptosuite = "proofweave-ed25519-2020",
  // proofPurpose = "assertionMethod"，proof.created = credential 的 issuedAt（确定性），
  // 对 canonicalJson(credential 去除 proof 字段) Ed25519 签名，proofValue = "z<base58btc(64 字节签名)>"
export async function verifyVerifiableCredential(vc, { trustedIssuerKeys }) -> { valid: boolean, reason?: string }
  // 结构白名单 + proof 重算比对；**密钥信任源是必选参数**——验证方必须提供受信公钥集合，
  // proof.verificationMethod 必须解析到其中之一；不存在"自带公钥自证"的验证路径
```

与仓库既有签名同构：canonical JSON（`packages/protocol/canonical-json.mjs`）+ WebCrypto Ed25519——VC 是既有签名链的 W3C 标准外壳。**诚实声明**：canonicalization 采用 Proofweave canonical JSON（非 RDF DCAT），cryptosuite 用命名空间化的 `proofweave-ed25519-2020` 而非 W3C 注册套件——标准 W3C 通用验证器**不能**直接验证，核验需使用 Proofweave 验证器（`POST /api/credentials/verify` 或 `packages/protocol` 引入）。

### 4.2 两种凭证

| VC | type 额外值 | 签发者密钥 | credentialSubject | 说明 |
| --- | --- | --- | --- | --- |
| 收据 VC | `ProofweaveContributionReceipt` | 收据签发密钥（现有 `RECEIPT_ISSUER_*`，服务端托管） | `id` = 受益 Person DID；`receiptId`、`receiptHash`（既有收据规范哈希）、`contributionKind`、`policyVersion` | 仅已签发且未撤回的收据可签；密钥未配置 → `issuer_unavailable`（不伪造）。**确定性**：`validFrom` 取 `receipt.issuedAt`（非请求时间），同输入字节相同 |
| 委派 VC | `ProofweaveDelegation` | **Person 本人密钥——签发发生在所有者浏览器的批准流程中**（服务端不持有 Person 私钥）：委派批准签名路径同时生成 VC 并随批准提交 | `id` = Agent DID；`delegationId`、`delegationHash`（`pw-delegation-v1` 规范哈希）、`scopes`、`validFrom`/`validUntil` | **写路径强制服务端校验（防投毒）**——持久化前服务端必须：①用该 Person 注册的 `person_keys` 公钥验证 VC 的 Ed25519 proof；②`delegationHash` == 存储委派的规范哈希；③issuer/subject/scopes/有效期与存储的委派证书一致。任一不符拒绝写入（写入仅限所有者会话）。唯一约束使"先写坏数据"无法覆盖，但校验必须在**首次写入前**执行 |

**VC 信任边界（规范）**：
- 收据 VC：验证方用托管配置的 `RECEIPT_ISSUER_PUBLIC_KEY` 验证；issuer = 平台根 DID `did:web:proofweave.org`，其文档（`/.well-known/did.json`，纳入阶段 1 交付）携带收据签发公钥。
- 委派 VC：验证方用平台记录的对应 Person 公钥（经 `person_keys`，撤销后不可信）验证；`verificationMethod` fragment 必须解析到该 Person 的注册密钥。
- 因此"纯离线"仅对**收据 VC + 预配 issuer 公钥**成立；委派 VC 的离线验证需要验证方持有（或可信获取）Person 公钥——此限制如实写入文档。

- VC 内容是既有记录的**投影**：`receiptHash`/`delegationHash` 绑定规范哈希；VC 验签与平台记录核验是两条独立路径。
- issuer 用 DID（阶段 1 的 did:web）；`verificationMethod` 指向签发密钥对应的 `#key-id`。
- 幂等：同一记录重复请求返回字节相同的 VC（确定性签名需要 RFC 8032 Ed25519 确定性签名——WebCrypto 符合）。

### 4.3 公开接口（按既有可见性）

| 方法 | 路径 | 语义 |
| --- | --- | --- |
| GET | `/api/receipts/:id/credential` | 收据 VC（匿名）——**必须套用既有公开可见性门**：仅 `record_class='research'` 且 `visibility='public'` 的已签发未撤回收据（与现有收据公开读取一致，防匿名枚举 internal/unlisted 收据）；响应 `no-store` |
| GET | `/api/delegations/:id/credential` | 委派 VC——与现有 `/api/delegations/[id]` 相同的公开可见性（该端点本就公开），响应 `no-store` |
| POST | `/api/credentials/verify` | body `{ verifiableCredential, trustedIssuerKeys? }` → 结构+签名核验（密钥信任源必选，见 §4 信任边界）→ `{ valid, checks }`；HTTP 200（验证语义非资源错误） |

数据模型：收据 VC 服务端实时投影（幂等，无新表）；**委派 VC 因客户端签名需持久化**——新表 `delegation_credentials`（`delegation_id(唯一), vc_payload_hash, canonical_vc, created_at`，迁移 0050）。

## 5. 错误处理汇总

| 场景 | 行为 |
| --- | --- |
| nonce 过期/已消费/不存在（原子消费 changes!=1） | 400 `invalid_challenge`，不建会话 |
| SIWE 消息与重建的期望消息字节不一致 | 400 `challenge_mismatch` |
| 签名恢复地址 ≠ 消息地址 | 400 `signature_mismatch` |
| 签名畸形（长度/v 值非法） | 400 `signature_mismatch`（映射为 WalletChallengeError，不 500） |
| chainId 不在 `WALLET_ACCEPTED_CHAINS_JSON` | 400 `chain_not_accepted` |
| ERC-1271 合约钱包 | 400 `unsupported_wallet_type` |
| SIWE domain/uri 与 origin 不符 | 400 `domain_mismatch`（字节级比对天然覆盖） |
| 目标地址已绑定其他 Person / 并发绑定落败 | 409 `wallet_already_bound` |
| DID 未知/未注册 | 404；密钥全撤销 → 200 + 空 verificationMethod |
| VC 请求但 issuer 密钥未配置 | `issuer_unavailable` |
| 委派 VC 写入校验失败 | 400 `credential_rejected`（不持久化） |
| VC 验证失败 | `{ valid:false, reason }`，HTTP 200 |
| Solana 适配器被调用 | 501 明确"not implemented"，禁止静默降级 |

## 6. 测试策略

- **协议单元**：did:web 编解码与 W3C 解析规则（含 round-trip 拒绝用例、含 `:` 的 agentId 拒绝）、multibase/base58btc 固定向量、DID 文档投影（撤销后 method 消失、空 method 边界、COALESCE 双撤销机制）、SIWE 消息构造与字节级比对、VC 签发/验证/篡改（任一字段/proof/issuer 变更必失败）、VC 确定性（同输入同输出、`proof.created` 钉死）、信任边界（错误 issuer 公钥 → valid:false）。
- **适配器**：EVM 用预签消息固定向量（本地生成测试密钥 + `personal_sign` 语义）；链白名单；Solana 桩 501。
- **路由集成**（Miniflare）：wallet start/challenge/verify 全流程 + 重放拒绝 + 过期 + cookie 签名；DID 404/撤销；VC 端点幂等 + `issuer_unavailable` + 可见性。
- **登录集成**：wallet 身份创建独立 Person（displayName 为截断地址）；**同地址跨 chainId 登录进入同一 Person（地址优先解析）**；显式绑定后同 Person 登录；绑定冲突 409（并发绑定由唯一索引裁决）；现有三种登录回归；**app/auth.ts 对 wallet 会话的放行**（getCurrentUser 不再把 wallet 会话当匿名）。
- **委派 VC 写路径**：非所有者写 → 403；proof 验证失败/`delegationHash` 不符/scopes 篡改 → 拒绝写入；首次写入即服务端校验（防投毒）。
- **收据 VC 可见性**：internal/unlisted 收据请求 VC → 与现有公开读取一致的拒绝行为。
- **门禁**：扩展 `identity:store:check`；新增 `wallet:check`、`vc:check`、`did:check` 纳入 `check:fast`。

## 7. 实现顺序（供计划细化）

2026-10-16 编号更新：0047 已用于锚定租约，0048 用于签名交易 outbox；以下 0049/0050 为下一组计划编号，实施前需再次核对迁移历史。

1. 阶段 1 DID：`did-web.mjs` + multibase 工具 + `/.well-known/did.json` + 文档端点（纯函数先行）。
2. 阶段 2 钱包登录：`signed-flow-cookie.mjs` 抽取 → 迁移 0049 → 适配器 + EVM SIWE → 三条路由 + `app/auth.ts`/类型联合扩展 → settings 绑定 → 登录页入口（门控）。
3. 阶段 3 VC：`verifiable-credential.mjs`（含信任边界）→ 迁移 0050 + 委派 VC 浏览器签发与写入校验 → 收据 VC 端点 → 验证端点。
4. 文档：`docs/did-contract.md`、README/登录页更新。

## 8. 部署与配置注意

- `WALLET_LOGIN_ENABLED` 默认关——上线节奏由运营控制。
- did:web 文档域名跟随生产域（`proofweave.org`）；本地开发用 `http://localhost:3000` 时 SIWE domain 随 origin。
- VC 收据签发复用 `RECEIPT_ISSUER_*` 托管密钥；委派 VC 用 Person 密钥（无私钥服务端托管的语义变化——Person 签名本就发生在所有者批准的签名路径中）。

## 9. 未决事项（实现计划阶段确定）

- EVM 测试向量：用小脚本（ethers `Wallet.signMessage`）本地生成预签 SIWE 消息并以 JSON fixture 入库（镜像 `tests/evm-anchor-adapter.test.mjs` 的做法）。
- settings 绑定钱包的 UI 交互细节（页面结构）。
- `signed-flow-cookie.mjs` 抽取的边界（Google 侧是否同步切换到共享模块，或 wallet 先用、Google 后续迁移）。
- DID 文档 `created`/`updated` 是否做日期舍入（避免泄露精确注册时间）——倾向保留完整时间戳，文档只含公开注册行为。
