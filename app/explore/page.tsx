import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { PageIntro } from "@/app/components/ui";
import Link from "next/link";
import { ExploreCatalog } from "./ExploreCatalog";
import { getCatalogRepository } from "@/db/repositories/catalog";

export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  const projects = await getCatalogRepository().listSummaries("frontier");
  const subjectCount = new Set(projects.flatMap((project) => project.subjects.map((subject) => subject.id))).size;

  return (
    <SiteFrame className="site-shell app-shell primary-page" active="explore" mainClassName="page-main">
        <PageIntro label="Research" title="Search the frontier. Choose one exact next action."
          description="Find a pinned target, inspect its prior work, or start a bounded Agent task. Every result carries its source, environment, and current verification state."
          meta={<><span>{projects.length} pinned targets</span><span>{subjectCount} MSC subjects</span><span>Source and status on every record</span></>} />
        <div className="research-index-context"><Link href="/publications">Browse mathematics publications <span aria-hidden="true">→</span></Link><Link href="/propose">Propose a target <span aria-hidden="true">→</span></Link><span>Catalog status is not a claim that a proof is complete.</span><Link href="/about/catalog-standard">Catalog standard <span aria-hidden="true">→</span></Link></div>
        <ExploreCatalog projects={projects} />
      </SiteFrame>
  );
}
