# Proof map 结构与持续补全（2026-10-31）

本文说明网站上的 proof-map 结构、状态等级和持续补全流程。它不是发布授权；任何 replay、评审、Receipt 或部署仍需各自证据。

## 1. 三类结构

| 状态 | 含义 | 当前数量 |
| --- | --- | --- |
| `deep` | 已整理的 theorem-level argument map，含版本、依赖、跨解法关系、Lean 对齐和来源定位 | 4（003、032、084、159） |
| `draft` | 已有的 draft explanation，含 proof steps / Lean annotations，但未评审，步骤顺序不自动等于依赖 DAG | 0 |
| `scaffold` | 只登记 claim、manuscripts、citations、upstream Lean scope；没有 theorem-level proof chain | 368 |

`scaffold` 不是“证明完成”，也不是“没有数学”。它表示来源记录已入索引，但定理陈述、证明依赖和 Lean 对齐尚未整理。

## 2. URL 与数据

- 全站索引：`/proof-evolution`
- family 页：`/proof-evolution/openai-math/{number}`
- family 003 的深图：`/proof-evolution/landau-siegel`
- family 032/084/159 的深图：`/proof-evolution/openai-math/{number}`
- 机器可读索引：`/api/proof-maps`
- 目录快照：`data/publications/openai-math.json`
- 状态登记：`data/proof-maps/manifest.json`
- 深图数据：`data/proof-maps/deep/{number}.json`
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

### draft → deep

1. 为每条证明策略建立 theorem-level 节点和 `depends` 边；区分 `uses`、`cites`、`background`。
2. 为跨解法关系建立 `same-role` / `replaces` / `bypasses` 边；`same-role` 不是逻辑等价。
3. 为 Lean 建立 declaration/module 锚点；记录 toolchain、Mathlib revision、axiom/sorry 状态；未核验时明确标注。
4. 每个节点要有来源定位；推断的 paper→Lean 对齐必须标 `inferred`。
5. 通过独立评审后才改变 `reviewStatus`；Replay、评审、Receipt 是分开的证据门。

## 4. 不允许的捷径

- 不要从标题/摘要自动编造 proof steps。
- 不要把 citation graph 当作 proof dependency graph。
- 不要把 `same-role` 写成 logical implication。
- 不要把上游 Lean scope 写成 Proofweave replay。
- 不要因为 scaffold 没有 proof chain 就声称结果未证明。
- 不要把 49/199 页的更强定理写成同一 theorem 的“旧版本”；它们是 `implies`，不是同一证明。

## 5. 持续补全工作流

```text
catalog snapshot
  → scaffold entry (claim, manuscripts, scope, evidence gates)
  → draft explanation (proof steps + Lean annotations)
  → deep argument map (theorem edges + cross-solution links + Lean anchors)
  → independent review
  → replay / Receipt (separate gates)
```

每周用 `npm run proof:maps:report` 检查 deep/draft/scaffold 数量和 scope 覆盖；优先挑 `scopeDocument=true` 的 scaffold，因为它们已经有 Lean scope 可作为对齐起点。深图数据用 `validateDeepProofMap` 校验节点引用、依赖无环、每条策略都有 final edge，并核对 Lean alignment 的 theorem name 与 module 确实出现在 `lean-coverage.json` 中。

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
