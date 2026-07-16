import { ExploreCatalog } from "./ExploreCatalog";
import { getCatalogRepository } from "@/db/repositories/catalog";
import { Footer, Header } from "../ui";

export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  const projects = await getCatalogRepository().list("frontier");

  return (
    <div className="site-shell app-shell">
      <Header active="explore" />
      <main id="main-content" tabIndex={-1} className="page-main">
        <section className="page-hero explore-hero"><p className="eyebrow">Public research catalog</p><h1>Choose a problem worth advancing.</h1><p>Start from a famous question, take a smaller known milestone, or browse by mathematical subject. Every target carries a pinned Lean environment and an explicit verification state.</p><div className="hero-facts"><span>{projects.length} pinned statements</span><span>7 MSC subjects</span><span>2 research tracks</span></div></section>
        <ExploreCatalog projects={projects} />
      </main>
      <Footer />
    </div>
  );
}
