import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { PageTitle, SectionTitle, SectionHeading, Surface, ActionLink } from "@/app/components/ui";
import Link from "next/link";
import { PageSectionNav } from "../ui";
import { getI18n } from "@/app/i18n/server";
import type { Metadata } from "next";
import type { TranslationKey } from "@/app/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("support.metaTitle"), description: t("support.metaDescription") };
}

const channels: readonly { titleKey: TranslationKey; copyKey: TranslationKey; actionKey: TranslationKey; href: string }[] = [
  { titleKey: "support.channels.general.title", copyKey: "support.channels.general.copy", actionKey: "support.channels.general.action", href: "https://github.com/alexyyyander/proofweave/issues" },
  { titleKey: "support.channels.security.title", copyKey: "support.channels.security.copy", actionKey: "support.channels.security.action", href: "https://github.com/alexyyyander/proofweave/security/advisories/new" },
  { titleKey: "support.channels.privacy.title", copyKey: "support.channels.privacy.copy", actionKey: "support.channels.privacy.action", href: "https://github.com/alexyyyander/proofweave/security/advisories/new" },
  { titleKey: "support.channels.abuse.title", copyKey: "support.channels.abuse.copy", actionKey: "support.channels.abuse.action", href: "https://github.com/alexyyyander/proofweave/issues" },
];

export default async function SupportPage() {
  const { t } = await getI18n();
  return <SiteFrame className="site-shell app-shell" active="about" mainClassName="page-main legal-main">
    <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/about">{t("nav.primary.about")}</Link><span> / </span><span>{t("nav.item.support")}</span></Breadcrumb>
    <SectionHeading as="section" className="legal-hero">
      <p className="eyebrow">{t("support.eyebrow")}</p>
      <PageTitle>{t("support.title")}</PageTitle>
      <p>{t("support.intro")}</p>
    </SectionHeading>
    <PageSectionNav label={t("common.onThisPage")} links={[{ href: "#channels", label: t("support.nav.channels") }, { href: "#response", label: t("support.nav.response") }, { href: "/privacy", label: t("nav.item.privacy") }, { href: "/terms", label: t("nav.item.terms") }]} />

    <section className="legal-sections" id="channels">
      {channels.map((channel) => <Surface as="article" key={channel.titleKey}>
        <SectionTitle>{t(channel.titleKey)}</SectionTitle>
        <p>{t(channel.copyKey)}</p>
        <a className="text-link" href={channel.href} rel="noreferrer" target="_blank">{t(channel.actionKey)} ↗</a>
      </Surface>)}
    </section>

    <section className="reading-note" id="response">
      <div><p className="eyebrow">{t("support.response.eyebrow")}</p><SectionTitle>{t("support.response.title")}</SectionTitle></div>
      <p>{t("support.response.bodyA")}</p>
      <p>{t("support.response.bodyB")}</p>
    </section>

    <div className="reading-actions">
      <ActionLink className="button button-primary" href="https://github.com/alexyyyander/proofweave/issues" rel="noreferrer" target="_blank">{t("support.action.issues")} <span aria-hidden="true">↗</span></ActionLink>
      <ActionLink className="button button-secondary" href="https://github.com/alexyyyander/proofweave/security/advisories/new" rel="noreferrer" target="_blank">{t("support.action.advisory")}</ActionLink>
    </div>
  </SiteFrame>;
}
