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
import { getI18n } from "@/app/i18n/server";
import type { Locale } from "@/app/i18n/config";
import type { TranslationKey, Translator } from "@/app/i18n/translate";

export const dynamic = "force-dynamic";

export default async function EvidenceDetailPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { t, locale } = await getI18n();
  const { attemptId: bundleManifestHash } = await params;
  const readOnly = personalWritesPaused();
  const user = await getCurrentUser();
  if (!user) return <EvidenceAccessMessage signInPath={signInPath(`/evidence/${encodeURIComponent(bundleManifestHash)}`)} t={t} />;
  if (readOnly) {
    return <ReadOnlyPersonalSurface
      active="workbench"
      eyebrow={t("evidenceDetail.readOnly.eyebrow")}
      title={t("evidenceDetail.readOnly.title")}
      detail={t("evidenceDetail.readOnly.detail")}
    />;
  }
  const result = await loadEvidenceDetail(user, bundleManifestHash);
  if (result.unavailable) return <EvidenceAccessMessage unavailable t={t} />;
  if (!result.evidence) notFound();
  return <EvidenceDetail evidence={result.evidence} reviewMarketStatus={result.reviewMarketStatus} reviewMarketUnavailable={result.reviewMarketUnavailable} t={t} locale={locale} />;
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

