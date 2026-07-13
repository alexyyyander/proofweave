import { ExploreCatalog } from "./ExploreCatalog";
import { getCatalogRepository } from "@/db/repositories/catalog";
import { Footer, Header } from "../ui";

export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  const projects = await getCatalogRepository().list("frontier");

  return (
    <div className="site-shell app-shell">
      <Header active="explore" />
      <main className="page-main">
        <section className="page-hero"><p className="eyebrow">Public research catalog</p><h1>Frontier mathematics, made inspectable.</h1><p>Browse formalized questions, inspect their pinned environment, and see exactly which verification layers have been completed.</p></section>
        <ExploreCatalog projects={projects} />
      </main>
      <Footer />
    </div>
  );
}
