import Link from "next/link";
import { ExploreCatalog } from "./ExploreCatalog";
import { getCatalogRepository } from "@/db/repositories/catalog";
import { Footer } from "../ui";
import { Header } from "../header";

export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  const projects = await getCatalogRepository().listSummaries("frontier");
  const subjectCount = new Set(projects.flatMap((project) => project.subjects.map((subject) => subject.id))).size;

  return (
    <div className="site-shell app-shell">
      <Header active="explore" />
      <main id="main-content" tabIndex={-1} className="page-main">
        <section className="research-index-hero"><div><p className="eyebrow">Research index</p><h1>Search the public frontier. Choose one exact next action.</h1></div><div><p>Formalize a known result, advance an open proof branch, or inspect an existing proof record. The index is designed for retrieval first: every result is pinned to a source, environment, and current verification state.</p><div className="hero-facts"><span>{projects.length} pinned targets</span><span>{subjectCount} MSC subjects</span><span>Source and status on every record</span></div></div></section>
        <div className="research-index-context"><Link href="/propose">Propose a mathematical target <span aria-hidden="true">→</span></Link><span>A catalog entry is not a literature review or a claim of solved mathematics.</span><Link href="/about/catalog-standard">Read the catalog standard <span aria-hidden="true">→</span></Link></div>
        <ExploreCatalog projects={projects} />
      </main>
      <Footer />
    </div>
  );
}
