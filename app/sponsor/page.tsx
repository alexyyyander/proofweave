import { PageTitle, Select, Input, Button } from "@/app/components/ui/primitives";
import Link from "next/link";
import { SiteFrame } from "@/app/components/shell/SiteFrame";
import { frontierDisplayTitle } from "@/app/components/research/FrontierHomeCard";
import { pathForLocale } from "@/app/i18n/config";
import { getI18n } from "@/app/i18n/server";
import { getCatalogRepository } from "@/db/repositories/catalog";
import styles from "./sponsor.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("sponsor.title") };
}

export default async function SponsorPage() {
  const { t, locale } = await getI18n();
  const projects = await getCatalogRepository().list("frontier", 3);
  return <SiteFrame active="explore" className="site-shell public-shell">
    <section className={styles.page}>
      <Link href={pathForLocale("/", locale) + "#public-frontier"}>← {t("sponsor.back")}</Link>
      <PageTitle>{t("sponsor.title")}</PageTitle>
      <p>{t("sponsor.blurb")}</p>
      <form method="get" action="https://github.com/alexyyyander/proofweave/issues/new" target="_blank" rel="noopener noreferrer">
        <label htmlFor="sponsor-target">{t("sponsor.select")}</label>
        <Select id="sponsor-target" name="title" defaultValue="" required>
          <option value="" disabled>{t("sponsor.placeholder")}</option>
          {projects.map(project => {
            const title = frontierDisplayTitle(project, t);
            return <option key={project.id} value={`${t("sponsor.subject")} · ${title} (${project.slug})`}>{title}</option>;
          })}
        </Select>
        <Input type="hidden" name="body" value={t("sponsor.template")} />
        <p>{t("sponsor.public")}</p>
        <Button type="submit">{t("sponsor.draft")} <span aria-hidden="true">↗</span></Button>
      </form>
    </section>
  </SiteFrame>;
}
