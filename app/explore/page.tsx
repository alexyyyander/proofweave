import { ExploreCatalog } from "./ExploreCatalog";
import { Footer, Header } from "../ui";

export default function ExplorePage() {
  return (
    <div className="site-shell app-shell">
      <Header active="explore" />
      <main className="page-main">
        <section className="page-hero"><p className="eyebrow">Public research catalog</p><h1>Frontier mathematics, made inspectable.</h1><p>Browse formalized questions, inspect their pinned environment, and see exactly which verification layers have been completed.</p></section>
        <ExploreCatalog />
      </main>
      <Footer />
    </div>
  );
}
