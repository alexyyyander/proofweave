import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser, signInPath } from "@/app/auth";
import { Footer } from "@/app/ui";
import { Header } from "@/app/header";
import { WorkbenchClient } from "../../WorkbenchClient";
import { loadCatalogTargets, loadWorkbenchData } from "../../workbench-data";

export const dynamic = "force-dynamic";

export default async function AttemptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const returnTo = `/workbench/attempts/${encodeURIComponent(id)}`;

  if (!user) return <div className="site-shell app-shell"><Header active="workbench" /><main id="main-content" tabIndex={-1} className="page-main attempt-access-main"><section className="page-hero"><p className="eyebrow">Private Attempt</p><h1>Sign in to inspect this research task.</h1><p>Attempt events, private evidence, and owner actions are available only to the Person who owns this workspace.</p><div className="button-row"><Link className="button button-primary" href={signInPath(returnTo)}>Sign in <span>→</span></Link><Link className="button button-secondary" href="/workbench">Back to My work</Link></div></section></main><Footer /></div>;

  const [data, catalogTargets] = await Promise.all([loadWorkbenchData(user), loadCatalogTargets()]);
  if (!data.storageAvailable) return <div className="site-shell app-shell"><Header active="workbench" /><main id="main-content" tabIndex={-1} className="page-main attempt-access-main"><section className="page-hero"><p className="eyebrow">Workspace unavailable</p><h1>This Attempt cannot be loaded safely.</h1><p>Proofweave does not substitute preview activity while the durable workspace store is unavailable.</p><Link className="button button-secondary" href="/workbench">Return to My work</Link></section></main><Footer /></div>;
  if (!data.attempts.some((attempt) => attempt.id === id)) notFound();

  return <div className="site-shell app-shell">
    <Header active="workbench" />
    <main id="main-content" tabIndex={-1} className="workbench-main attempt-detail-main">
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
    </main>
    <Footer />
  </div>;
}
