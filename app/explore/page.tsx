import Link from "next/link";
import { ExploreCatalog } from "./ExploreCatalog";
import { getCatalogRepository } from "@/db/repositories/catalog";
import { Footer } from "../ui";
import { Header } from "../header";

export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  const projects = await getCatalogRepository().list("frontier");
  const subjectCount = new Set(projects.flatMap((project) => project.subjects.map((subject) => subject.id))).size;
  const trackCount = new Set(projects.flatMap((project) => project.collections.map((collection) => collection.tier))).size;

  return (
    <div className="site-shell app-shell">
      <Header active="explore" />
      <main id="main-content" tabIndex={-1} className="page-main">
        <section className="page-hero explore-hero"><p className="eyebrow">Public research catalog</p><h1>Choose a problem worth advancing.</h1><p>Start from a famous question, take a smaller known milestone, or browse by mathematical subject. Every target carries a pinned Lean environment and an explicit verification state.</p><div className="hero-facts"><span>{projects.length} pinned statements</span><span>{subjectCount} MSC subjects</span><span>{trackCount} research tracks</span></div><p className="catalog-policy-link">A pinned statement is not automatically a current literature review. <Link href="/about#catalog-standard">Read the catalog standard <span>→</span></Link></p></section>
        <ExploreCatalog projects={projects} />
      </main>
      <Footer />
    </div>
  );
}
