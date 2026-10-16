import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { PageTitle, Badge, Field, ActionLink, CodeBlock, FieldList, SectionHeading, Surface } from "@/app/components/ui";

import { SiteFrame } from "@/app/components/shell/SiteFrame";

import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser, signInPath, toPersonIdentity } from "@/app/auth";

import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository } from "@/db/repositories/delegation";
import { getEvidenceRepository, type AttemptEvidence, type EvidenceArtifact, type EvidenceReplay, type EvidenceReviewOutcome, type EvidenceRunnerResultSummary } from "@/db/repositories/evidence";
import { SourceDiffPreview } from "@/app/evidence/SourceDiffPreview";
import { PersonalWorkspaceFrame } from "@/app/PersonalWorkspaceFrame";
import { IndependentReviewHandoff } from "@/app/evidence/IndependentReviewHandoff";
import { hasAcceptedLeanEvidence } from "@/app/lib/evidence-eligibility";
import { getVerificationMarketRepository, type BundleVerificationMarketStatus, VerificationMarketSchemaUnavailableError } from "@/db/repositories/verification-market";
import { personalWritesPaused, ReadOnlyPersonalSurface } from "@/app/lib/read-only-personal-surface";

export const dynamic = "force-dynamic";

export default async function EvidenceDetailPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId: bundleManifestHash } = await params;
  const readOnly = personalWritesPaused();
  const user = await getCurrentUser();
  if (!user) return <EvidenceAccessMessage signInPath={signInPath(`/evidence/${encodeURIComponent(bundleManifestHash)}`)} />;
  if (readOnly) {
    return <ReadOnlyPersonalSurface
      active="workbench"
      eyebrow="Controlled evidence · read-only maintenance"
      title="This private evidence record is temporarily paused."
      detail="Proofweave does not load the controlled Bundle, private artifacts, replay evidence, or review handoff while the personal control plane is read-only. Artifact access and verification actions are not offered."
    />;
  }
  const result = await loadEvidenceDetail(user, bundleManifestHash);
  if (result.unavailable) return <EvidenceAccessMessage unavailable />;
  if (!result.evidence) notFound();
  return <EvidenceDetail evidence={result.evidence} reviewMarketStatus={result.reviewMarketStatus} reviewMarketUnavailable={result.reviewMarketUnavailable} />;
}

async function loadEvidenceDetail(user: Awaited<ReturnType<typeof getCurrentUser>>, bundleManifestHash: string): Promise<{ evidence: AttemptEvidence | null; unavailable: boolean; reviewMarketStatus: BundleVerificationMarketStatus | null; reviewMarketUnavailable: boolean }> {
  if (!user) return { evidence: null, unavailable: false, reviewMarketStatus: null, reviewMarketUnavailable: false };
  try {
    const profile = await getDelegationRepository().getProfile(toPersonIdentity(user));
    const evidence = await getEvidenceRepository().getForPerson(profile.person.id, bundleManifestHash);
    if (!evidence || evidence.summary.accessRole !== "attempt_owner") return { evidence, unavailable: false, reviewMarketStatus: null, reviewMarketUnavailable: false };
    try {
      return { evidence, unavailable: false, reviewMarketStatus: await getVerificationMarketRepository().statusForBundle(evidence.bundle.manifestHash), reviewMarketUnavailable: false };
    } catch (error) {
      if (error instanceof VerificationMarketSchemaUnavailableError) return { evidence, unavailable: false, reviewMarketStatus: null, reviewMarketUnavailable: true };
      throw error;
    }
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return { evidence: null, unavailable: true, reviewMarketStatus: null, reviewMarketUnavailable: true };
    throw error;
  }
}

