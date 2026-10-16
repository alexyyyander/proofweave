# 前端组件组织与复用

这次整理覆盖 `app` 的全部 TSX 文件。页面保留业务编排，重复的控件、展示模式和外壳进入共享层。实际接入位置可以用 `npm run ui:inventory` 查看；文末列出完整组件文件清单。

## 品牌风格与借鉴边界

Proofweave 保留深蓝与靛蓝、温暖纸张、学术衬线标题和可检查的证据表达。外部参考用于改善阅读顺序、信息密度、对齐、焦点与交互反馈；不整套迁移对方的字体、配色、布局或品牌语言。

字体按职责组合：Georgia（`--font-editorial`）用于主页面及分区标题，Geist Sans 用于正文、导航和操作控件，Geist Mono 用于代码与技术标识。字体组合本身不是割裂；相同职责的层级、尺寸、间距失去规律才是问题。统一规则应保留这套组合，而不是把全部内容改成无衬线体。

## 主页面的视觉引导规则

上一轮统一了控件与容器，但 `SectionHeading` 只提供默认样式，页面自己的标题规则仍能覆盖它。现在将首屏语义提升为独立的 `PageIntro`，五个主入口共用它。

| 主页面 | 用户要理解或完成的事情 | 首屏之后 |
| --- | --- | --- |
| Overview `/` | 了解产品及证据流转 | 证明旅程、真实验证、研究入口 |
| Research `/explore` | 选择一个明确的研究目标 | 搜索、筛选、研究列表 |
| Workspace `/workbench` | 开始或继续自己的工作 | 未登录引导，或个人任务列表 |
| AI record `/history` | 查看外部数学进展及证据 | 证据说明、可重放来源、时间线 |
| About `/about` | 了解产品机制与边界 | 产品组成、设计文档、项目介绍 |

阅读顺序固定为：页面定位 → 唯一主标题 → 简短说明 → 主要行动（需要时）→ 辅助信息 → 正文。说明放在标题下面，不再分别放在右栏、角标或独立大字区域。补充证据可以放在侧栏，窄屏移动到说明区下方。阅读型页面不强行添加行动按钮。

| 文字角色 | 共享规则 |
| --- | --- |
| 页面主标题 `PageTitle` / `PageIntro` | Georgia，桌面 40px / 窄屏 32px，400 字重，1.16 行高 |
| 分区标题 `SectionTitle` | Georgia，24px，400 字重，1.3 行高 |
| 卡片标题 `CardTitle` | Georgia，20px；可选择 h2/h3/h4 语义层级，外观不随标签变化 |
| 首屏说明 | 16px，1.7 行高，最大 64ch 阅读宽度 |
| 辅助信息 | 13px，1.6 行高 |
| 页面定位 | 12px，600 字重 |

主内容对齐宽度为 1120px，首屏上/下留白为 48/36px（窄屏 32/28px）。Overview 与 AI record 保留深蓝首屏；文字角色与间距不随底色变化。详情页、流程表单和数据可视化可以拥有自己的布局，但不能用另一套字号冒充主页面层级。

`PageIntro` 明确提供 label/title/description/actions/meta/aside 插槽，不提供页面级 className 改写首屏字体。`SectionHeading` 继续负责内容组合；真正的分区标题使用 `SectionTitle`。组件审计禁止基础 UI 之外自行输出 h1/h2/h3；五个主入口必须使用 PageIntro，详情、账号、阅读与任务页面使用 PageTitle。SectionTitle 可选择 h2/h3；CardTitle 可选择 h2/h3/h4，HTML 语义与视觉职责分开。页面渲染测试检查主入口和二级路由只有一个主标题，且所有标题使用共享角色。

## 依赖方向

```text
路由：数据加载、权限、提交、页面组合
  ├─ shell：SiteFrame → Header / Footer（服务端身份与导航）
  ├─ research / evidence：ResearchCard、StatusStack、ProductStateBadge
  ├─ navigation：Breadcrumb、PageSectionNav、StepNavigation
  ├─ hooks：useStepPlayback
  └─ ui：Button、ActionLink、Input、Select、Textarea、Surface、
         PageIntro、PageTitle、SectionTitle、CardTitle、SectionHeading、EmptyState、FieldList / Field、CodeBlock、
         Badge、BrandMark、PaperSurface、ScrollArea
```