function EvidenceDetail({ evidence, reviewMarketStatus, reviewMarketUnavailable, t, locale }: { evidence: AttemptEvidence; reviewMarketStatus: BundleVerificationMarketStatus | null; reviewMarketUnavailable: boolean; t: Translator; locale: Locale }) {
  const bundleManifestHash = evidence.bundle.manifestHash;
  const replayEmptyMessage = evidence.summary.accessRole === "attempt_owner"
    ? t("evidenceDetail.replayEmptyOwner")
    : t("evidenceDetail.replayEmptyReviewer");
  return <SiteFrame className="site-shell app-shell" active="workbench" mainClassName="page-main evidence-main personal-workspace-main">
      <PersonalWorkspaceFrame active="evidence">
      <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/evidence">{t("evidenceDetail.breadcrumb.records")}</Link><span> / </span><span>{bundleManifestHash}</span></Breadcrumb>
      <SectionHeading as="section" className="review-heading evidence-detail-heading"><div><p className="eyebrow">{evidence.summary.accessRole === "attempt_owner" ? t("evidenceDetail.eyebrowOwner") : t("evidenceDetail.eyebrowReviewer")}</p><PageTitle>{evidence.summary.target.title}</PageTitle><p>{t("evidenceDetail.body")}</p></div><Badge className="record-chip">{evidence.bundle.protocolVersion}</Badge></SectionHeading>
      <section className="evidence-integrity-note"><strong>{t("evidenceDetail.boundary.title")}</strong><p>{evidence.summary.accessRole === "attempt_owner" ? t("evidenceDetail.boundary.owner") : t("evidenceDetail.boundary.reviewer")} {t("evidenceDetail.boundary.download")}</p></section>
      <section className="evidence-detail-grid" aria-label={t("evidenceDetail.factsAria")}>
        <Surface as="article" className="evidence-panel"><div className="panel-heading"><span>{t("evidenceDetail.panel.bundle")}</span><Badge className="record-chip">{t("evidenceDetail.immutable")}</Badge></div><FieldList className="evidence-metadata"><Field label={t("evidenceDetail.field.manifestHash")}><code>{evidence.bundle.manifestHash}</code></Field><Field label={t("evidenceDetail.field.agentEvent")}><code>{evidence.bundle.agentEventId}</code></Field><Field label={t("evidenceDetail.field.eventPayloadHash")}><code>{evidence.bundle.agentEventPayloadHash}</code></Field><Field label={t("evidenceDetail.field.submittingAgent")}>{evidence.summary.agentLabel}</Field></FieldList><ArtifactList bundleManifestHash={bundleManifestHash} artifacts={evidence.bundle.artifacts} t={t} /></Surface>
        <Surface as="article" className="evidence-panel"><div className="panel-heading"><span>{t("evidenceDetail.panel.review")}</span><a className="text-link" href={artifactHref(bundleManifestHash, "sourcePatch")}>{t("evidenceDetail.downloadDiff")} <span>→</span></a></div><FieldList className="evidence-metadata"><Field label={t("evidenceDetail.field.targetDeclaration")}><code>{evidence.bundle.review.target.declaration}</code></Field><Field label={t("evidenceDetail.field.statementHash")}><code>{evidence.bundle.review.target.statementHash}</code></Field><Field label={t("evidenceDetail.field.leanToolchain")}><code>{evidence.bundle.review.environment.leanToolchain}</code></Field><Field label={t("evidenceDetail.field.mathlibRevision")}><code>{evidence.bundle.review.environment.mathlibRevision}</code></Field><Field label={t("evidenceDetail.field.entryCommand")}><code>{evidence.bundle.review.entryCommand.join(" ")}</code></Field><Field label={<><code>sorry</code> {t("evidenceDetail.field.sorryPolicy")}</>}> {evidence.bundle.review.policy.requireNoSorry ? t("evidenceDetail.requiredAbsent") : t("evidenceDetail.notRequired")}</Field><Field label={t("evidenceDetail.field.allowedAxioms")}>{evidence.bundle.review.policy.allowedAxioms.length === 0 ? t("evidenceDetail.none") : <code>{evidence.bundle.review.policy.allowedAxioms.join(", ")}</code>}</Field></FieldList><SourceDiffPreview href={artifactHref(bundleManifestHash, "sourcePatch")} /></Surface>
      </section>
      <section className="evidence-runs" aria-label={t("evidenceDetail.panel.runs")}><div className="panel-heading"><span>{t("evidenceDetail.panel.runs")}</span><span>{t("evidenceDetail.runsRecorded", { count: evidence.runs.length })}</span></div>{evidence.runs.length === 0 ? <p className="evidence-empty">{t("evidenceDetail.noRunner")}</p> : evidence.runs.map((run) => <Surface as="article" className="evidence-run" key={run.id}><div><strong>{run.state}</strong><span><code>{run.id}</code></span></div><FieldList className="evidence-metadata"><Field label={t("evidenceDetail.field.requestHash")}><code>{run.requestHash}</code></Field><Field label={t("evidenceDetail.field.resultHash")}><code>{run.runnerResultHash ?? t("evidenceDetail.notRecorded")}</code></Field><Field label={t("evidenceDetail.field.queued")}>{formatDate(run.queuedAt, locale)}</Field><Field label={t("evidenceDetail.field.finished")}>{run.finishedAt ? formatDate(run.finishedAt, locale) : t("evidenceDetail.notFinished")}</Field></FieldList>{run.result?.summary && <RunnerResultSummary summary={run.result.summary} t={t} />}{run.outputs.length > 0 && <ArtifactList bundleManifestHash={bundleManifestHash} artifacts={run.outputs} t={t} />}{run.result && <details className="evidence-result"><summary>{t("evidenceDetail.viewCanonical")}</summary><CodeBlock><code>{run.result.canonicalResult}</code></CodeBlock></details>}</Surface>)}</section>
      {evidence.summary.accessRole === "attempt_owner" && <IndependentReviewHandoff bundleManifestHash={bundleManifestHash} eligible={hasAcceptedLeanEvidence(evidence)} initialStatus={reviewMarketStatus} unavailable={reviewMarketUnavailable} receipt={evidence.receipt} />}
      <section className="evidence-runs evidence-manifest" aria-label={t("evidenceDetail.panel.manifest", { number: evidence.summary.accessRole === "attempt_owner" ? "05" : "04" })}><div className="panel-heading"><span>{t("evidenceDetail.panel.manifest", { number: evidence.summary.accessRole === "attempt_owner" ? "05" : "04" })}</span><a className="text-link" href={artifactHref(bundleManifestHash, "bundle-manifest")}>{t("evidenceDetail.downloadJson")} <span>→</span></a></div><CodeBlock><code>{evidence.bundle.canonicalManifest}</code></CodeBlock></section>
      {evidence.summary.accessRole === "attempt_owner" && <ReviewOutcomes outcomes={evidence.reviewOutcomes} t={t} locale={locale} />}
      <section className="evidence-runs evidence-replays" aria-label={t("evidenceDetail.panel.replays", { number: evidence.summary.accessRole === "attempt_owner" ? "07" : "05" })}><div className="panel-heading"><span>{t("evidenceDetail.panel.replays", { number: evidence.summary.accessRole === "attempt_owner" ? "07" : "05" })}</span><span>{t("evidenceDetail.replaysAvailable", { count: evidence.replays.length })}</span></div>{evidence.replays.length === 0 ? <p className="evidence-empty">{replayEmptyMessage}</p> : evidence.replays.map((replay) => <ReplayEvidence bundleManifestHash={bundleManifestHash} replay={replay} t={t} locale={locale} key={replay.id} />)}</section>
      </PersonalWorkspaceFrame>
    </SiteFrame>;
}

