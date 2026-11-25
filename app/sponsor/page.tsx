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
      <h1>{t("sponsor.title")}</h1>
      <p>{t("sponsor.blurb")}</p>
      <form method="get" action="https://github.com/alexyyyander/proofweave/issues/new" target="_blank" rel="noopener noreferrer">
        <label htmlFor="sponsor-target">{t("sponsor.select")}</label>
        <select id="sponsor-target" name="title" defaultValue="" required>
          <option value="" disabled>{t("sponsor.placeholder")}</option>
          {projects.map(project => {
            const title = frontierDisplayTitle(project, t);
            return <option key={project.id} value={`${t("sponsor.subject")} · ${title} (${project.slug})`}>{title}</option>;
          })}
        </select>
        <input type="hidden" name="body" value={t("sponsor.template")} />
        <p>{t("sponsor.public")}</p>
        <button type="submit">{t("sponsor.draft")} <span aria-hidden="true">↗</span></button>
      </form>
    </section>
  </SiteFrame>;
}