function EvidenceDetail({ evidence, reviewMarketStatus, reviewMarketUnavailable }: { evidence: AttemptEvidence; reviewMarketStatus: BundleVerificationMarketStatus | null; reviewMarketUnavailable: boolean }) {
  const bundleManifestHash = evidence.bundle.manifestHash;
  const replayEmptyMessage = evidence.summary.accessRole === "attempt_owner"
    ? "Fresh replay artifacts remain private to their independent review Agent. A replay becomes relevant to your record only when that Agent separately signs a review decision."
    : "No terminal replay evidence is addressed to your review Agent. A queued replay is not evidence, and another reviewer’s replay stays private to that reviewer.";
  return <SiteFrame className="site-shell app-shell" active="workbench" mainClassName="page-main evidence-main personal-workspace-main">
      <PersonalWorkspaceFrame active="evidence">
      <Breadcrumb><Link href="/evidence">Evidence records</Link><span> / </span><span>{bundleManifestHash}</span></Breadcrumb>
      <SectionHeading as="section" className="review-heading evidence-detail-heading"><div><p className="eyebrow">{evidence.summary.accessRole === "attempt_owner" ? "Your Attempt · controlled evidence" : "Assigned review · controlled evidence"}</p><PageTitle>{evidence.summary.target.title}</PageTitle><p>These are stored hashes, signed Bundle metadata, and Runner outputs. Downloading an object does not perform a fresh runner replay or create a verification claim.</p></div><Badge className="record-chip">{evidence.bundle.protocolVersion}</Badge></SectionHeading>
      <section className="evidence-integrity-note"><strong>Access boundary</strong><p>{evidence.summary.accessRole === "attempt_owner" ? "You are the recorded Attempt owner." : "You are an assigned independent reviewer; the submitter’s Person identity is intentionally omitted."} Every download is checked against the immutable D1 index and content hash before bounded alpha bytes are returned.</p></section>
      <section className="evidence-detail-grid" aria-label="Bundle review facts">
        <Surface as="article" className="evidence-panel"><div className="panel-heading"><span>01 / Signed Artifact Bundle</span><Badge className="record-chip">Immutable</Badge></div><FieldList className="evidence-metadata"><Field label="Manifest hash"><code>{evidence.bundle.manifestHash}</code></Field><Field label="Agent event"><code>{evidence.bundle.agentEventId}</code></Field><Field label="Event payload hash"><code>{evidence.bundle.agentEventPayloadHash}</code></Field><Field label="Submitting Agent">{evidence.summary.agentLabel}</Field></FieldList><ArtifactList bundleManifestHash={bundleManifestHash} artifacts={evidence.bundle.artifacts} /></Surface>
        <Surface as="article" className="evidence-panel"><div className="panel-heading"><span>02 / Review facts</span><a className="text-link" href={artifactHref(bundleManifestHash, "sourcePatch")}>Download source diff <span>→</span></a></div><FieldList className="evidence-metadata"><Field label="Target declaration"><code>{evidence.bundle.review.target.declaration}</code></Field><Field label="Statement hash"><code>{evidence.bundle.review.target.statementHash}</code></Field><Field label="Lean toolchain"><code>{evidence.bundle.review.environment.leanToolchain}</code></Field><Field label="Mathlib revision"><code>{evidence.bundle.review.environment.mathlibRevision}</code></Field><Field label="Entry command"><code>{evidence.bundle.review.entryCommand.join(" ")}</code></Field><Field label={<><code>sorry</code> policy</>}> {evidence.bundle.review.policy.requireNoSorry ? "Required absent" : "Not required"}</Field><Field label="Allowed axioms">{evidence.bundle.review.policy.allowedAxioms.length === 0 ? "None" : <code>{evidence.bundle.review.policy.allowedAxioms.join(", ")}</code>}</Field></FieldList><SourceDiffPreview href={artifactHref(bundleManifestHash, "sourcePatch")} /></Surface>
      </section>
      <section className="evidence-runs" aria-label="Runner records"><div className="panel-heading"><span>03 / Runner records</span><span>{evidence.runs.length} recorded</span></div>{evidence.runs.length === 0 ? <p className="evidence-empty">No Runner record is stored for this Bundle. That absence is not a failed verification or a fresh-replay option.</p> : evidence.runs.map((run) => <Surface as="article" className="evidence-run" key={run.id}><div><strong>{run.state}</strong><span><code>{run.id}</code></span></div><FieldList className="evidence-metadata"><Field label="Request hash"><code>{run.requestHash}</code></Field><Field label="Result hash"><code>{run.runnerResultHash ?? "Not recorded"}</code></Field><Field label="Queued">{run.queuedAt}</Field><Field label="Finished">{run.finishedAt ?? "Not finished"}</Field></FieldList>{run.result?.summary && <RunnerResultSummary summary={run.result.summary} />}{run.outputs.length > 0 && <ArtifactList bundleManifestHash={bundleManifestHash} artifacts={run.outputs} />}{run.result && <details className="evidence-result"><summary>View canonical signed-result payload</summary><CodeBlock><code>{run.result.canonicalResult}</code></CodeBlock></details>}</Surface>)}</section>
      {evidence.summary.accessRole === "attempt_owner" && <IndependentReviewHandoff bundleManifestHash={bundleManifestHash} eligible={hasAcceptedLeanEvidence(evidence)} initialStatus={reviewMarketStatus} unavailable={reviewMarketUnavailable} receipt={evidence.receipt} />}
      <section className="evidence-runs evidence-manifest" aria-label="Canonical manifest"><div className="panel-heading"><span>{evidence.summary.accessRole === "attempt_owner" ? "05" : "04"} / Canonical manifest</span><a className="text-link" href={artifactHref(bundleManifestHash, "bundle-manifest")}>Download JSON <span>→</span></a></div><CodeBlock><code>{evidence.bundle.canonicalManifest}</code></CodeBlock></section>
      {evidence.summary.accessRole === "attempt_owner" && <ReviewOutcomes outcomes={evidence.reviewOutcomes} />}
      <section className="evidence-runs evidence-replays" aria-label="Fresh review replay evidence"><div className="panel-heading"><span>{evidence.summary.accessRole === "attempt_owner" ? "07" : "05"} / Fresh review replay evidence</span><span>{evidence.replays.length} available to you</span></div>{evidence.replays.length === 0 ? <p className="evidence-empty">{replayEmptyMessage}</p> : evidence.replays.map((replay) => <ReplayEvidence bundleManifestHash={bundleManifestHash} replay={replay} key={replay.id} />)}</section>
      </PersonalWorkspaceFrame>
    </SiteFrame>;
}

