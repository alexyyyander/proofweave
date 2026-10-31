import { PageTitle, ActionLink, SectionHeading } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { notFound } from "next/navigation";
import { getCurrentUser, signInPath } from "@/app/auth";

import { personalWritesPaused, ReadOnlyPersonalSurface } from "@/app/lib/read-only-personal-surface";
import { WorkbenchClient } from "../../WorkbenchClient";
import { loadCatalogTargets, loadWorkbenchData } from "../../workbench-data";

export const dynamic = "force-dynamic";

export default async function AttemptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const returnTo = `/workbench/attempts/${encodeURIComponent(id)}`;

  if (personalWritesPaused()) {
    return <ReadOnlyPersonalSurface
      active="workbench"
      eyebrow="Private Attempt · read-only maintenance"
      title="This research task is temporarily paused."
      detail="Proofweave has preserved the exact Attempt address, but does not load its private events, Agent authority, evidence, Runs, or owner controls while the personal control plane is read-only. Reload this page after maintenance to continue the same task."
    />;
  }

  const user = await getCurrentUser();
  if (!user) return <SiteFrame className="site-shell app-shell" active="workbench" mainClassName="page-main attempt-access-main"><SectionHeading as="section" className="page-hero"><p className="eyebrow">Private Attempt</p><PageTitle>Sign in to inspect this research task.</PageTitle><p>Attempt events, private evidence, and owner actions are available only to the Person who owns this workspace.</p><div className="button-row"><ActionLink className="button button-primary" href={signInPath(returnTo)}>Sign in <span>→</span></ActionLink><ActionLink className="button button-secondary" href="/workbench">Back to My work</ActionLink></div></SectionHeading></SiteFrame>;

  const [data, catalogTargets] = await Promise.all([loadWorkbenchData(user), loadCatalogTargets()]);
  if (!data.storageAvailable) return <SiteFrame className="site-shell app-shell" active="workbench" mainClassName="page-main attempt-access-main"><SectionHeading as="section" className="page-hero"><p className="eyebrow">Workspace unavailable</p><PageTitle>This Attempt cannot be loaded safely.</PageTitle><p>Proofweave does not substitute preview activity while the durable workspace store is unavailable.</p><ActionLink className="button button-secondary" href="/workbench">Return to My work</ActionLink></SectionHeading></SiteFrame>;
  if (!data.attempts.some((attempt) => attempt.id === id)) notFound();

  return <SiteFrame className="site-shell app-shell" active="workbench" mainClassName="workbench-main attempt-detail-main">
      <WorkbenchClient
        profile={data.profile}
        initialAttempts={data.attempts}
        initialRuns={data.runs}
        initialProvisionalContributions={data.provisionalContributions}
        provisionalLedgerAvailable={data.provisionalLedgerAvailable}
        initialReviewCount={data.reviewCount}
        initialEvidenceCount={data.evidenceCount}
        catalogTargets={catalogTargets}
        initialAttemptId={id}
        initialTargetSlug={null}
        initialParentNodeId={null}
        isAuthenticated
        signInPath={signInPath(returnTo)}
        storageAvailable={data.storageAvailable}
        variant="detail"
      />
    </SiteFrame>;
}
