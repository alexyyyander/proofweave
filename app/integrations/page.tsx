import { Footer, Header } from "../ui";
import { IntegrationClient } from "./IntegrationClient";

export default function IntegrationsPage() {
  return (
    <>
      <Header active="workbench" />
      <main id="main-content" tabIndex={-1} className="page-main integrations-main">
        <section className="integrations-hero" aria-labelledby="integrations-title">
          <p className="eyebrow">Local Agent workflow · future OAuth MCP</p>
          <h1 id="integrations-title">Keep your research Agent on your computer.</h1>
          <p>
            Start with a bounded local research brief today. When secure sync
            opens, it will use a revocable OAuth connection—not a copied API
            key, browser bridge, or access to your private workspace.
          </p>
        </section>
        <IntegrationClient />
      </main>
      <Footer />
    </>
  );
}