基础 UI 不读取身份、数据库、路由页面或验证记录。业务展示组件只接收传入的数据；类型依赖使用 `import type`。共享组件不反向依赖页面。自动审计检查运行时依赖环、基础层越界和绕过共享控件的原生标签。

`ui/index.ts` 只导出同步组件。`ScrollArea`、`StepNavigation` 和 `useStepPlayback` 是明确的客户端入口；`SiteFrame` 单独导入，避免把服务端身份逻辑带进客户端包。旧的 `app/ui.tsx`、`app/header.tsx`、`app/scroll-fade.tsx` 是兼容入口。

## 抽象件及优化

| 抽象件 | 职责与具体改进 |
| --- | --- |
| SiteFrame、Header、Footer、BrandMark | 统一站点壳、品牌、主内容焦点目标；保留活跃导航与服务器身份检查 |
| Button、ActionLink | 区分动作与导航；统一焦点、按压、忙碌及禁用反馈；保留原生表单 name/value/type/ref |
| Input、Select、Textarea | 保留 required、aria、事件及原生验证；统一最低高度和焦点；窄屏字号避免输入放大 |
| Surface、PageIntro、PageTitle、SectionTitle、CardTitle、SectionHeading、EmptyState | 用语义标签和可组合 children 组织内容；控制阅读宽度、内边距，取消静态卡片悬浮抬升 |
| FieldList、Field、CodeBlock | 统一术语和值、长哈希换行、代码横向滚动；FieldList 明确区分 rows（标签和值左右排列）与 stacked（上下排列，适合统计和说明列），保留真实证据文本 |
| Badge、ProductStateBadge、StatusStack | 统一状态外形；业务状态仍由调用方明确传入，不根据颜色推断验证结论 |
| Breadcrumb、PageSectionNav | 导航地标和当前位置语义；清晰的分区链接、键盘焦点、窄屏滚动 |
| StepNavigation | 任意步数、独立标签；方向键、Home/End 同时切换与移动焦点；首页和 Demo 共同使用 |
| useStepPlayback | 可见区内有限播放；隐藏标签页暂停；手动选择暂停；遵守减少动态效果设置 |
| PaperSurface | 纸张纹理、薄纸边缘、克制叠层、落纸动效；标题、正文、页脚插槽；不依赖 Demo 数据 |
| ScrollArea | 同时观察容器与内容大小，异步追加后重新计算边缘渐隐；可用键盘滚动 |
| ResearchCard | 同一研究记录的摘要/详情组合，首页与 Research 共用，保持来源、状态、动作一致 |

`PersonalWorkspaceFrame`、`WorkspaceShell`、研究图、审核表单、证据差异、历史时间线等领域模块仍保留各自接口。它们复用上述基础件，拥有自己的数据与交互逻辑；不能为了减少文件而把不同权限和流程合成万能组件。

## 样式所有权

- `app/styles/tokens.css`：唯一的全局颜色、字号、圆角、动效变量表。
- `app/components/**`：共享组件外观，禁止依赖首页私有变量；`ui/typography.css` 定义标题角色，`ui/page-intro.css` 仅处理首屏组件本身。
- `app/styles/primary-pages.css`：五个主入口的内容对齐、版面组合、阅读字号；不放进基础组件层。
- `app/styles/*.css`：按现有功能分组的布局与兼容样式。`globals.css` 只声明加载顺序。保留旧布局级联次序以减少回归；后续迁移某领域组件时再归并其旧规则。
- `app/home.css` 与 `ShowcaseExperience.module.css`：首页和证明旅程的具体组合。

先改 tokens 或共享组件，再改领域组合；仅在某页面特有时才增加页面规则。通用容器默认值使用低优先级选择器；页面可通过 className 和 CSS module 表达布局。PageIntro、PageTitle、SectionTitle 与 CardTitle 的字体层级由共享层拥有，不接受页面私有字号。

## 本轮体验整理

