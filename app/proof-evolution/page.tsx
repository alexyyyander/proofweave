import type { Metadata } from "next";
import Link from "next/link";
import { ActionLink, Badge, PageIntro } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";
import { openaiMathCollection } from "@/app/lib/publications";
import type { LeanCoverageData, ProofMapIndex } from "@/app/lib/proof-map";
import manifest from "@/data/proof-maps/manifest.json";
import leanCoverage from "@/data/proof-maps/lean-coverage.json";
import { buildProofMapIndex } from "@/packages/domain/proof-map-index.mjs";
import { ProofMapIndexView } from "./ProofMapIndexView";
import "./proof-map.css";

export const metadata: Metadata = {
  title: "Proof maps",
  description: "A source-linked index of every OpenAI mathematics result family, with deep argument maps, draft proof chains, and metadata scaffolds for continuous curation.",
};

export default function ProofMapIndexPage() {
  const index = buildProofMapIndex(openaiMathCollection, manifest, leanCoverage as LeanCoverageData) as ProofMapIndex;
  return <SiteFrame
    active="publications"
    activeHref="/proof-evolution"
    className="site-shell app-shell primary-page proof-map-index-shell"
    mainClassName="page-main proof-map-index-main"
  >
    <PageIntro
      label="Proof maps · all mathematics"
      title="Every result gets a structure."
      description="The same structure now covers the whole OpenAI mathematics release: claim, source manuscripts, upstream Lean scope, extracted comparator/solution modules, and evidence state. Deep and draft structures add theorem-level proof dependencies; every remaining family gets a source-linked scaffold with an explicit next curation step."
      meta={<>
        <span>{index.summary.families} result families</span>
        <span>{index.summary.manuscripts} manuscripts</span>
        <span>Catalog snapshot {openaiMathCollection.indexedAt.slice(0, 10)}</span>
        <span>Proofweave replay pending for every family</span>
      </>}
      actions={<>
        <ActionLink variant="primary" href="/proof-evolution/landau-siegel">Open the 003 deep map</ActionLink>
        <ActionLink variant="secondary" href="/publications">Browse publications</ActionLink>
        <Link className="button button-secondary" href="/api/proof-maps" prefetch={false}>Download index JSON ↓</Link>
      </>}
      aside={<>
        <strong>Coverage at a glance</strong>
        <div className="proof-map-aside-stats">
          <span><b>{index.summary.deep}</b> deep</span>
          <span><b>{index.summary.draft}</b> draft</span>
          <span><b>{index.summary.scaffold}</b> scaffold</span>
        </div>
        <p>Deep maps are curated. Draft chains are unreviewed. Scaffolds are source-linked metadata with no theorem-level chain yet. Lean structures are extracted from comparator/solution modules, not kernel-checked by Proofweave.</p>
        <Link href="/about#catalog-standard">How the catalog records evidence →</Link>
      </>}
    />

    <div className="proof-map-index-content">
      <section className="proof-map-coverage" aria-label="Proof map coverage">
        <CoverageStat label="Result families" value={index.summary.families} detail={`${index.summary.subjects} subjects`} />
        <CoverageStat label="Source manuscripts" value={index.summary.manuscripts} detail={`${index.summary.scopeDocuments} families with Lean scope`} />
        <CoverageStat label="Upstream linked" value={index.summary.formalizedManuscripts} detail={`manuscripts named in scope/index · ${index.summary.comparatorLinks} comparator links`} />
        <CoverageStat label="Lean structures" value={index.summary.leanFamilies} detail={`${index.summary.leanSolutionModules} solution modules extracted`} />
        <CoverageStat label="Lean theorem names" value={index.summary.leanTheoremNames} detail="comparator declarations · textual sorry/axiom 0" />
        <CoverageStat label="Deep maps" value={index.summary.deep} detail="curated theorem dependencies" />
        <CoverageStat label="Draft chains" value={index.summary.draft} detail="unreviewed explanations" />
        <CoverageStat label="Scaffolds" value={index.summary.scaffold} detail="the curation queue" />
      </section>

      <section className="proof-map-status-legend" aria-label="Proof map status levels">
        <article className="status-deep">
          <Badge tone="positive">Deep argument map</Badge>
          <strong>{index.summary.deep}</strong>
          <p>Curated theorem-level dependencies, cross-solution links, source-located Lean alignment, and an inspectable proof detail drawer.</p>
        </article>
        <article className="status-draft">
          <Badge tone="warning">Draft proof chain</Badge>
          <strong>{index.summary.draft}</strong>
          <p>An existing explanation artifact with proof steps and Lean annotations. It is unreviewed and does not claim a verified dependency DAG.</p>
        </article>
        <article className="status-scaffold">
          <Badge>Metadata scaffold</Badge>
          <strong>{index.summary.scaffold}</strong>
          <p>Claim, manuscripts, citations, and any upstream Lean scope are indexed. The theorem-level proof chain has not been curated yet.</p>
        </article>
      </section>

      <div className="proof-map-method-note">
        <strong>Scaffold is not a proof claim.</strong>
        <p>A scaffold says the source record exists and tells us exactly what to fill next. It never invents proof steps, Lean declarations, cross-solution links, or a review state. Use the status filters to turn the index into a curation queue.</p>
      </div>

      <ProofMapIndexView entries={index.entries} subjects={index.subjects} summary={index.summary} />
    </div>
  </SiteFrame>;
}

function CoverageStat({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <div className="proof-map-coverage-stat">
    <span>{label}</span>
    <strong>{value.toLocaleString("en-US")}</strong>
    <small>{detail}</small>
  </div>;
}
