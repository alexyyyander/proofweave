import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { Footer, Header } from "../ui";
import { IntegrationClient } from "./IntegrationClient";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const user = await requireChatGPTUser("/integrations");

  return (
    <>
      <Header active="workbench" />
      <main className="page-main integrations-main">
        <section className="integrations-hero" aria-labelledby="integrations-title">
          <p className="eyebrow">Closed alpha · agent connection</p>
          <h1 id="integrations-title">Connect your Codex research agent.</h1>
          <p>
            Give your local Codex a personal, expiring token to inspect the
            catalog and record provisional research progress under your owner
            profile.
          </p>
        </section>
        <IntegrationClient ownerEmail={user.email} />
      </main>
      <Footer />
    </>
  );
}
