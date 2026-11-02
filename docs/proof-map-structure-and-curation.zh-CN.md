# Proof map 结构与持续补全（2026-10-31）

本文说明网站上的 proof-map 结构、状态等级和持续补全流程。它不是发布授权；任何 replay、评审、Receipt 或部署仍需各自证据。

## 1. 五类结构

| 状态 | 含义 | 当前数量 |
| --- | --- | --- |
| `deep` | theorem-level argument map：4 个手工策展（003、032、084、159）+ 343 个由论文结构逐族核对后升级（引用上下文分类、剔除背景引用、破除环） | 347 |
| `draft` | 已有的 draft explanation，含 proof steps / Lean annotations，但未评审，步骤顺序不自动等于依赖 DAG | 0 |
| `paper` | 从 pinned 论文 LaTeX 机器抽取：定理型陈述为节点，证明正文里的显式引用为边；当前所有可解析的族都已升级为 deep，此状态保留给后续新增或降级的族 | 0 |
| `lean` | 从 pinned comparator/solution 机器抽取的结构：形式化目标 → 求解定理 → 允许公理；不是定理级依赖图，未经评审 | 18 |
| `scaffold` | 只登记 claim、manuscripts、citations、upstream Lean scope；没有定理级证明链，也没有可抽取的论文/Lean 结构 | 7 |

论文结构当前覆盖 347 个族（548 篇论文、13,629 个陈述、14,401 条原始引用边）；其中 343 个已逐族核对并升级为 deep（剔除 726 条背景引用、8 条成环边后保留 13,411 条依赖边），4 个维持原手工深图。另有 25 个族没有可解析的 LaTeX（18 个保留 Lean 派生结构，7 个保持骨架）。

`scaffold` 不是“证明完成”，也不是“没有数学”。它表示来源记录已入索引，但定理陈述、证明依赖和 Lean 对齐尚未整理。

`paper` 也不是“证明已完成”。节点是论文的定理型陈述，边是证明环境中的显式 `\\ref` 引用；引用可能是背景、上下文或重复引用，页面不得把引用图写成经验证的证明依赖，也不得写成重放或评审。升级为 `deep` 的机器升级图在 caveats 中保留同样声明。

## 2. URL 与数据

- 全站索引：`/proof-evolution`
- family 页：`/proof-evolution/openai-math/{number}`
- family 003 的深图：`/proof-evolution/landau-siegel`
- family 032/084/159 的深图：`/proof-evolution/openai-math/{number}`（Matrix / Network 两种视图；Network 为力导向图，视觉语言对齐 family 003 的 Lean structure 章节）
- 机器可读索引：`/api/proof-maps`
- 目录快照：`data/publications/openai-math.json`
- 状态登记：`data/proof-maps/manifest.json`
- 深图数据：`data/proof-maps/deep/{number}.json`
- Lean 派生结构：不单独存数据文件，由 family 页从 `lean-coverage.json` 的 comparators 渲染（≥1 个具名定理的族进入 `lean` 状态）
- 论文派生结构：汇总 `data/proof-maps/paper-coverage.json`（计数），每族结构在 `data/proof-maps/paper/{number}.json`
- 论文结构抽取器：`scripts/build-proof-map-paper-index.mjs`（`npm run proof:maps:paper:build`）
- 深图校验器：`packages/domain/deep-proof-map.mjs`
- 索引生成器：`packages/domain/proof-map-index.mjs`
- 覆盖率报告：`npm run proof:maps:report`（`--json` 输出完整索引）

## 3. 状态提升规则

### scaffold → draft

1. 从论文中抽取明确的 theorem/lemma 陈述，并固定 paper / section / page。
2. 记录 proof steps；只有论文明确写出的依赖才写入 `dependsOn`。
3. 写 Lean annotations；没有 scope/Comparator 时明确写 `unknown / not_in_snapshot`。
4. 在 `data/publications/explanations/` 新增 artifact，并登记到 manifest 的 `draft`。
5. 保持 `status: draft`、`reviewStatus: unreviewed`。

### paper → deep

