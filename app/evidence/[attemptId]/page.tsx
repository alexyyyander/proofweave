import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser, signInPath, toPersonIdentity } from "@/app/auth";
import { Footer } from "@/app/ui";
import { Header } from "@/app/header";
import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository } from "@/db/repositories/delegation";
import { getEvidenceRepository, type AttemptEvidence, type EvidenceArtifact, type EvidenceReplay, type EvidenceReviewOutcome, type EvidenceRunnerResultSummary } from "@/db/repositories/evidence";
import { SourceDiffPreview } from "@/app/evidence/SourceDiffPreview";
import { PersonalWorkspaceFrame } from "@/app/PersonalWorkspaceFrame";
import { IndependentReviewHandoff } from "@/app/evidence/IndependentReviewHandoff";
import { hasAcceptedLeanEvidence } from "@/app/lib/evidence-eligibility";
import { getVerificationMarketRepository, type BundleVerificationMarketStatus, VerificationMarketSchemaUnavailableError } from "@/db/repositories/verification-market";

export const dynamic = "force-dynamic";

export default async function EvidenceDetailPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId: bundleManifestHash } = await params;
  const user = await getCurrentUser();
  const result = await loadEvidenceDetail(user, bundleManifestHash);
  if (!user) return <EvidenceAccessMessage signInPath={signInPath(`/evidence/${encodeURIComponent(bundleManifestHash)}`)} />;
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
  return <div className="site-shell app-shell">
    <Header active="workbench" />
    <main id="main-content" tabIndex={-1} className="page-main evidence-main personal-workspace-main">
      <PersonalWorkspaceFrame active="evidence">
      <div className="breadcrumb"><Link href="/evidence">Evidence records</Link><span> / </span><span>{bundleManifestHash}</span></div>
      <section className="review-heading evidence-detail-heading"><div><p className="eyebrow">{evidence.summary.accessRole === "attempt_owner" ? "Your Attempt · controlled evidence" : "Assigned review · controlled evidence"}</p><h1>{evidence.summary.target.title}</h1><p>These are stored hashes, signed Bundle metadata, and Runner outputs. Downloading an object does not perform a fresh runner replay or create a verification claim.</p></div><span className="record-chip">{evidence.bundle.protocolVersion}</span></section>
      <section className="evidence-integrity-note"><strong>Access boundary</strong><p>{evidence.summary.accessRole === "attempt_owner" ? "You are the recorded Attempt owner." : "You are an assigned independent reviewer; the submitter’s Person identity is intentionally omitted."} Every download is checked against the immutable D1 index and content hash before bounded alpha bytes are returned.</p></section>
      <section className="evidence-detail-grid" aria-label="Bundle review facts">
        <article className="evidence-panel"><div className="panel-heading"><span>01 / Signed Artifact Bundle</span><span className="record-chip">Immutable</span></div><dl className="evidence-metadata"><div><dt>Manifest hash</dt><dd><code>{evidence.bundle.manifestHash}</code></dd></div><div><dt>Agent event</dt><dd><code>{evidence.bundle.agentEventId}</code></dd></div><div><dt>Event payload hash</dt><dd><code>{evidence.bundle.agentEventPayloadHash}</code></dd></div><div><dt>Submitting Agent</dt><dd>{evidence.summary.agentLabel}</dd></div></dl><ArtifactList bundleManifestHash={bundleManifestHash} artifacts={evidence.bundle.artifacts} /></article>
        <article className="evidence-panel"><div className="panel-heading"><span>02 / Review facts</span><a className="text-link" href={artifactHref(bundleManifestHash, "sourcePatch")}>Download source diff <span>→</span></a></div><dl className="evidence-metadata"><div><dt>Target declaration</dt><dd><code>{evidence.bundle.review.target.declaration}</code></dd></div><div><dt>Statement hash</dt><dd><code>{evidence.bundle.review.target.statementHash}</code></dd></div><div><dt>Lean toolchain</dt><dd><code>{evidence.bundle.review.environment.leanToolchain}</code></dd></div><div><dt>Mathlib revision</dt><dd><code>{evidence.bundle.review.environment.mathlibRevision}</code></dd></div><div><dt>Entry command</dt><dd><code>{evidence.bundle.review.entryCommand.join(" ")}</code></dd></div><div><dt><code>sorry</code> policy</dt><dd>{evidence.bundle.review.policy.requireNoSorry ? "Required absent" : "Not required"}</dd></div><div><dt>Allowed axioms</dt><dd>{evidence.bundle.review.policy.allowedAxioms.length === 0 ? "None" : <code>{evidence.bundle.review.policy.allowedAxioms.join(", ")}</code>}</dd></div></dl><SourceDiffPreview href={artifactHref(bundleManifestHash, "sourcePatch")} /></article>
      </section>
      <section className="evidence-runs" aria-label="Runner records"><div className="panel-heading"><span>03 / Runner records</span><span>{evidence.runs.length} recorded</span></div>{evidence.runs.length === 0 ? <p className="evidence-empty">No Runner record is stored for this Bundle. That absence is not a failed verification or a fresh-replay option.</p> : evidence.runs.map((run) => <article className="evidence-run" key={run.id}><div><strong>{run.state}</strong><span><code>{run.id}</code></span></div><dl className="evidence-metadata"><div><dt>Request hash</dt><dd><code>{run.requestHash}</code></dd></div><div><dt>Result hash</dt><dd><code>{run.runnerResultHash ?? "Not recorded"}</code></dd></div><div><dt>Queued</dt><dd>{run.queuedAt}</dd></div><div><dt>Finished</dt><dd>{run.finishedAt ?? "Not finished"}</dd></div></dl>{run.result?.summary && <RunnerResultSummary summary={run.result.summary} />}{run.outputs.length > 0 && <ArtifactList bundleManifestHash={bundleManifestHash} artifacts={run.outputs} />}{run.result && <details className="evidence-result"><summary>View canonical signed-result payload</summary><pre><code>{run.result.canonicalResult}</code></pre></details>}</article>)}</section>
      {evidence.summary.accessRole === "attempt_owner" && <IndependentReviewHandoff bundleManifestHash={bundleManifestHash} eligible={hasAcceptedLeanEvidence(evidence)} initialStatus={reviewMarketStatus} unavailable={reviewMarketUnavailable} receipt={evidence.receipt} />}
      <section className="evidence-runs evidence-manifest" aria-label="Canonical manifest"><div className="panel-heading"><span>{evidence.summary.accessRole === "attempt_owner" ? "05" : "04"} / Canonical manifest</span><a className="text-link" href={artifactHref(bundleManifestHash, "bundle-manifest")}>Download JSON <span>→</span></a></div><pre><code>{evidence.bundle.canonicalManifest}</code></pre></section>
      {evidence.summary.accessRole === "attempt_owner" && <ReviewOutcomes outcomes={evidence.reviewOutcomes} />}
      <section className="evidence-runs evidence-replays" aria-label="Fresh review replay evidence"><div className="panel-heading"><span>{evidence.summary.accessRole === "attempt_owner" ? "07" : "05"} / Fresh review replay evidence</span><span>{evidence.replays.length} available to you</span></div>{evidence.replays.length === 0 ? <p className="evidence-empty">{replayEmptyMessage}</p> : evidence.replays.map((replay) => <ReplayEvidence bundleManifestHash={bundleManifestHash} replay={replay} key={replay.id} />)}</section>
      </PersonalWorkspaceFrame>
    </main>
    <Footer />
  </div>;
}

