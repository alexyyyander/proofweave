import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { PageTitle, SectionTitle, SectionHeading, Surface } from "@/app/components/ui";
import Link from "next/link";
import { PageSectionNav } from "../ui";
import { getI18n } from "@/app/i18n/server";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("terms.metaTitle"), description: t("terms.metaDescription") };
}

export default async function TermsPage() {
  const { t } = await getI18n();
  return <SiteFrame className="site-shell app-shell" active="about" activeHref="/privacy" mainClassName="page-main legal-main">
      <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/about">{t("nav.primary.about")}</Link><span> / </span><span>{t("nav.item.terms")}</span></Breadcrumb>
      <SectionHeading as="section" className="legal-hero">
        <p className="eyebrow">{t("terms.eyebrow")}</p>
        <PageTitle>{t("terms.title")}</PageTitle>
        <p>{t("terms.intro")}</p>
      </SectionHeading>
      <PageSectionNav label={t("common.onThisPage")} links={[{ href: "#claims", label: t("terms.nav.claims") }, { href: "#authority", label: t("terms.nav.authority") }, { href: "#license", label: t("terms.nav.license") }, { href: "#deletion", label: t("terms.nav.deletion") }, { href: "#conduct", label: t("terms.nav.conduct") }, { href: "#alpha", label: t("terms.nav.alpha") }]} />
      <section className="legal-sections">
        <Term id="claims" title={t("terms.claims.title")}>{t("terms.claims.body")}</Term>
        <Term id="authority" title={t("terms.authority.title")}>{t("terms.authority.body")}</Term>
        <Term title={t("terms.material.title")}>{t("terms.material.body")}</Term>
        <Term id="conduct" title={t("terms.conduct.title")}>{t("terms.conduct.body")}</Term>
        <Term title={t("terms.credit.title")}>{t("terms.credit.body")}</Term>
        <Term id="license" title={t("terms.license.title")}>{t("terms.license.body")}</Term>
        <Term id="deletion" title={t("terms.deletion.title")}>{t("terms.deletion.bodyA")} <Link href="/support">{t("terms.deletion.supportLink")}</Link>{t("terms.deletion.bodyB")}</Term>
        <Term title={t("terms.age.title")}>{t("terms.age.body")}</Term>
        <Term title={t("terms.abuse.title")}>{t("terms.abuse.bodyA")} <Link href="/support">{t("terms.abuse.supportLink")}</Link>{t("terms.abuse.bodyB")}</Term>
        <Term id="alpha" title={t("terms.alpha.title")}>{t("terms.alpha.body")}</Term>
        <Term title={t("terms.owner.title")}>{t("terms.owner.bodyA")} <a href="https://github.com/alexyyyander" rel="noreferrer" target="_blank">{t("terms.owner.creatorLink")} ↗</a>{t("terms.owner.bodyB")} <a href="https://github.com/alexyyyander/proofweave/issues" rel="noreferrer" target="_blank">{t("terms.owner.issuesLink")} ↗</a>{t("terms.owner.bodyC")} <a href="https://github.com/alexyyyander/proofweave/security/advisories/new" rel="noreferrer" target="_blank">{t("terms.owner.advisoryLink")} ↗</a>{t("terms.owner.bodyD")}</Term>
      </section>
    </SiteFrame>;
}

function Term({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return <Surface as="article" id={id}><SectionTitle>{title}</SectionTitle><p>{children}</p></Surface>;
}