`paper` 是自动状态（论文 LaTeX 至少解析出一个定理型陈述即进入），优先级高于 `lean`。升级由 `npm run proof:maps:promote` 完成：逐族读取每条引用在证明中的上下文，剔除明确背景措辞（cf.、recall、as in、analogous 等），用 DFS 破除成环边，生成符合 `validateDeepProofMap` 的定理级图，并把族登记到 manifest 的 `deep`。生成图在 caveats 中声明“由论文结构机器升级、引用不是审计过的依赖、未经评审”。不满足契约的族会留在 `paper`。

### lean → deep

没有可解析论文的 `lean` 族仍可按上一节从论文补出定理级节点与依赖，而不是从 Lean 结构反推证明顺序。

### draft → deep

1. 为每条证明策略建立 theorem-level 节点和 `depends` 边；区分 `uses`、`cites`、`background`。
2. 为跨解法关系建立 `same-role` / `replaces` / `bypasses` 边；`same-role` 不是逻辑等价。
3. 为 Lean 建立 declaration/module 锚点；记录 toolchain、Mathlib revision、axiom/sorry 状态；未核验时明确标注。
4. 每个节点要有来源定位；推断的 paper→Lean 对齐必须标 `inferred`。
5. 通过独立评审后才改变 `reviewStatus`；Replay、评审、Receipt 是分开的证据门。

## 4. 不允许的捷径

- 不要从标题/摘要自动编造 proof steps。
- 不要把 Lean-derived 结构写成定理级依赖或证明 DAG；它只记录“形式化目标 → 求解定理 → 允许公理”。
- 不要把论文的引用图写成证明依赖图；`\ref` 可能指向背景、定义或重复引用。
- 不要把 citation graph 当作 proof dependency graph。
- 不要把 `same-role` 写成 logical implication。
- 不要把上游 Lean scope 写成 Proofweave replay。
- 不要因为 scaffold 没有 proof chain 就声称结果未证明。
- 不要把 49/199 页的更强定理写成同一 theorem 的“旧版本”；它们是 `implies`，不是同一证明。

## 5. 持续补全工作流

```text
catalog snapshot
  → scaffold entry (claim, manuscripts, scope, evidence gates)
  → paper-derived structure (statements + proof references, automatic)
  → lean-derived structure (pinned comparator → theorems → axioms, automatic)
  → draft explanation (proof steps + Lean annotations)
  → deep argument map (theorem edges + cross-solution links + Lean anchors)
  → independent review
  → replay / Receipt (separate gates)
```

每周用 `npm run proof:maps:report` 检查 deep/lean/draft/scaffold 数量和 scope 覆盖；优先挑 `scopeDocument=true` 的 scaffold，因为它们已经有 Lean scope 可作为对齐起点。深图数据用 `validateDeepProofMap` 校验节点引用、依赖无环、每条策略都有 final edge，并核对 Lean alignment 的 theorem name 与 module 确实出现在 `lean-coverage.json` 中。

## 6. Lean 结构批量抽取（2026-10-31）

`data/proof-maps/lean-coverage.json` 是从 pinned OpenAI repository 批量抽取的 comparator/solution 结构：

- 242 个 family 有 comparator;
- 426 个 comparator links（416 个唯一 challenge URL，部分 comparator 被多个 family 复用）;
- 426 个 comparator JSON、challenge `.lean`、solution module 全部成功抓取;
- 536 个 theorem names;
- solution module 的直接 imports、行数、declaration 摘要；
- textual sorry / axiom 统计为 0 / 0（这是源码文本扫描，不是 kernel 审计）。

生成命令：

```bash
npm run proof:maps:lean:build
```

数据只记录 **direct imports**，不展开完整传递闭包，也不运行 Lean build、`#print axioms` 或 comparator。页面上必须保持 `extracted`、`partial`、`missing` 三种状态，不能把 “solution module fetched” 写成 “kernel verified”。

下一阶段：

1. 对每个 comparator solution module 递归展开 OAI imports，形成 family 级 module graph；
2. 在可构建的 Lean 环境中跑 comparator / `#print axioms`，记录真实 kernel 状态；
3. 把 paper lemma 与 theorem_names/declaration 做人工对齐；
4. 继续处理 110 个多论文 + comparator family，并优先把已有 comparator 的 scaffold 提升为深图。

## 7. 第二批深图（032/084/159，2026-10-31）

第二批把三个已有 draft explanation 的 family 提升为 theorem-level deep map：

