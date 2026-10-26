import { Suspense } from "react";
import { ContentLoading } from "@/app/components/ui/ContentLoading";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { PageIntro } from "@/app/components/ui";
import Link from "next/link";
import { ExploreCatalog } from "./ExploreCatalog";
import { getCatalogRepository } from "@/db/repositories/catalog";
import { parseCatalogQuery } from "@/packages/domain/catalog-browser";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export default function ExplorePage({ searchParams }: { searchParams: SearchParams }) {

  return (
    <SiteFrame className="site-shell app-shell primary-page" active="explore" mainClassName="page-main">
        <PageIntro label="Research" title="Search the frontier. Choose one exact next action."
          description="Find a pinned target, inspect its prior work, or start a bounded Agent task. Every result carries its source, environment, and current verification state."
          meta={<span>Source and status on every record</span>} />
        <div className="research-index-context"><Link href="/propose">Propose a target <span aria-hidden="true">→</span></Link><span>Catalog status is not a claim that a proof is complete.</span><Link href="/about/catalog-standard">Catalog standard <span aria-hidden="true">→</span></Link></div>
        <Suspense fallback={<ContentLoading label="Loading the research catalog" />}><ResearchResults searchParams={searchParams} /></Suspense>
      </SiteFrame>
  );
}

async function ResearchResults({ searchParams }: { searchParams: SearchParams }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }
  const query = parseCatalogQuery(params);
  const repository = getCatalogRepository();
  const [page, metadata] = await Promise.all([
    repository.browse({ ...query, kind: "frontier" }), repository.metadata("frontier"),
  ]);

  return <><p className="catalog-result-count">{metadata.total} pinned targets · {metadata.subjects.length} MSC subjects</p><ExploreCatalog key={JSON.stringify(query)} initialPage={page} metadata={metadata} initialQuery={query} /></>;
}
