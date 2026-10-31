import { CardTitle, SectionTitle, ActionLink, PageIntro, SectionHeading, Surface } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { type Metadata } from "next";
import Link from "next/link";

import { HistoryTimeline, type EvidenceTone } from "./HistoryTimeline";
import { milestones } from "./milestones";
import { localizeMilestones, zhMilestoneCopy } from "./milestone-copy";
import { getI18n } from "@/app/i18n/server";
import { pathForLocale } from "@/app/i18n/config";
import type { TranslationKey } from "@/app/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getI18n();
  return {
    title: t("history.metaTitle"),
    description: t("history.metaDescription"),
    openGraph: {
      title: t("history.ogTitle"),
      description: t("history.ogDescription"),
      url: pathForLocale("/history", locale),
      locale: locale === "zh-CN" ? "zh_CN" : "en_US",
      alternateLocale: [locale === "zh-CN" ? "en_US" : "zh_CN"],
      images: ["/ai-mathematics-record-og.png"],
    },
    twitter: {
      card: "summary_large_image",
      title: t("history.ogTitle"),
      description: t("history.ogDescription"),
      images: ["/ai-mathematics-record-og.png"],
    },
  };
}

const evidenceLegend: Array<{ tone: EvidenceTone; labelKey: TranslationKey; detailKey: TranslationKey }> = [
  { tone: "formal", labelKey: "history.legend.formal.label", detailKey: "history.legend.formal.detail" },
  { tone: "reviewed", labelKey: "history.legend.reviewed.label", detailKey: "history.legend.reviewed.detail" },
  { tone: "reproduced", labelKey: "history.legend.reproduced.label", detailKey: "history.legend.reproduced.detail" },
  { tone: "announced", labelKey: "history.legend.announced.label", detailKey: "history.legend.announced.detail" },
  { tone: "corrected", labelKey: "history.legend.corrected.label", detailKey: "history.legend.corrected.detail" },
];

export default async function HistoryPage() {
  const { t, locale } = await getI18n();
  const displayMilestones = locale === "zh-CN" ? localizeMilestones(milestones, zhMilestoneCopy) : milestones;
  return <SiteFrame className="site-shell history-shell primary-page" active="history">
    <PageIntro tone="navy" label={t("nav.primary.aiRecord")} title={t("history.title")}
      description={t("history.description")}
      actions={<><ActionLink variant="primary" href="#timeline">{t("history.action.timeline")} <span aria-hidden="true">↓</span></ActionLink><ActionLink variant="secondary" href="#lean-replay">{t("history.action.replay")} <span aria-hidden="true">→</span></ActionLink></>}
      meta={<><span>{t("history.meta.range")}</span><span>{t("history.meta.milestones", { count: milestones.length })}</span><span>{t("history.meta.updated")}</span></>} />

    <section className="history-legend" aria-labelledby="evidence-legend-title"><div><p className="eyebrow">{t("history.legend.eyebrow")}</p><SectionTitle id="evidence-legend-title">{t("history.legend.title")}</SectionTitle></div><div className="history-legend-grid">{evidenceLegend.map((item) => <Surface as="article" key={item.tone}><span className={`history-state is-${item.tone}`}>{t(item.labelKey)}</span><p>{t(item.detailKey)}</p></Surface>)}</div></section>

    <section className="history-replay" id="lean-replay" aria-labelledby="history-replay-title"><SectionHeading as="div" className="history-replay-heading"><div><p className="eyebrow">{t("history.replay.eyebrow")}</p><SectionTitle id="history-replay-title">{t("history.replay.title")}</SectionTitle></div><p>{t("history.replay.body")}</p></SectionHeading><div className="history-replay-grid"><Surface as="article"><span className="history-replay-index">{t("history.replay.openai.index")}</span><CardTitle>{t("history.replay.openai.title")}</CardTitle><p>{t("history.replay.openai.body")}</p><div className="history-replay-actions"><a href="https://github.com/openai/math/tree/1581d4cbdd69a0faf34b2089614fe2a814316a6a/lean" rel="noreferrer" target="_blank">{t("history.replay.openai.open")} <span aria-hidden="true">↗</span></a><Link href="/publications">{t("history.replay.openai.browse")} <span aria-hidden="true">→</span></Link></div></Surface><Surface as="article"><span className="history-replay-index">{t("history.replay.zeta.index")}</span><CardTitle>{t("history.replay.zeta.title")}</CardTitle><p>{t("history.replay.zeta.body")}</p><div className="history-replay-actions"><a href="https://github.com/anthropics/zeta-23-lean" rel="noreferrer" target="_blank">{t("history.replay.zeta.open")} <span aria-hidden="true">↗</span></a><Link href="/workbench?target=riemann-hypothesis#research-launcher">{t("history.replay.zeta.start")} <span aria-hidden="true">→</span></Link></div></Surface><Surface as="article"><span className="history-replay-index">{t("history.replay.owner.index")}</span><CardTitle>{t("history.replay.owner.title")}</CardTitle><p>{t("history.replay.owner.body")}</p><div className="history-replay-actions"><Link href="/workbench?target=riemann-hypothesis#research-launcher">{t("history.replay.owner.open")} <span aria-hidden="true">→</span></Link><Link href="/demo#verification-console">{t("history.replay.owner.inspect")} <span aria-hidden="true">→</span></Link></div></Surface></div></section>

    <p className="history-update-note">{t("history.updateNote")}</p>

    <HistoryTimeline milestones={displayMilestones} />

    <section className="history-method" aria-labelledby="hodge-status-title"><div><p className="eyebrow">{t("history.hodge.eyebrow")}</p><SectionTitle id="hodge-status-title">{t("history.hodge.title")}</SectionTitle></div><p>{t("history.hodge.bodyA")}{" "}<a href="https://github.com/openai/math/blob/1581d4cbdd69a0faf34b2089614fe2a814316a6a/history.md" target="_blank" rel="noreferrer">{t("history.hodge.correctionLog")}</a>{" "}{t("history.hodge.bodyB")}{" "}<a href="https://www.claymath.org/millennium/hodge-conjecture/" target="_blank" rel="noreferrer">{t("history.hodge.clay")}</a>{t("history.hodge.bodyC")}{" "}<Link href="/publications/openai-math/032">{t("history.hodge.inspect")} →</Link></p></section>

    <section className="history-method"><div><p className="eyebrow">{t("history.method.eyebrow")}</p><SectionTitle>{t("history.method.title")}</SectionTitle></div><div className="history-method-flow" aria-label={t("history.method.flowAria")}><span>{t("history.method.flow.problem")}</span><i aria-hidden="true">→</i><span>{t("history.method.flow.ai")}</span><i aria-hidden="true">→</i><span>{t("history.method.flow.human")}</span><i aria-hidden="true">→</i><span>{t("history.method.flow.evidence")}</span><i aria-hidden="true">→</i><span>{t("history.method.flow.record")}</span></div><p>{t("history.method.body")}</p></section>

    <section className="history-cta"><div><p className="eyebrow">{t("history.cta.eyebrow")}</p><SectionTitle>{t("history.cta.title")}</SectionTitle></div><div><p>{t("history.cta.body")}</p><div className="button-row"><ActionLink className="button button-primary" href="/explore">{t("history.cta.explore")} <span aria-hidden="true">→</span></ActionLink><ActionLink className="button button-secondary" href="/demo">{t("history.cta.demo")}</ActionLink></div></div></section>
  </SiteFrame>;
}
