import Link from "next/link";
import { Badge, Surface } from "@/app/components/ui";
import type { LeanCoverageFamily, ProofMapIndexEntry } from "@/app/lib/proof-map";
import type { Translator } from "@/app/i18n/translate";

/**
 * A machine-extracted structure for families without a curated proof spine.
 * Every node comes from the pinned comparator/solution files: the formal
 * target, the named proving theorems, and the permitted axioms. The component
 * deliberately does not draw lemma-level dependency edges it cannot source.
 */
export function LeanDerivedMap({ family, entry, t }: {
  family: LeanCoverageFamily;
  entry: ProofMapIndexEntry;
  t: Translator;
}) {
  return <section id="lean-derived-map" className="lean-derived-map" aria-labelledby="lean-derived-map-title">
    <div className="proof-map-family-section-heading">
      <div>
        <p className="eyebrow">{t("proofMaps.derived.eyebrow")}</p>
        <h2 id="lean-derived-map-title">{t("proofMaps.derived.title")}</h2>
      </div>
      <span>{t("proofMaps.derived.meta", {
        comparators: t(family.comparatorCount === 1 ? "proofMaps.derived.comparatorOne" : "proofMaps.derived.comparatorOther", { count: family.comparatorCount }),
        theorems: t(family.theoremNames.length === 1 ? "proofMaps.derived.theoremOne" : "proofMaps.derived.theoremOther", { count: family.theoremNames.length }),
      })}</span>
    </div>
    <p className="lean-derived-intro">{t("proofMaps.derived.body")}</p>

    <Surface tone="inset" className="lean-derived-claim">
      <span>{t("proofMaps.derived.claimLabel")}</span>
      <p>{entry.claimSnippet}</p>
      <Link href={entry.publicationRoute}>{t("proofMaps.derived.claimSource")}</Link>
    </Surface>

    <div className="lean-derived-comparators">
      {family.comparators.map((comparator, index) => <Surface tone="card" className="lean-derived-comparator" key={comparator.label}>
        <header className="lean-derived-comparator-heading">
          <span>{t("proofMaps.derived.comparator", { index: index + 1 })}</span>
          <a href={comparator.challengeUrl} target="_blank" rel="noreferrer">{comparator.label} ↗</a>
        </header>
        <div className="lean-derived-chain">
          <div className="lean-derived-node is-target">
            <span className="lean-derived-node-label">{t("proofMaps.derived.target")}</span>
            <code>{comparator.label}</code>
            <small>{t("proofMaps.derived.targetDetail")}</small>
          </div>
          <i className="lean-derived-arrow" aria-hidden="true">→</i>
          <div className="lean-derived-node is-theorems">
            <span className="lean-derived-node-label">{t("proofMaps.derived.theorems")}</span>
            {comparator.theoremNames.length > 0
              ? <ul>{comparator.theoremNames.map((name) => <li key={name}><code>{name}</code></li>)}</ul>
              : <small>{t("proofMaps.derived.noTheorems")}</small>}
          </div>
          <i className="lean-derived-arrow" aria-hidden="true">→</i>
          <div className="lean-derived-node is-axioms">
            <span className="lean-derived-node-label">{t("proofMaps.derived.axioms")}</span>
            {comparator.permittedAxioms.length > 0
              ? <div className="lean-derived-axioms">{comparator.permittedAxioms.map((axiom) => <Badge key={axiom}>{axiom}</Badge>)}</div>
              : <small>{t("proofMaps.derived.noAxioms")}</small>}
          </div>
        </div>
        <footer className="lean-derived-comparator-foot">
          <span>{t("proofMaps.derived.solution")}{" "}
            {comparator.solutionUrl && comparator.solutionModule
              ? <a href={comparator.solutionUrl} target="_blank" rel="noreferrer"><code>{comparator.solutionModule}</code> ↗</a>
              : <code>{comparator.solutionModule ?? t("proofMaps.family.noSolutionModule")}</code>}
          </span>
          <span>{t("proofMaps.derived.moduleStats", { lines: comparator.solutionLines, imports: comparator.solutionImports.length })}</span>
        </footer>
      </Surface>)}
    </div>

    <p className="lean-derived-note">{t("proofMaps.derived.boundary")}</p>
  </section>;
}