function ArtifactList({ bundleManifestHash, artifacts, t }: { bundleManifestHash: string; artifacts: readonly EvidenceArtifact[]; t: Translator }) {
  return <ul className="evidence-artifact-list">{artifacts.map((artifact) => <li key={artifact.id}><div><strong>{artifact.label}</strong><small><code>{artifact.contentHash}</code> · {formatBytes(artifact.byteLength)} · {artifact.contentType}</small></div><a className="quiet-action" href={artifactHref(bundleManifestHash, artifact.id)}>{t("evidenceDetail.artifact.download")}</a></li>)}</ul>;
}

function ReplayEvidence({ bundleManifestHash, replay, t, locale }: { bundleManifestHash: string; replay: EvidenceReplay; t: Translator; locale: Locale }) {
  return <Surface as="article" className="evidence-run evidence-replay">
    <div><strong>{t("evidenceDetail.terminalReplay")}</strong><span><code>{replay.id}</code></span></div>
    <FieldList className="evidence-metadata"><Field label={t("evidenceDetail.field.assignment")}><code>{replay.assignmentId}</code></Field><Field label={t("evidenceDetail.field.freshRun")}><code>{replay.runId}</code></Field><Field label={t("evidenceDetail.field.runnerResult")}><code>{replay.runnerResultHash}</code></Field><Field label={t("evidenceDetail.field.evidenceHash")}><code>{replay.evidenceHash}</code></Field><Field label={t("evidenceDetail.field.recorded")}>{formatDate(replay.recordedAt, locale)}</Field></FieldList>
    <ArtifactList bundleManifestHash={bundleManifestHash} artifacts={[replay.artifact]} t={t} />
    <details className="evidence-result"><summary>{t("evidenceDetail.viewReplay")}</summary><CodeBlock><code>{replay.canonicalEvidence}</code></CodeBlock></details>
  </Surface>;
}

const outcomeKeys: Record<EvidenceReviewOutcome["decision"], TranslationKey> = {
  attested: "evidenceDetail.review.attested",
  rejected: "evidenceDetail.review.rejected",
  request_changes: "evidenceDetail.review.request_changes",
  conflict_declared: "evidenceDetail.review.conflict_declared",
  integrity_flagged: "evidenceDetail.review.integrity_flagged",
};

function ReviewOutcomes({ outcomes, t, locale }: { outcomes: readonly EvidenceReviewOutcome[]; t: Translator; locale: Locale }) {
  return <section className="evidence-runs evidence-review-outcomes" aria-label={t("evidenceDetail.panel.outcomes")}>
    <div className="panel-heading"><span>{t("evidenceDetail.panel.outcomes")}</span><span>{t("evidenceDetail.signed", { count: outcomes.length })}</span></div>
    {outcomes.length === 0
      ? <p className="evidence-empty">{t("evidenceDetail.noOutcomes")}</p>
      : outcomes.map((outcome) => <Surface as="article" className="evidence-run evidence-review-outcome" key={outcome.assignmentId}>
        <div><strong>{t(outcomeKeys[outcome.decision])}</strong><span><code>{outcome.claimType}</code></span></div>
        <FieldList className="evidence-metadata"><Field label={t("evidenceDetail.field.assignment")}><code>{outcome.assignmentId}</code></Field><Field label={t("evidenceDetail.field.evidenceHash")}><code>{outcome.evidenceHash}</code></Field><Field label={t("evidenceDetail.field.recorded")}>{formatDate(outcome.attestedAt, locale)}</Field></FieldList>
        <p className="evidence-empty">{reviewDecisionDetail(outcome.decision, t)}</p>
      </Surface>)}
  </section>;
}

