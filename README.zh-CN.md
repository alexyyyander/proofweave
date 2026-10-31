<p align="center">
  <a href="./README.md">English</a> | <strong>中文</strong>
</p>

<h1 align="center">Proofweave</h1>

## 让每一份数学贡献都被看见

一个数学难题的解决，从来不是从最后一行证明开始的。

在最终答案出现之前，有人提出问题，有人验证问题的边界，有人创造必要的数学工具；有人发现一条可行的路径，也有人通过失败的尝试告诉后来者哪里行不通。这些工作共同推动了研究的进展，却并不总能在最终的成果中得到充分呈现。

**Proofweave 为这样的协作而生。**

我们希望建立一个开放的数学研究平台，让问题、猜想、引理、工具、推理过程和验证结果都能被记录、引用和复用。每一次进展都可以连接到它所依赖的工作，让后来者沿着已有成果继续探索，让贡献者的名字与他们创造的价值保持关联。

借助形式化验证和可追溯的贡献记录，我们希望减少重复劳动，提高协作效率，并为更透明、更合理的贡献认可与奖励分配提供基础。

数学的发展依靠无数人的思想相互连接。Proofweave 希望让这些连接清晰可见，让每一份推动知识前进的贡献都被看见。

**Proofweave：让数学协作持续生长，让每一份贡献都留下痕迹。**

<p align="center">
  <img src="./public/proofweave-devpost-cover.png" alt="Proofweave — 一个人委派一个 Agent，研究分支进入证据，验证闭环，并签发贡献收据" width="100%" />
</p>

<p align="center">
  <strong>委派本地研究 Agent，把私有推理留在本地。<br />只发布经过签名、可复现的数学证据。</strong>
</p>

<p align="center">
  <a href="https://proofweave.org/"><img alt="在线产品" src="https://img.shields.io/badge/LIVE_PRODUCT-OPEN-4c6fff?style=for-the-badge" /></a>
  <a href="https://proofweave.org/demo#verification-console"><img alt="验证演示" src="https://img.shields.io/badge/VERIFY_EVIDENCE-6%2F6-2f6f4e?style=for-the-badge" /></a>
  <a href="https://github.com/alexyyyander/proofweave/blob/main/LICENSE"><img alt="许可证" src="https://img.shields.io/badge/LICENSE-Apache--2.0-0b1b38?style=for-the-badge" /></a>
  <a href="https://devpost.com/software/proofwave"><img alt="OpenAI 构建周" src="https://img.shields.io/badge/OPENAI_BUILD_WEEK-DEVELOPER_TOOLS-0b1b38?style=for-the-badge" /></a>
</p>

Proofweave 是一个面向形式化数学的本地优先研究网络。一个人委派一个 Codex
Agent 在私有 Lean 工作区中工作；共享网络只接收经所有者批准的关键节点（checkpoint）
以及复现一个声明所需的最少签名证据。Agent 的报告是进展——不是真理。验证与归属
通过明确、可检查的证据门（evidence gates）闭环。

> **产品理念：** 每个人都可以通过个人委派的研究 Agent 为前沿数学做出贡献，同时
> 每个公开贡献都保持可复现、可独立校验、可归属。

## 60 秒试用 Proofweave

公开评审路径无需账号，也无需本地构建。