- 全站现有字体声明归入 editorial/ui/code 三个变量；字体组合保留不变。Geist 的变量由 next/font 放在 body，UI/code 别名也在 body 定义，避免根节点提前解析时回退为系统字体。
- 在主入口之外，再将 46 个文件中的 130 个标题接入共享角色，清理 601 条旧标题字体声明。详情、证据、审核、工作台、账号、指南及法律页面都由同一规则维护标题；页面仍控制各自业务布局。
- SiteFrame 统一导航、正文与页脚的对齐宽度，阅读页统一段落与分区间距；操作按钮共享 14px 字号和最低 40px 高度，窄屏输入保持 16px。
- 修复统计区误用左右字段布局造成的横向溢出，研究统计、审核摘要和历史说明使用 stacked 字段布局。流程入口卡片增加间距；登录页辅助说明提升到可读的 12px。
- Research 将搜索与排序放在统计前面，Reset 使用次要动作外观，筛选按钮提供 aria-pressed 状态；保留搜索、排序与来源语义。
- 主页面正文说明提升为可读的 14px，辅助说明 12px；图表密集标签和代码仍按各自场景处理，不全局机械放大。
- 保留深蓝、靛蓝、纸张与学术衬线风格，不套用外部产品的整套视觉。

## 与现有主分支集成

保留 main 的数学出版物目录、十月记录、纠错状态和时间线滚轮缩放；出版物页面与详情、BibTeX 复制操作也使用共享标题及控件。`tsx` 显式固定为开发依赖；UI 类型、组件依赖和语义检查进入既有 check / check:fast 门禁。部署需以当前 Sites 源码为底稿合入前端，不直接用 GitHub main 覆盖站点尚未同步的功能。

## 检查与扩展

- 开发工作台：`/dev/components`。展示共享件、状态、纸张、键盘步骤、动态列表、两种研究卡。生产模式返回 404。
- `npm run ui:check`：前端类型检查、依赖方向、循环、共享控件接入审计，以及组件语义测试。
- `npm run ui:inventory`：组件、客户端边界、各文件使用的组件及次数，JSON 输出。
- `npm run build` 与 `node --test --test-concurrency=1 tests/rendered-html.test.mjs`：生产构建和页面/权限回归。Miniflare 需要本地监听端口。
- `node scripts/ui/audit-components.mjs --markdown`：更新下面的清单。

本轮验收：前端类型检查、组件审计、7 项组件测试、53 项页面、出版物与用户流程回归、生产构建及 lint 均通过。内置浏览器检查了 1280px 横屏与 390px 窄屏下的代表性页面，包括首页、研究详情、登录、流程指南、历史、审核维护态和隐私页；未发现页面横向溢出。真实 Chrome 自动化连接不可用，不能把这些结果当作真实 Chrome 的验收。登录后权限与完整操作流程由隔离测试数据验证；本地页面仍遵守原有维护模式。

为新需求选最小层级：仅排版复用 ui；重复领域展示放在 components 对应领域；数据获取、授权和提交留在 feature/route。不要在共享层导入页面或复制一套按钮、表单、纸张。

## 全部组件文件

清单包括页面入口、局部领域组件和兼容出口；`server-compatible` 表示没有客户端指令，纯展示件仍可被客户端组合使用。