function ArtifactList({ bundleManifestHash, artifacts }: { bundleManifestHash: string; artifacts: readonly EvidenceArtifact[] }) {
  return <ul className="evidence-artifact-list">{artifacts.map((artifact) => <li key={artifact.id}><div><strong>{artifact.label}</strong><small><code>{artifact.contentHash}</code> · {formatBytes(artifact.byteLength)} · {artifact.contentType}</small></div><a className="quiet-action" href={artifactHref(bundleManifestHash, artifact.id)}>Download</a></li>)}</ul>;
}

function ReplayEvidence({ bundleManifestHash, replay }: { bundleManifestHash: string; replay: EvidenceReplay }) {
  return <article className="evidence-run evidence-replay">
    <div><strong>Terminal replay recorded</strong><span><code>{replay.id}</code></span></div>
    <dl className="evidence-metadata"><div><dt>Assignment</dt><dd><code>{replay.assignmentId}</code></dd></div><div><dt>Fresh Run</dt><dd><code>{replay.runId}</code></dd></div><div><dt>Runner result</dt><dd><code>{replay.runnerResultHash}</code></dd></div><div><dt>Evidence hash</dt><dd><code>{replay.evidenceHash}</code></dd></div><div><dt>Recorded</dt><dd>{replay.recordedAt}</dd></div></dl>
    <ArtifactList bundleManifestHash={bundleManifestHash} artifacts={[replay.artifact]} />
    <details className="evidence-result"><summary>View canonical replay-evidence payload</summary><pre><code>{replay.canonicalEvidence}</code></pre></details>
  </article>;
}

