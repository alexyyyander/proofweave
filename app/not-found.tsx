import { PageTitle, ActionLink, SectionHeading } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";
import { getI18n } from "@/app/i18n/server";

export default async function NotFound() {
  const { t } = await getI18n();
  return <SiteFrame className="site-shell app-shell primary-page" active="none">
    <SectionHeading as="section" className="page-hero">
      <p className="eyebrow">{t("notFound.eyebrow")}</p>
      <PageTitle>{t("notFound.title")}</PageTitle>
      <p>{t("notFound.body")}</p>
      <div className="button-row">
        <ActionLink className="button button-primary" href="/explore">{t("notFound.explore")} <span aria-hidden="true">→</span></ActionLink>
        <ActionLink className="button button-secondary" href="/">{t("notFound.home")}</ActionLink>
      </div>
    </SectionHeading>
  </SiteFrame>;
}