| 文件 | 层级 | 边界 | 组件 |
| --- | --- | --- | --- |
| [app/about/catalog-standard/page.tsx](../app/about/catalog-standard/page.tsx) | route | server-compatible | CatalogStandardPage |
| [app/about/page.tsx](../app/about/page.tsx) | route | server-compatible | AboutPage |
| [app/about/principles/page.tsx](../app/about/principles/page.tsx) | route | server-compatible | PrinciplesPage |
| [app/about/shared-research/page.tsx](../app/about/shared-research/page.tsx) | route | server-compatible | SharedResearchPage |
| [app/components/evidence/Status.tsx](../app/components/evidence/Status.tsx) | evidence | server-compatible | ProductStateBadge, StatusStack |
| [app/components/navigation/Breadcrumb.tsx](../app/components/navigation/Breadcrumb.tsx) | navigation | server-compatible | Breadcrumb |
| [app/components/navigation/PageSectionNav.tsx](../app/components/navigation/PageSectionNav.tsx) | navigation | server-compatible | PageSectionNav |
| [app/components/navigation/StepNavigation.tsx](../app/components/navigation/StepNavigation.tsx) | navigation | client | StepNavigation |
| [app/components/research/ResearchCard.tsx](../app/components/research/ResearchCard.tsx) | research | server-compatible | ResearchCard |
| [app/components/shell/Footer.tsx](../app/components/shell/Footer.tsx) | shell | server-compatible | Footer |
| [app/components/shell/Header.tsx](../app/components/shell/Header.tsx) | shell | server-compatible | Header |
| [app/components/shell/SiteFrame.tsx](../app/components/shell/SiteFrame.tsx) | shell | server-compatible | SiteFrame |
| [app/components/ui/ActionLink.tsx](../app/components/ui/ActionLink.tsx) | ui | server-compatible | ActionLink |
| [app/components/ui/PageIntro.tsx](../app/components/ui/PageIntro.tsx) | ui | server-compatible | PageIntro |
| [app/components/ui/PaperSurface.tsx](../app/components/ui/PaperSurface.tsx) | ui | server-compatible | PaperSurface |
| [app/components/ui/primitives.tsx](../app/components/ui/primitives.tsx) | ui | server-compatible | Button, Input, Select, Textarea, FieldList, Field, CodeBlock, Surface, SectionHeading, EmptyState, BrandMark, Badge, SectionTitle, CardTitle, PageTitle |
| [app/components/ui/ScrollArea.tsx](../app/components/ui/ScrollArea.tsx) | ui | client | ScrollArea |
| [app/connect/codex/CodexPairingApproval.tsx](../app/connect/codex/CodexPairingApproval.tsx) | feature | client | CodexPairingApproval |
| [app/connect/codex/page.tsx](../app/connect/codex/page.tsx) | route | server-compatible | ConnectCodexPage |
| [app/delegations/[id]/page.tsx](../app/delegations/[id]/page.tsx) | route | server-compatible | DelegationPage, DelegationDocument, DelegationGate, DelegationNotFound, DelegationUnavailable, DelegationMessage |
| [app/demo/DemoVerificationClient.tsx](../app/demo/DemoVerificationClient.tsx) | feature | client | DemoVerificationClient |
| [app/demo/page.tsx](../app/demo/page.tsx) | route | server-compatible | DemoPage |
| [app/dev/components/ComponentGallery.tsx](../app/dev/components/ComponentGallery.tsx) | workshop | client | ComponentGallery |
| [app/dev/components/page.tsx](../app/dev/components/page.tsx) | workshop | server-compatible | ComponentGalleryPage |
| [app/evidence/[attemptId]/page.tsx](../app/evidence/[attemptId]/page.tsx) | route | server-compatible | EvidenceDetailPage, EvidenceDetail, ArtifactList, ReplayEvidence, ReviewOutcomes, RunnerResultSummary, EvidenceAccessMessage |
| [app/evidence/IndependentReviewHandoff.tsx](../app/evidence/IndependentReviewHandoff.tsx) | feature | client | IndependentReviewHandoff |
| [app/evidence/page.tsx](../app/evidence/page.tsx) | route | server-compatible | EvidenceIndexPage, EvidenceIndexCard, EvidenceMessage |
| [app/evidence/SourceDiffPreview.tsx](../app/evidence/SourceDiffPreview.tsx) | feature | client | SourceDiffPreview |
| [app/explore/[slug]/CreditMarketPanel.tsx](../app/explore/[slug]/CreditMarketPanel.tsx) | feature | server-compatible | CreditMarketPanel, MarketHeading, MarketMetric |
| [app/explore/[slug]/HistoricalSourceImporter.tsx](../app/explore/[slug]/HistoricalSourceImporter.tsx) | feature | client | HistoricalSourceImporter |
| [app/explore/[slug]/page.tsx](../app/explore/[slug]/page.tsx) | route | server-compatible | ConjecturePage |
| [app/explore/[slug]/PriorWorkChain.tsx](../app/explore/[slug]/PriorWorkChain.tsx) | feature | server-compatible | PriorWorkChain, ResearchRecordCard |
| [app/explore/[slug]/ResearchGraphView.tsx](../app/explore/[slug]/ResearchGraphView.tsx) | feature | server-compatible | ResearchGraphView, GraphHeading, ResearchNodeCard, ResearchNodeEvidence, EvidenceGate |
| [app/explore/ExploreCatalog.tsx](../app/explore/ExploreCatalog.tsx) | feature | client | ExploreCatalog |
| [app/explore/page.tsx](../app/explore/page.tsx) | route | server-compatible | ExplorePage |
| [app/header.tsx](../app/header.tsx) | feature | server-compatible | re-export / composition |
| [app/history/HistoryTimeline.tsx](../app/history/HistoryTimeline.tsx) | feature | client | HistoryTimeline |
| [app/history/page.tsx](../app/history/page.tsx) | route | server-compatible | HistoryPage |
| [app/how-it-works/contribution-records/page.tsx](../app/how-it-works/contribution-records/page.tsx) | route | server-compatible | ContributionRecordsGuidePage |
| [app/how-it-works/page.tsx](../app/how-it-works/page.tsx) | route | server-compatible | HowItWorksPage |
| [app/how-it-works/research/page.tsx](../app/how-it-works/research/page.tsx) | route | server-compatible | ResearchGuidePage, GuidePage |
| [app/how-it-works/verification/page.tsx](../app/how-it-works/verification/page.tsx) | route | server-compatible | VerificationGuidePage |
| [app/integrations/CodexInstallPrompt.tsx](../app/integrations/CodexInstallPrompt.tsx) | feature | client | CodexSetupPrompt, CodexInstallPrompt, CodexConnectPrompt, CodexWorkflowPrompt |
| [app/integrations/IntegrationClient.tsx](../app/integrations/IntegrationClient.tsx) | feature | client | IntegrationClient |
| [app/integrations/page.tsx](../app/integrations/page.tsx) | route | server-compatible | IntegrationsPage |
| [app/layout.tsx](../app/layout.tsx) | route | server-compatible | RootLayout |
| [app/lib/read-only-personal-surface.tsx](../app/lib/read-only-personal-surface.tsx) | feature | server-compatible | ReadOnlyPersonalSurface |
| [app/page.tsx](../app/page.tsx) | route | server-compatible | Home |
| [app/people/[id]/page.tsx](../app/people/[id]/page.tsx) | route | server-compatible | PublicPersonPage, ProfileStat, PublicEmpty, PublicProfileUnavailable |
| [app/PersonalWorkspaceFrame.tsx](../app/PersonalWorkspaceFrame.tsx) | feature | server-compatible | PersonalWorkspaceFrame |
| [app/PersonalWorkspaceNavigation.tsx](../app/PersonalWorkspaceNavigation.tsx) | feature | server-compatible | PersonalWorkspaceNavigation, WorkspaceLink |
| [app/privacy/page.tsx](../app/privacy/page.tsx) | route | server-compatible | PrivacyPage, PolicySection |
| [app/profile/page.tsx](../app/profile/page.tsx) | route | server-compatible | ProfilePage, ProfileStat, ProfileEmpty, ProfileUnavailable |
| [app/propose/page.tsx](../app/propose/page.tsx) | route | server-compatible | ProposePage |
| [app/propose/ProblemProposalClient.tsx](../app/propose/ProblemProposalClient.tsx) | feature | client | ProblemProposalClient |
| [app/publications/CitationCopyButton.tsx](../app/publications/CitationCopyButton.tsx) | feature | client | CitationCopyButton |
| [app/publications/MathText.tsx](../app/publications/MathText.tsx) | feature | server-compatible | MathText |
| [app/publications/openai-math/[number]/page.tsx](../app/publications/openai-math/[number]/page.tsx) | route | server-compatible | PublicationFamilyPage |
| [app/publications/page.tsx](../app/publications/page.tsx) | route | server-compatible | PublicationsPage |
| [app/receipt/[id]/page.tsx](../app/receipt/[id]/page.tsx) | route | server-compatible | ReceiptPage, IssuedReceipt, ReceiptGate, ReceiptNotIssued, ReceiptUnavailable, ReceiptMessage |
| [app/receipts/page.tsx](../app/receipts/page.tsx) | route | server-compatible | ReceiptsPage, ReceiptIndexCard |
| [app/reviews/[assignmentId]/page.tsx](../app/reviews/[assignmentId]/page.tsx) | route | server-compatible | ReviewAssignmentPage, ReviewAssignmentMessage |
| [app/reviews/page.tsx](../app/reviews/page.tsx) | route | server-compatible | ReviewsPage, ReviewMessage |
| [app/reviews/ReviewAssignmentWorkspace.tsx](../app/reviews/ReviewAssignmentWorkspace.tsx) | feature | client | ReviewAssignmentWorkspace, ReviewProgress, ReviewAction, ReviewAgentPrompt |
| [app/reviews/ReviewQueueClient.tsx](../app/reviews/ReviewQueueClient.tsx) | feature | client | ReviewQueueClient, ReviewCard |
| [app/reviews/VerificationMarketBoard.tsx](../app/reviews/VerificationMarketBoard.tsx) | feature | client | VerificationMarketBoard |
| [app/scroll-fade.tsx](../app/scroll-fade.tsx) | feature | client | re-export / composition |
| [app/settings/page.tsx](../app/settings/page.tsx) | route | server-compatible | SettingsPage |
| [app/showcase/page.tsx](../app/showcase/page.tsx) | route | server-compatible | ShowcasePage |
| [app/showcase/ShowcaseExperience.tsx](../app/showcase/ShowcaseExperience.tsx) | feature | client | ShowcaseExperience, EvidenceScene |
| [app/sign-in/page.tsx](../app/sign-in/page.tsx) | route | server-compatible | SignInPage, GoogleMark |
| [app/terms/page.tsx](../app/terms/page.tsx) | route | server-compatible | TermsPage, Term |
| [app/ui.tsx](../app/ui.tsx) | feature | server-compatible | re-export / composition |
| [app/workbench/AgentConnections.tsx](../app/workbench/AgentConnections.tsx) | feature | client | AgentConnections |
| [app/workbench/attempt-presentation.tsx](../app/workbench/attempt-presentation.tsx) | feature | server-compatible | AttemptStatusBadge |
| [app/workbench/AttemptQueue.tsx](../app/workbench/AttemptQueue.tsx) | feature | client | AttemptQueue |
| [app/workbench/attempts/[id]/page.tsx](../app/workbench/attempts/[id]/page.tsx) | route | server-compatible | AttemptDetailPage |
| [app/workbench/DelegationSetup.tsx](../app/workbench/DelegationSetup.tsx) | feature | client | DelegationSetup, DelegationSetupFlow, PersonKeyStep, AgentStep, CertificateStep, RevocationStep |
| [app/workbench/LocalAgentHandoff.tsx](../app/workbench/LocalAgentHandoff.tsx) | feature | client | LocalAgentHandoff |
| [app/workbench/MyWorkOverview.tsx](../app/workbench/MyWorkOverview.tsx) | feature | client | MyWorkOverview |
| [app/workbench/page.tsx](../app/workbench/page.tsx) | route | server-compatible | WorkbenchPage, ReadOnlyWorkbench, SignedOutWorkbench |
| [app/workbench/ResearchLauncher.tsx](../app/workbench/ResearchLauncher.tsx) | feature | client | ResearchLauncher, LauncherState |
| [app/workbench/workbench-sections.tsx](../app/workbench/workbench-sections.tsx) | feature | server-compatible | WorkspacePath, FirstContributionPath, GateRow, WorkbenchHero, DelegationSummary, FocusAction, WorkspaceSettingsPrompt, ProvisionalContributionLedger, ResearchWorkstation, SubmissionReadiness, AttemptEventRow |
| [app/workbench/WorkbenchClient.tsx](../app/workbench/WorkbenchClient.tsx) | feature | client | WorkbenchClient |
| [app/workbench/WorkspaceShell.tsx](../app/workbench/WorkspaceShell.tsx) | feature | client | WorkspaceTopbar, WorkspaceSidebar, WorkspaceRecordLinks |
