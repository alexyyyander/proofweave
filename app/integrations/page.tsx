import { Footer } from "../ui";
import { Header } from "../header";
import { IntegrationClient } from "./IntegrationClient";
import { getCurrentUser, toPersonIdentity } from "../auth";
import { safeRelativeReturnPath } from "../chatgpt-auth";
import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository } from "@/db/repositories/delegation";
import { activeLocalCodexInstallation } from "../lib/local-agent-journey";
import { loadCatalogTargets, requestedParentNodeId, requestedTargetSlug } from "../workbench/workbench-data";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ target?: string | string[]; parent?: string | string[]; return_to?: string | string[] }>;
}) {
  const query = await searchParams;
  const targetSlug = requestedTargetSlug(query);
  const parentNodeId = requestedParentNodeId(query);
  const [connection, targets] = await Promise.all([loadConnection(), loadCatalogTargets()]);
  const selectedTarget = targetSlug
    ? targets.find((candidate) => candidate.slug === targetSlug) ?? null
    : null;
  const fallbackReturn = selectedTarget
    ? `/workbench?target=${encodeURIComponent(selectedTarget.slug)}${parentNodeId ? `&parent=${encodeURIComponent(parentNodeId)}` : ""}#research-launcher`
    : "/workbench";
  const requestedReturn = typeof query.return_to === "string" ? query.return_to : fallbackReturn;
  const returnHref = safeRelativeReturnPath(requestedReturn);
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
        <IntegrationClient
          connection={connection}
          selectedTarget={selectedTarget ? {
            slug: selectedTarget.slug,
            title: selectedTarget.title,
            domain: selectedTarget.domain,
            informalStatement: selectedTarget.informalStatement,
          } : null}
          returnHref={returnHref}
        />
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