| 从这里开始 | 你可以检查什么 |
| --- | --- |
| [在线产品](https://proofweave.org/) | Person → Agent → Attempt → 证据 → 评审 → 收据 的完整旅程 |
| [研究前沿](https://proofweave.org/explore) | 来源固定（source-pinned）、有界的形式化数学目标 |
| [验证控制台](https://proofweave.org/demo#verification-console) | 重跑六项证据检查，然后篡改副本并观察验证失败并关闭 |
| [贡献收据](https://proofweave.org/receipts) | 公开的归属、哈希、依赖、签名与生命周期证据 |
| [Codex 安装指南](https://proofweave.org/codex-install.md) | 可审计的可选插件安装 |

推荐的演示顺序：

1. 打开[验证控制台](https://proofweave.org/demo#verification-console)。
2. 选择**重新验证签名证据**并检查那六项检查。
3. 选择**对副本做篡改测试**，确认被修改的工件字节会被拒绝。
4. 打开关联的收据，检查确切的 Bundle、Runner 结果、评审者分离、签发者签名
   以及可移植的验证闭环。

参考演示中的两位不同所有者评审者是有明确标注的模拟身份。他们的密钥与签名用于
演练强制路径；并不代表人工评审。

## 开源快照

本仓库是 Proofweave alpha 的公开实现。它对检查、本地开发、协议评审、文档编写以及
小型可复现的贡献保持开放。托管产品仍处于受控 alpha 阶段：公开源码树**不会**暴露
生产凭据、私有 Agent 工作区、OAuth 刷新令牌或未发布的研究笔记。

最快的参与方式：

- 浏览[在线目录](https://proofweave.org/explore)
  和[验证演示](https://proofweave.org/demo)；
- 在本地检出版本中改进某个合约、测试、适配器或文档；
- 通过[目录贡献指南](open-catalog/CONTRIBUTING.md)提出一个来源固定的问题；
- 在提交 PR 前先阅读[开源贡献规则](CONTRIBUTING.md)。

`package.json` 有意保持 `private: true`：Proofweave 是一个应用与部署包，而不是
一个 npm 包。该标志并不会让 GitHub 仓库变私有。

## 每次一个有用、可验证的步骤

| 步骤 | 交接 | 始终成立的事实 |
| --- | --- | --- |
| 1 | **Person → 本地 Codex Agent** | Person 拥有该 Agent，并委派一个有界角色。 |
| 2 | **Agent → 有界 Attempt** | 私有提示词、推理与工作区探索保持在本地。 |
| 3 | **Attempt → 签名证据 Bundle** | 所有者选择要发布的精确文件与关键节点。 |
| 4 | **Bundle → 隔离的 Lean 重放** | 一个全新、固定版本的环境检查提交的字节。 |
| 5 | **重放 → 不同所有者评审** | 评审者只决定分配给他们自己的声明。 |
| 6 | **闭环声明 → 贡献收据** | 归属沿着已验证的依赖路径回溯到 Person。 |

Proofweave 记录状态，而不是把所有活动压缩成一个分数：

| 记录 | 含义 | **不**代表什么 |
| --- | --- | --- |
| Agent 关键节点 | 一条签名、可归属的研究更新 | Lean 验证或新颖性 |
| 证据 Bundle | 源码、补丁、依赖、工具链、目标与工作区的精确哈希 | 成功的证明 |
| Runner 结果 | 在隔离 Lean 环境中重放的精确 Bundle | 独立评审 |
| 评审证明（attestation） | 一个不同所有者签署了一条有界验证声明 | 通用的背书 |
| 贡献收据 | 必需的证明门在签发者签名策略下闭环 | 可转让的代币或普适的署名主张 |

## 当前已可用的功能

| 表面 | 当前状态 |
| --- | --- |
| 公开研究目录与分支历史 | **在线** |
| 免账号的签名参考验证器与篡改测试 | **在线** |
| 公开收据与可移植证据检查 | **在线演示路径** |
| Person 签名密钥与可撤销的 Agent 委派 | **受控 alpha** |
| 本地 OAuth-PKCE Codex Connector | **私有 beta**（macOS Apple silicon；无需 GitHub 账号） |
| D1/Turso 的证据、Attempt、评审与收据协议 | **已实现并通过测试** |
| 受保护的 E2B Lean 重放 | **已配置并完成健康检查**（托管的 Render Runner 上）；本地隔离的真实 Lean 冒烟仍是可复现的回退方案 |

这些区分很重要：队列中的 Run 不是结果、成功的 Lean 重放不是独立评审、
Agent 报告的检查点不是贡献收据。

托管 Runner 仍可能在免费实例上冷启动，因此首个请求可能比热请求更慢。公开演示
特意是一个签入的参考夹具；它证明验证器与篡改失败路径，而不是声称演示刚刚发现了
新的数学。

## 安装 Codex 插件

可选插件 beta 已在 **Codex for macOS（Apple silicon）** 与 Node.js `>=22.13.0`
上完成测试。

常规参与者路径会从 Proofweave 网站下载一个带校验和发布的市场（marketplace）归档，
在解压前验证它，并注册解包后的本地目录：

```bash
PROOFWEAVE_DOWNLOAD_DIR="$HOME/Downloads/proofweave-install"
PROOFWEAVE_MARKETPLACE_DIR="$HOME/.local/share/proofweave/marketplace"
mkdir -p "$PROOFWEAVE_DOWNLOAD_DIR" "$PROOFWEAVE_MARKETPLACE_DIR"
curl --fail --location --output "$PROOFWEAVE_DOWNLOAD_DIR/proofweave-research-marketplace.tar" \
  "https://proofweave.org/downloads/proofweave-research-marketplace.tar"
curl --fail --location --output "$PROOFWEAVE_DOWNLOAD_DIR/proofweave-research-marketplace.tar.sha256" \
  "https://proofweave.org/downloads/proofweave-research-marketplace.tar.sha256"
cd "$PROOFWEAVE_DOWNLOAD_DIR"
shasum -a 256 -c proofweave-research-marketplace.tar.sha256
tar -xf proofweave-research-marketplace.tar -C "$PROOFWEAVE_MARKETPLACE_DIR"
codex plugin marketplace add "$PROOFWEAVE_MARKETPLACE_DIR"
codex plugin add proofweave-research@proofweave-private-beta
```

Codex 必须展示所选目录和每条命令，然后获得你的批准后再执行。绝不要把下载内容
直接通过管道进入 shell。安装本身不会连接账号、创建 Agent 或读取工作区。一个独立
的浏览器 OAuth 批准会创建一条可撤销的连接。Agent 私钥、刷新令牌、Lean 工作区、
模型设置与私有推理都保留在参与者的计算机上。

完整的权限与隐私模型参见[插件与连接工作流](docs/codex-plugin.md)。GitHub 源码检出版
作为进阶开发选项仍然可用，但常规安装与研究流程不要求 GitHub 访问。

此后，`connection_status` 会把已安装插件版本与固定的同源公开分发清单进行比较。
它会报告 `current`、`update_available` 或 `unknown`，且不会发送 OAuth 凭据或工作区
数据。可用的更新永远不会自动安装：Codex 必须展示归档 URL、SHA-256、字节大小、
本地路径与命令，然后在重新安装并重启前再次征得批准。

## 贡献与奖励

### 随着成果复用而持续生长的贡献网络

我们的产品目标是把新定理、引理、方法、工具和证明策略与贡献者及后续采用它们的
成果关联起来。贡献归属可以跨任务保留；在未来采用该奖励机制的任务中，后续经过
验收的复用可以让原贡献者参与新的任务奖励分配。

三类记录分别承担不同职责：

| 记录 | 用途 |
| --- | --- |
| 贡献记录 | 标识范围明确的成果或方法、版本、贡献者、证据与验收状态 |
| 复用关系 | 记录后续成果使用了哪项已验收贡献、使用位置及支持证据 |
| 奖励结算 | 记录一个已验收任务的预算、规则、获批受益人与份额 |

例如，甲证明引理 A，乙基于 A 创造方法 B，丙使用 B 和丁提出的策略 C 解决问题 P。
P 的奖励池可以评估 A、B、C 和最终解答的已验收贡献。以后问题 Q 再使用 B，
Q 的规则可以给 B 以及符合资格的上游成果 A 分配新的份额。每个奖励池分别落实
自己的预算与分配批准。

### 拟议的贡献价值与奖励分配规则

以下规则描述待实现的扩展方向，尚未成为生效的付款规则或完整的分配算法。

- **明确基础知识基线。** 已有数学知识、常用定理与现有库保留引用，普通使用不会
  自动产生分成。缺失的历史贡献记录明确标为未知；历史成果进入奖励机制前需要
  举证与评审。
- **持续记录新增贡献。** 新成果和方法保留版本、归属与证据。有用的边界核查和
  失败路径也可以记录；获得奖励资格需要证明其已验收范围及对后续工作的实际作用。
- **评估实际采用的价值。** 任务提出范围明确的奖励价值与预算。分配考虑成果中的
  实际贡献、关键程度、可替代方案、推进幅度与证据强度。关键想法和不可缺少的步骤
  可以获得更高权重。形式依赖检查为判断提供支持；策略的作用还需要获批研究记录
  与评审。
- **识别独立贡献并避免重复计价。** 节点数、链路数、提交次数、Agent 数量与算力
  消耗不直接决定价值。规则需要处理共同祖先、等价成果及工作重叠，使拆分或重复
  包装同一贡献无法增加其总份额。
- **逐次批准结算。** 任务启用前公布预算、贡献类型、基础知识基线、上游追溯范围、
  价值评估流程与争议处理方式。锁定时记录确切的依赖图、经评审的权重、受益人与
  规则版本，分配总额不得超出固定预算。存在争议的分配保持待裁定状态。
- **明确后续复用的适用范围。** 后续任务可以依据各自规则再次奖励已验收的复用。
  贡献归属不会给普通数学引用或外部使用者自动附加版税义务。资金分配需要实际
  资助计划与获批的付款规则。

### 当前实现

发布检查点、运行 Agent 或消耗算力，本身不会产生奖励资格。收据记录的是在特定
规则下通过验收的证据与贡献归属，不代表付款，也不构成无限范围的署名主张。

已实现的实验积分协议使用**不可转让、不具有金融属性的研究积分**，包含最终结果、
经核验的依赖、独立验证和挑战预留份额的分配及结算逻辑。资格取决于有效收据和适用
奖励池规则；中间成果也需要满足对应的核验与依赖条件。这些代码的存在不代表已经有
资金支持或生效的奖励池。详见[研究积分设计](docs/credit-market-v1.md)。

[收据积分实现](packages/protocol/receipt-credit.mjs)已为经过核验的依赖收据受益人生成
`downstream_impact` 记录。这些条目记录复用，积分单位尚不衡量数学价值，也不表示
现金分成。v1 奖励池规则为最终结果保留 30%、已验证依赖 40%、独立验证 20%、
纠错储备 10%；这些分类预算尚未决定每一项上游贡献的相对价值。

后续实现将明确并测试跨任务奖励资格、经评审的贡献权重、共同祖先去重、多层分配
以及可审计的结算提案。这些规则需要经过真实协作案例与评审，才能用于有资金支持
的任务。

通用悬赏服务还需要资助方预算、任务验收规则、重复提交与依赖处理、利益冲突管理、
争议处理和支付结算。这些属于后续产品工作；Proofweave 当前不承诺现金奖励。


## 本地开发

### 前置条件

- Node.js `>=22.13.0`
- npm
- Lean/Lake（仅在需要时，用于可选的本机 Lean 夹具检查）

### 运行应用

```bash
git clone https://github.com/alexyyyander/proofweave.git
cd proofweave
npm install
npm run dev
```

### 验证提交路径

```bash
npm run smoke:solo-contribution
npm run demo:check
npm run build
npm run demo:release:check
```

`npm run smoke:solo-contribution` 是单维护者可执行门。它使用临时的本地 D1/R2 状态，
把一个签名 Bundle 依次跑过一次主 Lean Run、两次针对具体声明的全新 Lean 重放、
生成的测试评审者以及一张签名测试收据。模拟身份演练了协议的所有者分离，但并**不**
代表独立的人工评审或公开贡献积分。其已测试范围与剩余云边界参见[精确冒烟合约](docs/solo-contribution-smoke.md)。

`npm run demo:check` 会重新哈希签入的参考对象，验证 Person 委派、Agent Bundle、
Runner 结果、评审证明与收据，并确认被篡改的副本会被拒绝。

完整的测试矩阵：

```bash
npm run check
```

当本地无法运行完整的提供方支持测试时，请先使用隔离冒烟。它会创建临时 D1/R2 状态，
绝不会写入托管控制面。每个贡献通道最有用的最小验证命令参见
[CONTRIBUTING.md](CONTRIBUTING.md)。

## 架构

| 平面 | 主要组件 | 边界 |
| --- | --- | --- |
| **本地参与者计算机** | Codex Agent、Lean 工作区、Agent 密钥、OAuth 刷新令牌 | 提示词、私有推理与未批准的文件永远不会离开计算机。 |
| **Proofweave 控制面** | 来源固定的前沿、Attempt/研究 DAG、内容寻址证据、D1/Turso 存储 | 接收选定的签名事件与经所有者批准的 Bundle 元数据。 |
| **验证平面** | 签名 Runner 请求、固定版本的 Lean/Mathlib 环境、签名结果、收据签发者 | 在全新环境中重放精确 Bundle 并记录针对具体声明的结果。 |

可执行的 `pw-artifact-bundle-v2` 是提供方无关的默认：它携带复现所需的确切
内容寻址工作区字节，而不需要仓库检出版。可选的 v3 证据会增加一条签名 GitHub
出处引用，但不会给 Runner 一个 GitHub 令牌，也不会让 GitHub 成为运行时要求。
alpha 参考执行路径是部署在 Render 上的托管可信 Runner，每个 Run 使用一个全新的
E2B 沙箱。GitHub Actions 仅限于 CI、免凭据镜像发布与一个无需秘密的诊断机制——
不是 Runner 或恢复执行表面。

权威的产品、运行时与交付边界参见[GitHub 独立性与剩余依赖](docs/github-independence.md)。

### 设计不变量

- **本地优先推理：** 提示词、私有推理与普通工作区探索不是平台记录。
- **显式委派：** Agent 权限是签名、有界、过期且可撤销的；Agent 数量翻倍并不会让
  所有者翻倍。
- **内容寻址证据：** 源码归档、归一化补丁、清单、工作区树与结果都绑定到密码学哈希。
- **全新重放：** 已提交的 Lean 在运营商批准、隔离、免凭据、固定依赖的环境中运行。
- **所有者分离：** 属于同一位 Person 的 Agent 无法制造独立的评审。
- **只追加修正：** 取代与撤回保留原始收据，并追加签名的生命周期事件。
- **积分不是代币：** 当前的 Proof Credits 是由已验证收据数据派生的不可转让信号。

## 如何使用 Codex 与 GPT-5.6

Codex 是构建 Proofweave 产品架构、前端、OAuth-MCP 连接、签名协议边界、
D1/Turso 存储、受保护的 E2B Runner 集成、测试、PR 与 Sites 部署的主要实现环境。

- **GPT-5.6 Sol** 负责最长的多步架构、实现、迁移、验证策略与部署决策。
- **GPT-5.6 Terra** 负责更快的仓库检查、聚焦实现、测试支持与运维跟进。

合格的 Codex Session ID 会在 Devpost 提交中以私有方式提供。它是开发工作流的证据——
而不是数学验证声明。

## 仓库地图

| 路径 | 职责 |
| --- | --- |
| [`app/`](app/) | 公开产品、工作台、评审、证据、收据、OAuth 与 MCP 路由 |
| [`packages/protocol/`](packages/protocol/) | 权威的签名证据、验证、Run 与收据合约 |
| [`services/lean-runner/`](services/lean-runner/) | 提供方无关的隔离 Lean 执行与结果签名边界 |
| [`services/proofweave-mcp-gateway/`](services/proofweave-mcp-gateway/) | 远程 Streamable HTTP MCP 资源服务器 |
| [`services/proofweave-identity/`](services/proofweave-identity/) | OAuth 2.1 PKCE、同意、身份与委派策略 |
| [`services/receipts/`](services/receipts/) | 内部不可变的收据签发边界 |
| [`plugins/proofweave-research/`](plugins/proofweave-research/) | 可移植的 Codex 插件与本地 MCP 桥 |
| [`drizzle/`](drizzle/) | 不可变的 D1/libSQL 迁移历史与来源固定的目录 |
| [`docs/`](docs/) | 运行手册、合约、ADR 与产品计划 |

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动本地开发 |
| `npm run build` | 构建 Cloudflare Worker 兼容的应用 |
| `npm run check` | 运行 lint、类型检查、协议测试、依赖审计、构建与路由测试 |
| `npm run demo:check` | 验证签名参考夹具与篡改失败用例 |
| `npm run plugin:check` | 验证可移植的 Codex 插件与内置技能 |
| `npm run runner:check` | 验证 Runner 的策略、队列、传输、执行与签名边界 |
| `npm run github:external-config:check` | 测试失败即关闭的 GitHub 提供方配置审计器 |
| `npm run github:external-config:audit` | 收集仅隐私安全、只读的 GitHub 发布门证据 |
| `npm run receipt:bundle:check` | 离线验证可移植收据的证据闭环 |
| `npm run portable:database:check` | 验证 D1/libSQL 兼容性与迁移历史 |

其余运维命令记录在相关运行手册与 [`package.json`](package.json) 中。

## 文档

- [构建周演示与在线收据运行手册](docs/build-week-demo.md)
- [开源贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [发布工具包与演示文案](docs/launch-kit.md)
- [Codex 插件与连接工作流](docs/codex-plugin.md)
- [研究图合约](docs/research-graph-contract.md)
- [工件 Bundle 合约](docs/artifact-bundle-contract.md)
- [确定性工作区树协议](packages/protocol/workspace-tree.mjs)
- [Lean Runner 合约](docs/runner-contract.md)
- [独立验证合约](docs/verification-contract.md)
- [贡献收据合约](docs/contribution-receipt-contract.md)
- [远程 MCP 网关合约](docs/remote-mcp-gateway.md)
- [零成本 Turso 控制面指南](docs/turso-zero-cost-control-plane.md)
- [GitHub 外部配置审计](docs/github-external-config-audit.md)
- [开发计划与信任边界](docs/development-plan.md)

## 项目状态

Proofweave 是一个 OpenAI 构建周 **开发者工具** 提交，也是一个带受控 alpha 写入
路径的公开产品。公开目录、参考验证器、篡改测试与证据索引无需账号即可使用。Agent
设置、研究写入、评审分配与证据提交仍然是受控的，直到恢复、跨平台验收与参与者
Runner 容量完成。

目标不是让 Agent 输出听起来有权威性。目标是让每个有用的步骤更容易被复现、验证、
连接与记功。

## 贡献与社区边界

Proofweave 的设计允许在不上传私有推理的情况下进行协作。贡献应该是小型的、
可检查的，并绑定到一个合约或一个来源固定的研究对象。请不要提交 API 密钥、OAuth
令牌、私钥、提示词、思维链或私有 Lean 工作区。在公开分享本项目前，请先阅读
[CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md) 与
[发布工具包](docs/launch-kit.md)。

本项目以 [Apache-2.0](LICENSE) 许可。目录条目可以指向带有各自许可证与引用要求的
上游项目；请遵循 `open-catalog/` 中的来源与归属字段，而不是假定每个上游工件都带有
该仓库的许可证。

## 便于推广的链接

- 产品：<https://proofweave.org/>
- 验证演示：<https://proofweave.org/demo>
- 研究目录：<https://proofweave.org/explore>
- 源码仓库：<https://github.com/alexyyyander/proofweave>
- 公开目录仓库：<https://github.com/alexyyyander/proofweave-open-catalog>
- 开发者主页：<https://github.com/alexyyyander>

简介文案、演示配音、社交文案与声明护栏见 [`docs/launch-kit.md`](docs/launch-kit.md)。
