import { Footer } from "../ui";
import { Header } from "../header";
import { IntegrationClient } from "./IntegrationClient";
import { getCurrentUser, toPersonIdentity } from "../auth";
import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository } from "@/db/repositories/delegation";
import { activeLocalCodexInstallation } from "../lib/local-agent-journey";

export default async function IntegrationsPage() {
  const connection = await loadConnection();
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
        <IntegrationClient connection={connection} />
      </main>
      <Footer />
    </>
  );
}

async function loadConnection(): Promise<{ agentLabel: string } | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  try {
    const profile = await getDelegationRepository().getProfile(toPersonIdentity(user));
    const installation = activeLocalCodexInstallation(profile);
    return installation ? { agentLabel: installation.agentLabel } : null;
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return null;
    throw error;
  }
}