function ArtifactList({ bundleManifestHash, artifacts }: { bundleManifestHash: string; artifacts: readonly EvidenceArtifact[] }) {
  return <ul className="evidence-artifact-list">{artifacts.map((artifact) => <li key={artifact.id}><div><strong>{artifact.label}</strong><small><code>{artifact.contentHash}</code> · {formatBytes(artifact.byteLength)} · {artifact.contentType}</small></div><a className="quiet-action" href={artifactHref(bundleManifestHash, artifact.id)}>Download</a></li>)}</ul>;
}

function ReplayEvidence({ bundleManifestHash, replay }: { bundleManifestHash: string; replay: EvidenceReplay }) {
  return <Surface as="article" className="evidence-run evidence-replay">
    <div><strong>Terminal replay recorded</strong><span><code>{replay.id}</code></span></div>
    <FieldList className="evidence-metadata"><Field label="Assignment"><code>{replay.assignmentId}</code></Field><Field label="Fresh Run"><code>{replay.runId}</code></Field><Field label="Runner result"><code>{replay.runnerResultHash}</code></Field><Field label="Evidence hash"><code>{replay.evidenceHash}</code></Field><Field label="Recorded">{replay.recordedAt}</Field></FieldList>
    <ArtifactList bundleManifestHash={bundleManifestHash} artifacts={[replay.artifact]} />
    <details className="evidence-result"><summary>View canonical replay-evidence payload</summary><CodeBlock><code>{replay.canonicalEvidence}</code></CodeBlock></details>
  </Surface>;
}

