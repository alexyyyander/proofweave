import { Suspense } from "react";
import { ContentLoading } from "@/app/components/ui/ContentLoading";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { PageIntro } from "@/app/components/ui";
import Link from "next/link";
import { ExploreCatalog } from "./ExploreCatalog";
import { getCatalogRepository } from "@/db/repositories/catalog";
import { parseCatalogQuery } from "@/packages/domain/catalog-browser";
import { getI18n } from "@/app/i18n/server";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export default async function ExplorePage({ searchParams }: { searchParams: SearchParams }) {
  const { t } = await getI18n();
  return (
    <SiteFrame className="site-shell app-shell primary-page" active="explore" mainClassName="page-main">
        <PageIntro label={t("nav.primary.research")} title={t("explore.hero.title")}
          description={t("explore.hero.description")}
          meta={<span>{t("explore.hero.meta")}</span>} />
        <div className="research-index-context"><Link href="/publications">{t("explore.context.publications")} <span aria-hidden="true">→</span></Link><Link href="/propose">{t("explore.context.propose")} <span aria-hidden="true">→</span></Link><span>{t("explore.context.boundary")}</span><Link href="/about#catalog-standard">{t("explore.context.standard")} <span aria-hidden="true">→</span></Link></div>
        <Suspense fallback={<ContentLoading label={t("explore.loading")} />}><ResearchResults searchParams={searchParams} /></Suspense>
      </SiteFrame>
  );
}

async function ResearchResults({ searchParams }: { searchParams: SearchParams }) {
  const { t } = await getI18n();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }
  const query = parseCatalogQuery(params);
  const repository = getCatalogRepository();
  const [page, metadata] = await Promise.all([
    repository.browse({ ...query, kind: "frontier" }), repository.metadata("frontier"),
  ]);

  return <><p className="catalog-result-count">{t("explore.count", { total: metadata.total, subjects: metadata.subjects.length })}</p><ExploreCatalog key={JSON.stringify(query)} initialPage={page} metadata={metadata} initialQuery={query} /></>;
}
