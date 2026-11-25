import { publishedTargetSponsorships } from "@/app/lib/target-sponsorship";
import Link from "next/link";
import { pathForLocale, type Locale } from "@/app/i18n/config";
import type { Translator } from "@/app/i18n/translate";
import type { CatalogProblem } from "@/packages/domain/catalog";

// Introductory summaries are scoped to the catalog revision they describe.
const featured: Readonly<Partial<Record<string, "erdos" | "cycles" | "pnp">>> = {
  "problem-revision:formal-conjectures:erdos-865:main:1": "erdos",
  "problem-revision:openai:cycle-double-cover:main:1": "cycles",
  "problem-revision:formal-conjectures:p-vs-np:main:1": "pnp",
};

export function frontierDisplayTitle(project: Pick<CatalogProblem, "id" | "title">, t: Translator) {
  const entry = featured[project.id];
  return entry ? t(`home.problem.${entry}.title`) : project.title;
}

export function FrontierHomeCard({ project, t, locale }: {
  project: CatalogProblem;
  t: Translator;
  locale: Locale;
}) {
  const entry = featured[project.id];
  const title = frontierDisplayTitle(project, t);
  const sponsors = publishedTargetSponsorships(project.id);
  const material = entry === "cycles" && project.source.revisionTag.startsWith("claimed-proof-")
    ? "claimed" : project.proofState === "proved" ? "upstream" : "admitted";
  const kernel = project.claims.find(claim => claim.type === "kernel_accepted")?.status ?? "not_submitted";
  const slug = encodeURIComponent(project.slug);

  return <article className="rh-problem" aria-labelledby={`rh-title-${slug}`}>
    <div className="rh-problem-top">
      <span>{entry ? t(`home.problem.${entry}.domain`) : project.domain}</span>
      <span>{t(project.researchStatus === "research_open" ? "home.problem.open" : "home.problem.solved")}</span>
    </div>
    <h3 id={`rh-title-${slug}`}>{title}</h3>
    <p className="rh-problem-question">{entry ? t(`home.problem.${entry}.question`) : project.informalStatement}</p>
    <dl className="rh-problem-progress">
      <div className="rh-funding" data-funded={sponsors.length > 0}><dt>{t("sponsor.status")}</dt><dd>{sponsors.length
        ? <>{t("sponsor.confirmed")} · {sponsors.map((sponsor, index) => <span key={sponsor.announcementUrl}>{index > 0 && " / "}<a href={sponsor.announcementUrl}>{sponsor.sponsorName} ↗</a></span>)}</>
        : t("sponsor.noRecord")}</dd></div>
      <div><dt>{t("home.problem.material")}</dt><dd>{t(`home.problem.${material}`)}</dd></div>
      <div><dt>{t("home.problem.kernel")}</dt><dd>{t(`home.problem.${kernel}`)}</dd></div>
    </dl>
    <footer>
      <Link className="rh-problem-start" href={`${pathForLocale("/workbench", locale)}?target=${slug}#research-launcher`} aria-label={`${t("home.problem.start")} · ${title}`}>{t("home.problem.start")} <span aria-hidden="true">→</span></Link>
      <Link className="rh-link" href={pathForLocale(`/explore/${slug}`, locale)} aria-label={`${t("home.problem.record")} · ${title}`}>{t("home.problem.record")}</Link>
    </footer>
  </article>;
}
