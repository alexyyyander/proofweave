import { Footer } from "../ui";
import { Header } from "../header";
import { IntegrationClient } from "./IntegrationClient";
import { getCurrentUser, signInPath, toPersonIdentity, type AuthUser } from "../auth";
import { safeRelativeReturnPath } from "../chatgpt-auth";
import { getControlPlaneOperationState, MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository } from "@/db/repositories/delegation";
import { activeLocalCodexInstallation } from "../lib/local-agent-journey";
import { loadCatalogTargets, requestedParentNodeId, requestedTargetSlug } from "../workbench/workbench-data";
import { googleAuthConfig } from "../google-auth-config";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ target?: string | string[]; parent?: string | string[]; return_to?: string | string[] }>;
}) {
  const query = await searchParams;
  const targetSlug = requestedTargetSlug(query);
  const parentNodeId = requestedParentNodeId(query);
  const [user, targets] = await Promise.all([getCurrentUser(), loadCatalogTargets()]);
  const controlPlane = getControlPlaneOperationState();
  const connection = controlPlane.writesEnabled ? await loadConnection(user) : null;
  const selectedTarget = targetSlug
    ? targets.find((candidate) => candidate.slug === targetSlug) ?? null
    : null;
  const fallbackReturn = selectedTarget
    ? `/workbench?target=${encodeURIComponent(selectedTarget.slug)}${parentNodeId ? `&parent=${encodeURIComponent(parentNodeId)}` : ""}#research-launcher`
    : "/workbench";
  const requestedReturn = typeof query.return_to === "string" ? query.return_to : fallbackReturn;
  const returnHref = safeRelativeReturnPath(requestedReturn);
  const integrationsReturnHref = selectedTarget
    ? `/integrations?target=${encodeURIComponent(selectedTarget.slug)}&return_to=${encodeURIComponent(returnHref)}#codex-beta`
    : "/integrations#codex-beta";
  return (
    <>
      <Header active="workbench" />
      <main id="main-content" tabIndex={-1} className="page-main integrations-main">
        <section className="integrations-hero" aria-labelledby="integrations-title">
          <p className="eyebrow">Step 2 of 3 · connect Codex once</p>
          <h1 id="integrations-title">Connect once. Then return to your research.</h1>
          <p>
            Keep your research Agent on your computer. Proofweave records only
            the bounded work you explicitly approve—never your private
            workspace, prompts, or API keys.
          </p>
        </section>
        <IntegrationClient
          connection={connection}
          isAuthenticated={Boolean(user)}
          signInHref={signInPath(integrationsReturnHref)}
          googleSignInAvailable={googleAuthConfig().configured}
          controlPlaneWritesEnabled={controlPlane.writesEnabled}
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

async function loadConnection(user: AuthUser | null): Promise<{ agentLabel: string } | null> {
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