function reviewDecisionDetail(decision: EvidenceReviewOutcome["decision"], t: Translator) {
  const key = `evidenceDetail.reviewDetail.${decision}` as TranslationKey;
  return t(key);
}

function RunnerResultSummary({ summary, t }: { summary: EvidenceRunnerResultSummary; t: Translator }) {
  return <FieldList className="evidence-metadata evidence-run-summary"><Field label={t("evidenceDetail.runner.buildStatus")}>{summary.status} · {t("evidenceDetail.runner.exit", { code: summary.exitCode })}</Field><Field label={t("evidenceDetail.runner.kernel")}>{summary.kernelStatus}</Field><Field label={t("evidenceDetail.runner.network")}>{summary.checks.network}</Field><Field label={<><code>sorry</code> {t("evidenceDetail.runner.sorryAudit")}</>}> {summary.checks.noSorry}</Field><Field label={t("evidenceDetail.runner.axiomPolicy")}>{summary.checks.allowedAxioms}</Field><Field label={t("evidenceDetail.runner.leanBuild")}>{summary.checks.leanBuild}</Field>{summary.environment && <><Field label={t("evidenceDetail.runner.image")}><code>{summary.environment.imageDigest}</code></Field><Field label={t("evidenceDetail.runner.lean")}><code>{summary.environment.leanToolchain}</code> · mathlib:{summary.environment.mathlibRevision.slice(0, 12)}</Field><Field label={t("evidenceDetail.runner.template")}>{summary.environment.templateId ? <code>{summary.environment.templateId}</code> : t("evidenceDetail.notRecorded")}</Field><Field label={t("evidenceDetail.runner.templateBuild")}>{summary.environment.templateBuildId ? <code>{summary.environment.templateBuildId}</code> : t("evidenceDetail.notRecorded")}</Field></>}</FieldList>;
}

function artifactHref(bundleManifestHash: string, artifactId: string) {
  return `/api/me/evidence/bundles/${encodeURIComponent(bundleManifestHash)}/artifacts/${encodeURIComponent(artifactId)}`;
}

function formatDate(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${Math.round((bytes / 1024) * 10) / 10} KiB`;
}

function EvidenceAccessMessage({ signInPath, unavailable, t }: { signInPath?: string; unavailable?: boolean; t: Translator }) {
  return <SiteFrame className="site-shell app-shell" active="workbench" mainClassName="page-main evidence-main personal-workspace-main"><PersonalWorkspaceFrame active="evidence"><Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/evidence">{t("evidenceDetail.breadcrumb.records")}</Link><span> / </span><span>{t("reviewWorkspace.breadcrumb.controlled")}</span></Breadcrumb><SectionHeading as="section" className="review-heading"><div><p className="eyebrow">{t("evidenceDetail.access.eyebrow")}</p><PageTitle>{unavailable ? t("evidenceDetail.access.unavailableTitle") : t("evidenceDetail.access.signInTitle")}</PageTitle><p>{unavailable ? t("evidenceDetail.access.unavailableBody") : t("evidenceDetail.access.signInBody")}</p></div><Badge className="record-chip">{unavailable ? t("evidenceDetail.access.badgeUnavailable") : t("evidenceDetail.access.badgePersonal")}</Badge></SectionHeading>{signInPath && <ActionLink className="button button-primary review-sign-in" href={signInPath}>{t("evidenceDetail.access.signInAction")} <span aria-hidden="true">→</span></ActionLink>}</PersonalWorkspaceFrame></SiteFrame>;
}
