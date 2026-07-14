import { Footer, Header } from "../ui";
import { IntegrationClient } from "./IntegrationClient";

export default function IntegrationsPage() {
  return (
    <>
      <Header active="workbench" />
      <main id="main-content" tabIndex={-1} className="page-main integrations-main">
        <section className="integrations-hero" aria-labelledby="integrations-title">
          <p className="eyebrow">Local Agent workflow · private-beta OAuth MCP</p>
          <h1 id="integrations-title">Keep your research Agent on your computer.</h1>
          <p>
            Run Codex and Lean work on your own computer, then approve a
            revocable OAuth connection for only the bounded Proofweave actions
            you choose—not a copied API key or access to your private workspace.
          </p>
        </section>
        <IntegrationClient />
      </main>
      <Footer />
    </>
  );
}
