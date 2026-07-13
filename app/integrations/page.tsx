import { Footer, Header } from "../ui";
import { IntegrationClient } from "./IntegrationClient";

export default function IntegrationsPage() {
  return (
    <>
      <Header active="workbench" />
      <main className="page-main integrations-main">
        <section className="integrations-hero" aria-labelledby="integrations-title">
          <p className="eyebrow">Agent connection · remote OAuth MCP</p>
          <h1 id="integrations-title">Prepare your research Agent now. Connect it when the control plane is live.</h1>
          <p>
            Proofweave will use a remote, OAuth-authorized MCP service—not a
            copied API key or local bridge. This closed alpha does not yet
            expose a connectable external endpoint.
          </p>
        </section>
        <IntegrationClient />
      </main>
      <Footer />
    </>
  );
}
