import type { Metadata } from "next";
import Link from "next/link";
import { PageSectionNav } from "../ui";
import { PageTitle, SectionTitle } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";
import "../introduction.css";
import { getI18n } from "@/app/i18n/server";

export async function generateMetadata(): Promise<Metadata> { const { t } = await getI18n(); return { title: t("how.metaTitle"), description: t("how.metaDescription") }; }

export default async function HowItWorksPage() {
  const { t } = await getI18n();
  return <SiteFrame className="site-shell app-shell" active="how" mainClassName="page-main reading-main intro-main">
      <section className="reading-hero">
        <p className="eyebrow">{t("intro.merge29")}</p>
        <PageTitle>{t("intro.merge30")}</PageTitle>
        <p>{t("intro.merge31")}</p>
      </section>
      <PageSectionNav label={t("common.onThisPage")} links={[{ href: "#research", label: t("intro.merge32") }, { href: "#verification", label: t("intro.merge33") }, { href: "#contribution-records", label: t("intro.merge34") }]} />
      <section className="intro-section" id="research" aria-labelledby="research-title">
        <span className="intro-number">{t("intro.merge35")}</span>
        <div><SectionTitle id="research-title">{t("intro.merge36")}</SectionTitle>
          <p>{t("intro.merge37")}</p>
          <p>{t("intro.merge38")}</p>
          <Link className="text-link" href="/explore">{t("intro.merge39")} <span aria-hidden="true">→</span></Link>
        </div>
      </section>
      <section className="intro-section" id="verification" aria-labelledby="verification-title">
        <span className="intro-number">{t("intro.merge40")}</span>
        <div><SectionTitle id="verification-title">{t("intro.merge41")}</SectionTitle>
          <p>{t("intro.merge42")}</p>
          <p>{t("intro.merge43")}</p>
          <Link className="text-link" href="/reviews">{t("intro.merge44")} <span aria-hidden="true">→</span></Link>
        </div>
      </section>
      <section className="intro-section" id="contribution-records" aria-labelledby="records-title">
        <span className="intro-number">{t("intro.merge45")}</span>
        <div><SectionTitle id="records-title">{t("intro.merge46")}</SectionTitle>
          <p>{t("intro.merge47")}</p>
          <p>{t("intro.merge48")}</p>
          <Link className="text-link" href="/receipts">{t("intro.merge49")} <span aria-hidden="true">→</span></Link>
        </div>
      </section>
      <div className="reading-actions"><Link className="button button-primary" href="/explore">{t("intro.merge50")} <span aria-hidden="true">→</span></Link><Link className="button button-secondary" href="/about">{t("intro.merge51")}</Link></div>
    </SiteFrame>;
}
