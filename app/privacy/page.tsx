import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { PageTitle, SectionTitle, SectionHeading, Surface } from "@/app/components/ui";
import Link from "next/link";
import { PageSectionNav } from "../ui";
import { getI18n } from "@/app/i18n/server";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("privacy.metaTitle"), description: t("privacy.metaDescription") };
}

export default async function PrivacyPage() {
  const { t } = await getI18n();
  return <SiteFrame className="site-shell app-shell" active="about" activeHref="/privacy" mainClassName="page-main legal-main">
      <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/about">{t("nav.primary.about")}</Link><span> / </span><span>{t("nav.item.privacy")}</span></Breadcrumb>
      <SectionHeading as="section" className="legal-hero">
        <p className="eyebrow">{t("privacy.eyebrow")}</p>
        <PageTitle>{t("privacy.title")}</PageTitle>
        <p>{t("privacy.intro")}</p>
      </SectionHeading>
      <PageSectionNav label={t("common.onThisPage")} links={[{ href: "#identity", label: t("privacy.nav.identity") }, { href: "#stored-data", label: t("privacy.nav.stored") }, { href: "#workspace-boundary", label: t("privacy.nav.workspace") }, { href: "#processors", label: t("privacy.nav.processors") }, { href: "#control", label: t("privacy.nav.control") }, { href: "#deletion", label: t("privacy.nav.deletion") }]} />
      <section className="legal-sections">
        <PolicySection id="identity" title={t("privacy.identity.title")}>
          <p>{t("privacy.identity.body")}</p>
        </PolicySection>
        <PolicySection id="stored-data" title={t("privacy.stored.title")}>
          <p>{t("privacy.stored.body")}</p>
        </PolicySection>
        <PolicySection id="workspace-boundary" title={t("privacy.workspace.title")}>
          <p>{t("privacy.workspace.body")}</p>
        </PolicySection>
        <PolicySection title={t("privacy.public.title")}>
          <p>{t("privacy.public.body")}</p>
        </PolicySection>
        <PolicySection id="control" title={t("privacy.control.title")}>
          <p>{t("privacy.control.body")}</p>
        </PolicySection>
        <PolicySection id="processors" title={t("privacy.processors.title")}>
          <p>{t("privacy.processors.body")}</p>
        </PolicySection>
        <PolicySection id="deletion" title={t("privacy.deletion.title")}>
          <p>{t("privacy.deletion.bodyA")} <Link href="/support">{t("privacy.deletion.supportLink")}</Link>{t("privacy.deletion.bodyB")}</p>
        </PolicySection>
        <PolicySection title={t("privacy.infra.title")}>
          <p>{t("privacy.infra.bodyA")} <a href="https://github.com/alexyyyander/proofweave/issues" rel="noreferrer" target="_blank">{t("privacy.infra.issuesLink")} ↗</a>{t("privacy.infra.bodyB")} <a href="https://github.com/alexyyyander/proofweave/security/advisories/new" rel="noreferrer" target="_blank">{t("privacy.infra.advisoryLink")} ↗</a>{t("privacy.infra.bodyC")} <Link href="/support">{t("privacy.infra.supportLink")}</Link>{t("privacy.infra.bodyD")}</p>
        </PolicySection>
      </section>
    </SiteFrame>;
}

function PolicySection({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return <Surface as="article" id={id}><SectionTitle>{title}</SectionTitle>{children}</Surface>;
}
