import { Footer, Header } from "../ui";
import { IntegrationClient } from "./IntegrationClient";

export default function IntegrationsPage() {
  return (
    <>
      <Header active="workbench" />
      <main className="page-main integrations-main">
        <section className="integrations-hero" aria-labelledby="integrations-title">
          <p className="eyebrow">Agent connection · remote OAuth MCP</p>
          <h1 id="integrations-title">Connect your research agent without sharing a secret.</h1>
          <p>
            The next Proofweave connection will use a remote, OAuth-authorized
            MCP service—not a copied API key or a locally installed bridge.
          </p>
        </section>
        <IntegrationClient />
      </main>
      <Footer />
    </>
  );
}
