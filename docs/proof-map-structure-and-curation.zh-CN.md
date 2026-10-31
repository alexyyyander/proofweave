# Proof map 结构与持续补全（2026-10-31）

本文说明网站上的 proof-map 结构、状态等级和持续补全流程。它不是发布授权；任何 replay、评审、Receipt 或部署仍需各自证据。

## 1. 三类结构

| 状态 | 含义 | 当前数量 |
| --- | --- | --- |
| `deep` | 已整理的 theorem-level argument map，含版本、依赖、跨解法关系、Lean 对齐和来源定位 | 1（family 003） |
| `draft` | 已有的 draft explanation，含 proof steps / Lean annotations，但未评审，步骤顺序不自动等于依赖 DAG | 3（032、084、159） |
| `scaffold` | 只登记 claim、manuscripts、citations、upstream Lean scope；没有 theorem-level proof chain | 368 |

`scaffold` 不是“证明完成”，也不是“没有数学”。它表示来源记录已入索引，但定理陈述、证明依赖和 Lean 对齐尚未整理。

## 2. URL 与数据

- 全站索引：`/proof-evolution`
- family 页：`/proof-evolution/openai-math/{number}`
- family 003 的深图：`/proof-evolution/landau-siegel`
- 机器可读索引：`/api/proof-maps`
- 目录快照：`data/publications/openai-math.json`
- 状态登记：`data/proof-maps/manifest.json`
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

每周用 `npm run proof:maps:report` 检查 deep/draft/scaffold 数量和 scope 覆盖；优先挑 `scopeDocument=true` 的 scaffold，因为它们已经有 Lean scope 可作为对齐起点。
