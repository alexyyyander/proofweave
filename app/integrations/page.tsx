import { PageTitle, SectionHeading } from "@/app/components/ui";
import { Footer } from "../ui";
import { Header } from "../header";
import { IntegrationClient } from "./IntegrationClient";
import { getCurrentUser, signInPath, toPersonIdentity, type AuthUser } from "../auth";
import { safeRelativeReturnPath } from "../chatgpt-auth";
import { getParticipantOperationState, MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository } from "@/db/repositories/delegation";
import { activeLocalCodexInstallation } from "../lib/local-agent-journey";
import { loadCatalogTargets, requestedParentNodeId, requestedTargetSlug } from "../workbench/workbench-data";
import { googleAuthConfig } from "../google-auth-config";
import { getI18n } from "@/app/i18n/server";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("integrations.metaTitle"), description: t("integrations.metaDescription") };
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ target?: string | string[]; parent?: string | string[]; return_to?: string | string[] }>;
}) {
  const { t } = await getI18n();
  const query = await searchParams;
  const targetSlug = requestedTargetSlug(query);
  const parentNodeId = requestedParentNodeId(query);
  const [user, targets] = await Promise.all([getCurrentUser(), loadCatalogTargets()]);
  const controlPlane = getParticipantOperationState();
  const connection = controlPlane.writesEnabled ? await loadConnection(user) : null;
  const selectedTarget = targetSlug
    ? targets.find((candidate) => candidate.slug === targetSlug) ?? null
    : null;
  const fallbackReturn = selectedTarget
    ? `/workbench?target=${encodeURIComponent(selectedTarget.slug)}${parentNodeId ? `&parent=${encodeURIComponent(parentNodeId)}` : ""}#research-launcher`
    : "/workbench";
  const requestedReturn = typeof query.return_to === "string" ? query.return_to : fallbackReturn;
  const returnHref = safeRelativeReturnPath(requestedReturn);
  const signInReturnQuery = new URLSearchParams();
  if (targetSlug) signInReturnQuery.set("target", targetSlug);
  if (parentNodeId) signInReturnQuery.set("parent", parentNodeId);
  signInReturnQuery.set("return_to", returnHref);
  const integrationsReturnHref =
    `/integrations?${signInReturnQuery.toString()}#codex-beta`;
  return (
    <>
      <Header active="workbench" />
      <main id="main-content" tabIndex={-1} className="page-main integrations-main">
        <SectionHeading as="section" className="integrations-hero" aria-labelledby="integrations-title">
          <p className="eyebrow">{t("integrations.hero.eyebrow")}</p>
          <PageTitle id="integrations-title">{t("integrations.hero.title")}</PageTitle>
          <p>{t("integrations.hero.body")}</p>
        </SectionHeading>
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