function ReviewOutcomes({ outcomes }: { outcomes: readonly EvidenceReviewOutcome[] }) {
  return <section className="evidence-runs evidence-review-outcomes" aria-label="Independent review outcomes">
    <div className="panel-heading"><span>06 / Independent review outcomes</span><span>{outcomes.length} signed</span></div>
    {outcomes.length === 0
      ? <p className="evidence-empty">No signed independent review outcome is recorded for this Bundle. Assigned and accepted tasks are not shown as decisions.</p>
      : outcomes.map((outcome) => <article className="evidence-run evidence-review-outcome" key={outcome.assignmentId}>
        <div><strong>{reviewDecisionLabel(outcome.decision)}</strong><span><code>{outcome.claimType}</code></span></div>
        <dl className="evidence-metadata"><div><dt>Assignment</dt><dd><code>{outcome.assignmentId}</code></dd></div><div><dt>Evidence hash</dt><dd><code>{outcome.evidenceHash}</code></dd></div><div><dt>Recorded</dt><dd>{outcome.attestedAt}</dd></div></dl>
        <p className="evidence-empty">{reviewDecisionDetail(outcome.decision)}</p>
      </article>)}
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
  return <dl className="evidence-metadata evidence-run-summary"><div><dt>Build status</dt><dd>{summary.status} · exit {summary.exitCode}</dd></div><div><dt>Kernel</dt><dd>{summary.kernelStatus}</dd></div><div><dt>Network</dt><dd>{summary.checks.network}</dd></div><div><dt><code>sorry</code> audit</dt><dd>{summary.checks.noSorry}</dd></div><div><dt>Axiom policy</dt><dd>{summary.checks.allowedAxioms}</dd></div><div><dt>Lean build</dt><dd>{summary.checks.leanBuild}</dd></div></dl>;
}

function artifactHref(bundleManifestHash: string, artifactId: string) {
  return `/api/me/evidence/bundles/${encodeURIComponent(bundleManifestHash)}/artifacts/${encodeURIComponent(artifactId)}`;
}

function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${Math.round((bytes / 1024) * 10) / 10} KiB`;
}

function EvidenceAccessMessage({ signInPath, unavailable }: { signInPath?: string; unavailable?: boolean }) {
  return <div className="site-shell app-shell"><Header active="workbench" /><main id="main-content" tabIndex={-1} className="page-main evidence-main personal-workspace-main"><PersonalWorkspaceFrame active="evidence"><div className="breadcrumb"><Link href="/evidence">Evidence records</Link><span> / </span><span>Controlled record</span></div><section className="review-heading"><div><p className="eyebrow">Controlled evidence access</p><h1>{unavailable ? "Evidence records are temporarily unavailable." : "Sign in to inspect controlled evidence."}</h1><p>{unavailable ? "No unverified fallback evidence is shown while storage is unavailable." : "Only the recorded Attempt owner or an independently assigned reviewer can inspect this record."}</p></div><span className="record-chip">{unavailable ? "Unavailable" : "Personal"}</span></section>{signInPath && <Link className="button button-primary review-sign-in" href={signInPath}>Sign in to inspect <span aria-hidden="true">→</span></Link>}</PersonalWorkspaceFrame></main><Footer /></div>;
}