function ReviewOutcomes({ outcomes }: { outcomes: readonly EvidenceReviewOutcome[] }) {
  return <section className="evidence-runs evidence-review-outcomes" aria-label="Independent review outcomes">
    <div className="panel-heading"><span>06 / Independent review outcomes</span><span>{outcomes.length} signed</span></div>
    {outcomes.length === 0
      ? <p className="evidence-empty">No signed independent review outcome is recorded for this Bundle. Assigned and accepted tasks are not shown as decisions.</p>
      : outcomes.map((outcome) => <Surface as="article" className="evidence-run evidence-review-outcome" key={outcome.assignmentId}>
        <div><strong>{reviewDecisionLabel(outcome.decision)}</strong><span><code>{outcome.claimType}</code></span></div>
        <FieldList className="evidence-metadata"><Field label="Assignment"><code>{outcome.assignmentId}</code></Field><Field label="Evidence hash"><code>{outcome.evidenceHash}</code></Field><Field label="Recorded">{outcome.attestedAt}</Field></FieldList>
        <p className="evidence-empty">{reviewDecisionDetail(outcome.decision)}</p>
      </Surface>)}
  </section>;
}

function reviewDecisionLabel(decision: EvidenceReviewOutcome["decision"]) {
  return {
    attested: "Attested",
    rejected: "Rejected",
    request_changes: "Changes requested",
    conflict_declared: "Conflict declared",
    integrity_flagged: "Integrity flag",
  }[decision];
}

function reviewDecisionDetail(decision: EvidenceReviewOutcome["decision"]) {
  if (decision === "attested") return "This is a signed review claim. Receipt eligibility remains subject to the contribution policy and all other required evidence.";
  if (decision === "conflict_declared") return "This review is closed because of a signed conflict declaration. A different Person must perform any replacement review.";
  if (decision === "integrity_flagged") return "This signed evidence-integrity concern blocks this assignment from satisfying a receipt gate. It is not a mathematical conclusion or an automatic retraction.";
  if (decision === "request_changes") return "This review is closed without a positive verification. A revised Bundle needs a new immutable review assignment.";
  return "This review is closed without a positive verification or receipt gate.";
}

function RunnerResultSummary({ summary }: { summary: EvidenceRunnerResultSummary }) {
  return <FieldList className="evidence-metadata evidence-run-summary"><Field label="Build status">{summary.status} · exit {summary.exitCode}</Field><Field label="Kernel">{summary.kernelStatus}</Field><Field label="Network">{summary.checks.network}</Field><Field label={<><code>sorry</code> audit</>}> {summary.checks.noSorry}</Field><Field label="Axiom policy">{summary.checks.allowedAxioms}</Field><Field label="Lean build">{summary.checks.leanBuild}</Field></FieldList>;
}

function artifactHref(bundleManifestHash: string, artifactId: string) {
  return `/api/me/evidence/bundles/${encodeURIComponent(bundleManifestHash)}/artifacts/${encodeURIComponent(artifactId)}`;
}

function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${Math.round((bytes / 1024) * 10) / 10} KiB`;
}

function EvidenceAccessMessage({ signInPath, unavailable }: { signInPath?: string; unavailable?: boolean }) {
  return <SiteFrame className="site-shell app-shell" active="workbench" mainClassName="page-main evidence-main personal-workspace-main"><PersonalWorkspaceFrame active="evidence"><Breadcrumb><Link href="/evidence">Evidence records</Link><span> / </span><span>Controlled record</span></Breadcrumb><SectionHeading as="section" className="review-heading"><div><p className="eyebrow">Controlled evidence access</p><PageTitle>{unavailable ? "Evidence records are temporarily unavailable." : "Sign in to inspect controlled evidence."}</PageTitle><p>{unavailable ? "No unverified fallback evidence is shown while storage is unavailable." : "Only the recorded Attempt owner or an independently assigned reviewer can inspect this record."}</p></div><Badge className="record-chip">{unavailable ? "Unavailable" : "Personal"}</Badge></SectionHeading>{signInPath && <ActionLink className="button button-primary review-sign-in" href={signInPath}>Sign in to inspect <span aria-hidden="true">→</span></ActionLink>}</PersonalWorkspaceFrame></SiteFrame>;
}
