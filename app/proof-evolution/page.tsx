import type { Metadata } from "next";
import Link from "next/link";
import { ActionLink, Badge, PageIntro } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";
import { openaiMathCollection } from "@/app/lib/publications";
import type { LeanCoverageData, PaperCoverageData, ProofMapIndex } from "@/app/lib/proof-map";
import manifest from "@/data/proof-maps/manifest.json";
import leanCoverage from "@/data/proof-maps/lean-coverage.json";
import paperCoverage from "@/data/proof-maps/paper-coverage.json";
import { buildProofMapIndex } from "@/packages/domain/proof-map-index.mjs";
import { getI18n } from "@/app/i18n/server";
import type { Locale } from "@/app/i18n/config";
import { ProofMapIndexView } from "./ProofMapIndexView";
import "./proof-map.css";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t("proofMaps.meta.title"),
    description: t("proofMaps.meta.description"),
  };
}

export default async function ProofMapIndexPage() {
  const { t, locale } = await getI18n();
  const index = buildProofMapIndex(openaiMathCollection, manifest, leanCoverage as LeanCoverageData, paperCoverage as PaperCoverageData) as ProofMapIndex;
  return <SiteFrame
    active="publications"
    activeHref="/proof-evolution"
    className="site-shell app-shell primary-page proof-map-index-shell"
    mainClassName="page-main proof-map-index-main"
  >
    <PageIntro
      label={t("proofMaps.index.label")}
      title={t("proofMaps.index.title")}
      description={t("proofMaps.index.description")}
      meta={<>
        <span>{t("proofMaps.index.metaFamilies", { count: index.summary.families })}</span>
        <span>{t("proofMaps.index.metaManuscripts", { count: index.summary.manuscripts })}</span>
        <span>{t("proofMaps.index.metaSnapshot", { date: openaiMathCollection.indexedAt.slice(0, 10) })}</span>
        <span>{t("proofMaps.index.metaReplayPending")}</span>
      </>}
      actions={<>
        <ActionLink variant="primary" href="/proof-evolution/landau-siegel">{t("proofMaps.index.openDeep")}</ActionLink>
        <ActionLink variant="secondary" href="/publications">{t("proofMaps.index.browsePublications")}</ActionLink>
        <Link className="button button-secondary" href="/api/proof-maps" prefetch={false}>{t("proofMaps.index.downloadJson")}</Link>
      </>}
      aside={<>
        <strong>{t("proofMaps.index.asideTitle")}</strong>
        <div className="proof-map-aside-stats">
          <span><b>{index.summary.deep}</b> {t("proofMaps.index.asideDeep")}</span>
          <span><b>{index.summary.draft}</b> {t("proofMaps.index.asideDraft")}</span>
          <span><b>{index.summary.paper}</b> {t("proofMaps.index.asidePaper")}</span>
          <span><b>{index.summary.lean}</b> {t("proofMaps.index.asideLean")}</span>
          <span><b>{index.summary.scaffold}</b> {t("proofMaps.index.asideScaffold")}</span>
        </div>
        <p>{t("proofMaps.index.asideBody")}</p>
        <Link href="/about#catalog-standard">{t("proofMaps.index.asideLink")}</Link>
      </>}
    />

    <div className="proof-map-index-content">
      <section className="proof-map-coverage" aria-label={t("proofMaps.index.coverageAria")}>
        <CoverageStat locale={locale} label={t("proofMaps.index.coverage.families.label")} value={index.summary.families} detail={t("proofMaps.index.coverage.families.detail", { count: index.summary.subjects })} />
        <CoverageStat locale={locale} label={t("proofMaps.index.coverage.manuscripts.label")} value={index.summary.manuscripts} detail={t("proofMaps.index.coverage.manuscripts.detail", { count: index.summary.scopeDocuments })} />
        <CoverageStat locale={locale} label={t("proofMaps.index.coverage.upstream.label")} value={index.summary.formalizedManuscripts} detail={t("proofMaps.index.coverage.upstream.detail", { count: index.summary.comparatorLinks })} />
        <CoverageStat locale={locale} label={t("proofMaps.index.coverage.leanStructures.label")} value={index.summary.leanFamilies} detail={t("proofMaps.index.coverage.leanStructures.detail", { count: index.summary.leanSolutionModules })} />
        <CoverageStat locale={locale} label={t("proofMaps.index.coverage.theoremNames.label")} value={index.summary.leanTheoremNames} detail={t("proofMaps.index.coverage.theoremNames.detail")} />
        <CoverageStat locale={locale} label={t("proofMaps.index.coverage.deep.label")} value={index.summary.deep} detail={t("proofMaps.index.coverage.deep.detail")} />
        <CoverageStat locale={locale} label={t("proofMaps.index.coverage.draft.label")} value={index.summary.draft} detail={t("proofMaps.index.coverage.draft.detail")} />
        <CoverageStat locale={locale} label={t("proofMaps.index.coverage.paper.label")} value={index.summary.paper} detail={t("proofMaps.index.coverage.paper.detail", { statements: index.summary.paperStatements, edges: index.summary.paperEdges })} />
        <CoverageStat locale={locale} label={t("proofMaps.index.coverage.lean.label")} value={index.summary.lean} detail={t("proofMaps.index.coverage.lean.detail")} />
        <CoverageStat locale={locale} label={t("proofMaps.index.coverage.scaffolds.label")} value={index.summary.scaffold} detail={t("proofMaps.index.coverage.scaffolds.detail")} />
      </section>

      <section className="proof-map-status-legend" aria-label={t("proofMaps.index.legendAria")}>
        <article className="status-deep">
          <Badge tone="positive">{t("proofMaps.index.statusDeep")}</Badge>
          <strong>{index.summary.deep}</strong>
          <p>{t("proofMaps.index.deepBody")}</p>
        </article>
        <article className="status-draft">
          <Badge tone="warning">{t("proofMaps.index.statusDraft")}</Badge>
          <strong>{index.summary.draft}</strong>
          <p>{t("proofMaps.index.draftBody")}</p>
        </article>
        <article className="status-paper">
          <Badge>{t("proofMaps.index.statusPaper")}</Badge>
          <strong>{index.summary.paper}</strong>
          <p>{t("proofMaps.index.paperBody")}</p>
        </article>
        <article className="status-lean">
          <Badge>{t("proofMaps.index.statusLean")}</Badge>
          <strong>{index.summary.lean}</strong>
          <p>{t("proofMaps.index.leanBody")}</p>
        </article>
        <article className="status-scaffold">
          <Badge>{t("proofMaps.index.statusScaffold")}</Badge>
          <strong>{index.summary.scaffold}</strong>
          <p>{t("proofMaps.index.scaffoldBody")}</p>
        </article>
      </section>

      <div className="proof-map-method-note">
        <strong>{t("proofMaps.index.methodTitle")}</strong>
        <p>{t("proofMaps.index.methodBody")}</p>
      </div>

      <ProofMapIndexView entries={index.entries} subjects={index.subjects} summary={index.summary} />
    </div>
  </SiteFrame>;
}

function CoverageStat({ locale, label, value, detail }: { locale: Locale; label: string; value: number; detail: string }) {
  return <div className="proof-map-coverage-stat">
    <span>{label}</span>
    <strong>{value.toLocaleString(locale)}</strong>
    <small>{detail}</small>
  </div>;
}
