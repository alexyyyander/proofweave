import type { Metadata } from "next";
import Link from "next/link";
import { PageSectionNav } from "../ui";
import { PageIntro, SectionTitle } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";
import "../introduction.css";
import { getI18n } from "@/app/i18n/server";

export async function generateMetadata(): Promise<Metadata> { const { t } = await getI18n(); return { title: t("about.metaTitle"), description: t("about.metaDescription") }; }

export default async function AboutPage() {
  const { t } = await getI18n();
  return <SiteFrame className="site-shell app-shell" active="about" mainClassName="page-main reading-main intro-main">
      <PageIntro label={t("intro.merge1")} title={t("intro.merge2")} description={t("intro.merge3")} />
      <PageSectionNav label={t("common.onThisPage")} links={[{ href: "#principles", label: t("intro.merge4") }, { href: "#catalog-standard", label: t("intro.merge5") }, { href: "#shared-research", label: t("intro.merge6") }, { href: "#builder", label: t("intro.merge7") }]} />
      <section className="intro-section" id="principles" aria-labelledby="principles-title">
        <span className="intro-number">{t("intro.merge8")}</span>
        <div><SectionTitle id="principles-title">{t("intro.merge9")}</SectionTitle>
          <p>{t("intro.merge10")}</p>
          <p>{t("intro.merge11")}</p>
          <Link className="text-link" href="/privacy">{t("intro.merge12")} <span aria-hidden="true">→</span></Link>
        </div>
      </section>
      <section className="intro-section" id="catalog-standard" aria-labelledby="catalog-title">
        <span className="intro-number">{t("intro.merge13")}</span>
        <div><SectionTitle id="catalog-title">{t("intro.merge14")}</SectionTitle>
          <p>{t("intro.merge15")}</p>
          <p>{t("intro.merge16")}</p>
          <a className="text-link" href="https://github.com/alexyyyander/proofweave-open-catalog" target="_blank" rel="noreferrer">{t("intro.merge17")} <span aria-hidden="true">↗</span></a>
        </div>
      </section>
      <section className="intro-section" id="shared-research" aria-labelledby="shared-title">
        <span className="intro-number">{t("intro.merge18")}</span>
        <div><SectionTitle id="shared-title">{t("intro.merge19")}</SectionTitle>
          <p>{t("intro.merge20")}</p>
          <p>{t("intro.merge21")}</p>
          <Link className="text-link" href="/explore">{t("intro.merge22")} <span aria-hidden="true">→</span></Link>
        </div>
      </section>
      <section className="intro-project" id="builder" aria-labelledby="builder-title">
        <p className="eyebrow">{t("intro.merge23")}</p>
        <SectionTitle id="builder-title">{t("intro.merge24")}</SectionTitle>
        <p>{t("intro.merge25")}</p>
        <a className="text-link" href="https://github.com/alexyyyander" target="_blank" rel="noreferrer">{t("intro.merge26")} <span aria-hidden="true">↗</span></a>
      </section>
      <div className="reading-actions"><Link className="button button-primary" href="/how-it-works">{t("intro.merge27")} <span aria-hidden="true">→</span></Link><Link className="button button-secondary" href="/explore">{t("intro.merge28")}</Link></div>
    </SiteFrame>;
}