- **032 · Rational Hodge for CM abelian varieties**：单条主证明策略；§2 的 four-factor switch 与 Proposition 2.6 是论文自己的 reduction，André/Deligne 与 Hazama 只作为无边的 cited context。四篇 companion manuscript 作为 related work，不作为 Theorem 1.1 的 premise node。该 family 在 pinned snapshot 中没有 Lean scope/comparator，页面明确写“未链接”，不推断 Lean 存在与否。
- **084 · Erdős similarity, geometric case**：两条策略，general q（13 页）与 dyadic q=1/2（16 页）。两条策略共享 periodic hitting → index windows → routing → scales → global rescaling 的角色；跨解法边使用 `same-role` 和 `replaces`。Lean comparator 只对齐 dyadic Theorem 1.1，因此页面明确区分 general theorem 与 Lean-formalized special case。
- **159 · Erdős reciprocal sums**：单条 section-level 主策略；§2 的 triangular increment 由 §§3–9 的 detection/return/extraction 支撑，§10 迭代得到 Theorem 1.1，Corollary 1.2 是 Lean comparator 对齐的 reciprocal-sum consequence。外部 inverse theorem 与 almost-periodicity 标为 external input；quantitative bound 明确标注在 Lean alignment 之外。

这三个深图仍是 `reviewStatus: unreviewed`。它们没有 statement review、independent review、kernel check、Proofweave replay 或 Receipt；页面和 caveats 不得省略这一点。

## 8. 论文结构批量抽取（2026-11-02）

`data/proof-maps/paper-coverage.json` 与 `data/proof-maps/paper/{number}.json` 来自 pinned OpenAI repository 的 LaTeX 源：

- 从每篇论文的 `build/main.tex`、`paper.tex` 等入口递归读取 `\input` 的 section 文件；
- 节点是 `theorem` / `lemma` / `proposition` / `corollary` 环境，保留 label、标题、陈述摘要与所在 section；
- 边是 `proof` 环境里的 `\ref` 引用，方向为“被引用陈述 → 引用它的陈述”；
- 当前覆盖 347 个族、548 篇论文、13,629 个陈述、14,401 条引用边；25 个族没有可解析的 LaTeX；
- 抽取是纯文本解析，不运行 Lean、不验证引用是否真的是证明前提；
- family 页提供与 deep 相同的 Matrix / Network 交互视图：列是论文章节、行是论文、边是证明内引用；Lean 派生族也使用同一视图（行是 comparator、列是目标/定理/公理）。

生成命令：

```bash
npm run proof:maps:paper:build
```

缓存位于 `/tmp/proof-map-tex-cache`，按 repository + pinned revision 分目录；数据只对固定 revision 有效，换 revision 必须重跑。

已知边界：部分论文用单文件 LaTeX（如 `paper.tex`），部分 statement 没有 label（用合成 id，无法被其他论文内部引用）；数学公式在陈述摘要里会退化为近似纯文本。

逐族升级：

```bash
npm run proof:maps:promote            # 生成/更新 deep 图（已存在的策展深图不会被覆盖）
npm run proof:maps:promote -- --dry-run
npm run proof:maps:promote -- --family 005
```

抽样校准（2026-11-02）：从 26 个族抽取 200 条引用逐条判读，约 193 条是明确的依赖使用（Apply/use/by/gives/identifies/follows from 等），5 条是识别/提及（“the case is Lemma X”“the remaining assertions are Lemma X”），2 条是背景对照（“as in the preceding corollary”“recalled in …”）。全库中“we state / the statement of / is stated”等窄提及模式只有 14 条命中，其中多数仍是真的使用。因此默认保留的规则在抽样上精度约 96%，没有再做额外剔除；剩余的识别/提及边属于弱依赖，评审时可单独核对。

升级规则：证明环境中的 `\\ref` 引用若不含背景措辞（cf.、recall、as in、analogous、similarly 等）即视为依赖边；DFS 破除环；每族生成 section 级 roles 与一个 strategy/论文。每一张生成的 deep 图都在 caveats 中声明“由论文结构机器升级、引用不是审计过的依赖、未经评审”，`reviewStatus` 保持 `unreviewed`。不满足 `validateDeepProofMap` 的族留在 `paper`。
