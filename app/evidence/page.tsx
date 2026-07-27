import Link from "next/link";
import { getCurrentUser, signInPath, toPersonIdentity } from "@/app/auth";
import { Footer } from "@/app/ui";
import { Header } from "@/app/header";
import { PersonalWorkspaceFrame } from "@/app/PersonalWorkspaceFrame";
import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository } from "@/db/repositories/delegation";
import { getEvidenceRepository, type AttemptEvidenceSummary } from "@/db/repositories/evidence";

export const dynamic = "force-dynamic";

export default async function EvidenceIndexPage() {
  const user = await getCurrentUser();
  const result = await loadEvidence(user);
  if (!user) return <EvidenceMessage unauthenticated />;
  if (result.unavailable) return <EvidenceMessage unavailable />;
  const evidence = result.evidence;
  return <div className="site-shell app-shell">
    <Header active="workbench" />
    <main id="main-content" tabIndex={-1} className="page-main evidence-main personal-workspace-main">
      <PersonalWorkspaceFrame active="evidence">
      <div className="breadcrumb"><Link href="/workbench">Workbench</Link><span> / </span><span>Evidence records</span></div>
      <section className="review-heading"><div><p className="eyebrow">Controlled evidence access · closed alpha</p><h1>Inspect the record behind a proof attempt.</h1><p>Only your own Attempts and Bundles assigned to you for independent review appear here. Artifact downloads are hash-bound, D1-stored alpha objects; opening them never runs Lean again.</p></div><span className="record-chip">{evidence.length} records</span></section>
      {evidence.length === 0 ? <section className="review-empty"><p className="eyebrow">No accessible evidence</p><h2>Your evidence inbox is clear.</h2><p>Your own staged Bundles and any assigned independent reviews will appear here. Local previews and individually stored artifact objects are preparation, not inspectable evidence records.</p><Link className="text-link" href="/workbench">Return to workspace <span>→</span></Link></section> : <section className="evidence-index-list" aria-label="Accessible evidence records">{evidence.map((record) => <EvidenceIndexCard key={record.artifactBundleManifestHash} record={record} />)}</section>}
      </PersonalWorkspaceFrame>
    </main>
    <Footer />
  </div>;
}

async function loadEvidence(user: Awaited<ReturnType<typeof getCurrentUser>>): Promise<{ evidence: readonly AttemptEvidenceSummary[]; unavailable: boolean }> {
  if (!user) return { evidence: [], unavailable: false };
  try {
    const profile = await getDelegationRepository().getProfile(toPersonIdentity(user));
    return { evidence: await getEvidenceRepository().listForPerson(profile.person.id), unavailable: false };
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return { evidence: [], unavailable: true };
    throw error;
  }
}

function EvidenceIndexCard({ record }: { record: AttemptEvidenceSummary }) {
  return <article className="evidence-index-card">
    <div className="evidence-index-card-top"><span className="micro-label">{record.accessRole === "attempt_owner" ? "Your Attempt" : "Assigned independent review"}</span><span className="review-status is-accepted">{record.latestRunState ?? "No Run"}</span></div>
    <h2>{record.target.title}</h2>
    <p><code>{record.target.declaration}</code></p>
    <dl><div><dt>Submitting Agent</dt><dd>{record.agentLabel}</dd></div><div><dt>Bundle hash</dt><dd><code>{record.artifactBundleManifestHash}</code></dd></div><div><dt>Record updated</dt><dd>{record.updatedAt}</dd></div></dl>
    <Link className="button button-primary evidence-inspect-link" href={`/evidence/${encodeURIComponent(record.artifactBundleManifestHash)}`}>Inspect evidence <span aria-hidden="true">→</span></Link>
  </article>;
}

function EvidenceMessage({ unauthenticated, unavailable }: { unauthenticated?: boolean; unavailable?: boolean }) {
  const title = unauthenticated ? "Sign in to inspect controlled evidence." : "Evidence records are temporarily unavailable.";
  const detail = unauthenticated
    ? "Evidence is addressed either to the Attempt owner or to the independently assigned reviewer. It is never a public bundle download."
    : "No unverified fallback evidence is shown while the control-plane store is unavailable.";
  return <div className="site-shell app-shell">
    <Header active="workbench" />
    <main id="main-content" tabIndex={-1} className="page-main evidence-main personal-workspace-main"><PersonalWorkspaceFrame active="evidence"><div className="breadcrumb"><Link href="/workbench">Workbench</Link><span> / </span><span>Evidence records</span></div><section className="review-heading"><div><p className="eyebrow">Controlled evidence access</p><h1>{title}</h1><p>{detail}</p></div><span className="record-chip">{unavailable ? "Unavailable" : "Personal"}</span></section>{unauthenticated && <Link className="button button-primary review-sign-in" href={signInPath("/evidence")}>Sign in to inspect <span aria-hidden="true">→</span></Link>}</PersonalWorkspaceFrame></main>
    <Footer />
  </div>;
}
