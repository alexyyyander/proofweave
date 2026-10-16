import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { PageTitle, SectionTitle, Badge, Field, ActionLink, EmptyState, FieldList, SectionHeading, Surface } from "@/app/components/ui";

import { SiteFrame } from "@/app/components/shell/SiteFrame";

import Link from "next/link";
import { getCurrentUser, signInPath, toPersonIdentity } from "@/app/auth";

import { PersonalWorkspaceFrame } from "@/app/PersonalWorkspaceFrame";
import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository } from "@/db/repositories/delegation";
import { getEvidenceRepository, type AttemptEvidenceSummary } from "@/db/repositories/evidence";
import { personalWritesPaused, ReadOnlyPersonalSurface } from "@/app/lib/read-only-personal-surface";

export const dynamic = "force-dynamic";

export default async function EvidenceIndexPage() {
  const readOnly = personalWritesPaused();
  const user = await getCurrentUser();
  if (!user) return <EvidenceMessage unauthenticated />;
  if (readOnly) {
    return <ReadOnlyPersonalSurface
      active="workbench"
      eyebrow="Controlled evidence · read-only maintenance"
      title="Your private evidence records are temporarily paused."
      detail="Public questions and published verification states remain readable. Private Bundle indexes, assigned-review evidence, downloads, and evidence submission controls are not loaded during maintenance."
    />;
  }
  const result = await loadEvidence(user);
  if (result.unavailable) return <EvidenceMessage unavailable />;
  const evidence = result.evidence;
  return <SiteFrame className="site-shell app-shell" active="workbench" mainClassName="page-main evidence-main personal-workspace-main">
      <PersonalWorkspaceFrame active="evidence">
      <Breadcrumb><Link href="/workbench">Workbench</Link><span> / </span><span>Evidence records</span></Breadcrumb>
      <SectionHeading as="section" className="review-heading"><div><p className="eyebrow">Controlled evidence access · closed alpha</p><PageTitle>Inspect the record behind a proof attempt.</PageTitle><p>Only your own Attempts and Bundles assigned to you for independent review appear here. Artifact downloads are hash-bound, D1-stored alpha objects; opening them never runs Lean again.</p></div><Badge className="record-chip">{evidence.length} records</Badge></SectionHeading>
      {evidence.length === 0 ? <EmptyState as="section" className="review-empty"><p className="eyebrow">No accessible evidence</p><SectionTitle>Your evidence inbox is clear.</SectionTitle><p>Your own staged Bundles and any assigned independent reviews will appear here. Local previews and individually stored artifact objects are preparation, not inspectable evidence records.</p><Link className="text-link" href="/workbench">Return to workspace <span>→</span></Link></EmptyState> : <section className="evidence-index-list" aria-label="Accessible evidence records">{evidence.map((record) => <EvidenceIndexCard key={record.artifactBundleManifestHash} record={record} />)}</section>}
      </PersonalWorkspaceFrame>
    </SiteFrame>;
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
  return <Surface as="article" className="evidence-index-card">
    <div className="evidence-index-card-top"><span className="micro-label">{record.accessRole === "attempt_owner" ? "Your Attempt" : "Assigned independent review"}</span><span className="review-status is-accepted">{record.latestRunState ?? "No Run"}</span></div>
    <SectionTitle>{record.target.title}</SectionTitle>
    <p><code>{record.target.declaration}</code></p>
    <FieldList><Field label="Submitting Agent">{record.agentLabel}</Field><Field label="Bundle hash"><code>{record.artifactBundleManifestHash}</code></Field><Field label="Record updated">{record.updatedAt}</Field></FieldList>
    <ActionLink className="button button-primary evidence-inspect-link" href={`/evidence/${encodeURIComponent(record.artifactBundleManifestHash)}`}>Inspect evidence <span aria-hidden="true">→</span></ActionLink>
  </Surface>;
}

function EvidenceMessage({ unauthenticated, unavailable }: { unauthenticated?: boolean; unavailable?: boolean }) {
  const title = unauthenticated ? "Sign in to inspect controlled evidence." : "Evidence records are temporarily unavailable.";
  const detail = unauthenticated
    ? "Evidence is addressed either to the Attempt owner or to the independently assigned reviewer. It is never a public bundle download."
    : "No unverified fallback evidence is shown while the control-plane store is unavailable.";
  return <SiteFrame className="site-shell app-shell" active="workbench" mainClassName="page-main evidence-main personal-workspace-main"><PersonalWorkspaceFrame active="evidence"><Breadcrumb><Link href="/workbench">Workbench</Link><span> / </span><span>Evidence records</span></Breadcrumb><SectionHeading as="section" className="review-heading"><div><p className="eyebrow">Controlled evidence access</p><PageTitle>{title}</PageTitle><p>{detail}</p></div><Badge className="record-chip">{unavailable ? "Unavailable" : "Personal"}</Badge></SectionHeading>{unauthenticated && <ActionLink className="button button-primary review-sign-in" href={signInPath("/evidence")}>Sign in to inspect <span aria-hidden="true">→</span></ActionLink>}</PersonalWorkspaceFrame></SiteFrame>;
}
