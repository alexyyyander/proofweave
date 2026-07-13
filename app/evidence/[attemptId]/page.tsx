import Link from "next/link";
import { notFound } from "next/navigation";
import { chatGPTSignInPath, getChatGPTUser } from "@/app/chatgpt-auth";
import { Footer, Header } from "@/app/ui";
import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository } from "@/db/repositories/delegation";
import { getEvidenceRepository, type AttemptEvidence, type EvidenceArtifact } from "@/db/repositories/evidence";

export const dynamic = "force-dynamic";

export default async function EvidenceDetailPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId: bundleManifestHash } = await params;
  const user = await getChatGPTUser();
  const result = await loadEvidenceDetail(user, bundleManifestHash);
  if (!user) return <EvidenceAccessMessage signInPath={chatGPTSignInPath(`/evidence/${encodeURIComponent(bundleManifestHash)}`)} />;
  if (result.unavailable) return <EvidenceAccessMessage unavailable />;
  if (!result.evidence) notFound();
  return <EvidenceDetail evidence={result.evidence} />;
}

async function loadEvidenceDetail(user: Awaited<ReturnType<typeof getChatGPTUser>>, bundleManifestHash: string): Promise<{ evidence: AttemptEvidence | null; unavailable: boolean }> {
  if (!user) return { evidence: null, unavailable: false };
  try {
    const profile = await getDelegationRepository().getProfile({ provider: "chatgpt", subject: user.email, displayName: user.displayName });
    return { evidence: await getEvidenceRepository().getForPerson(profile.person.id, bundleManifestHash), unavailable: false };
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return { evidence: null, unavailable: true };
    throw error;
  }
}

function EvidenceDetail({ evidence }: { evidence: AttemptEvidence }) {
  const bundleManifestHash = evidence.bundle.manifestHash;
  return <div className="site-shell app-shell">
    <Header active="workbench" />
    <main className="page-main evidence-main">
      <div className="breadcrumb"><Link href="/evidence">Evidence records</Link><span> / </span><span>{bundleManifestHash}</span></div>
      <section className="review-heading evidence-detail-heading"><div><p className="eyebrow">{evidence.summary.accessRole === "attempt_owner" ? "Your Attempt · controlled evidence" : "Assigned review · controlled evidence"}</p><h1>{evidence.summary.target.title}</h1><p>These are stored hashes, signed Bundle metadata, and Runner outputs. Downloading an object does not perform a fresh runner replay or create a verification claim.</p></div><span className="record-chip">{evidence.bundle.protocolVersion}</span></section>
      <section className="evidence-integrity-note"><strong>Access boundary</strong><p>{evidence.summary.accessRole === "attempt_owner" ? "You are the recorded Attempt owner." : "You are an assigned independent reviewer; the submitter’s Person identity is intentionally omitted."} Every download is checked against the immutable D1 object index before its private R2 bytes are returned.</p></section>
      <section className="evidence-detail-grid" aria-label="Bundle and Runner evidence">
        <article className="evidence-panel"><div className="panel-heading"><span>01 / Signed Artifact Bundle</span><span className="record-chip">Immutable</span></div><dl className="evidence-metadata"><div><dt>Manifest hash</dt><dd><code>{evidence.bundle.manifestHash}</code></dd></div><div><dt>Agent event</dt><dd><code>{evidence.bundle.agentEventId}</code></dd></div><div><dt>Event payload hash</dt><dd><code>{evidence.bundle.agentEventPayloadHash}</code></dd></div><div><dt>Submitting Agent</dt><dd>{evidence.summary.agentLabel}</dd></div></dl><ArtifactList bundleManifestHash={bundleManifestHash} artifacts={evidence.bundle.artifacts} /></article>
        <article className="evidence-panel evidence-manifest"><div className="panel-heading"><span>02 / Canonical manifest</span><a className="text-link" href={artifactHref(bundleManifestHash, "bundle-manifest")}>Download JSON <span>→</span></a></div><pre><code>{evidence.bundle.canonicalManifest}</code></pre></article>
      </section>
      <section className="evidence-runs" aria-label="Runner records"><div className="panel-heading"><span>03 / Runner records</span><span>{evidence.runs.length} recorded</span></div>{evidence.runs.length === 0 ? <p className="evidence-empty">No Runner record is stored for this Bundle. That absence is not a failed verification or a fresh-replay option.</p> : evidence.runs.map((run) => <article className="evidence-run" key={run.id}><div><strong>{run.state}</strong><span><code>{run.id}</code></span></div><dl className="evidence-metadata"><div><dt>Request hash</dt><dd><code>{run.requestHash}</code></dd></div><div><dt>Result hash</dt><dd><code>{run.runnerResultHash ?? "Not recorded"}</code></dd></div><div><dt>Queued</dt><dd>{run.queuedAt}</dd></div><div><dt>Finished</dt><dd>{run.finishedAt ?? "Not finished"}</dd></div></dl>{run.outputs.length > 0 && <ArtifactList bundleManifestHash={bundleManifestHash} artifacts={run.outputs} />}{run.result && <details className="evidence-result"><summary>View canonical signed-result payload</summary><pre><code>{run.result.canonicalResult}</code></pre></details>}</article>)}</section>
    </main>
    <Footer />
  </div>;
}

function ArtifactList({ bundleManifestHash, artifacts }: { bundleManifestHash: string; artifacts: readonly EvidenceArtifact[] }) {
  return <ul className="evidence-artifact-list">{artifacts.map((artifact) => <li key={artifact.id}><div><strong>{artifact.label}</strong><small><code>{artifact.contentHash}</code> · {formatBytes(artifact.byteLength)} · {artifact.contentType}</small></div><a className="quiet-action" href={artifactHref(bundleManifestHash, artifact.id)}>Download</a></li>)}</ul>;
}

function artifactHref(bundleManifestHash: string, artifactId: string) {
  return `/api/me/evidence/bundles/${encodeURIComponent(bundleManifestHash)}/artifacts/${encodeURIComponent(artifactId)}`;
}

function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${Math.round((bytes / 1024) * 10) / 10} KiB`;
}

function EvidenceAccessMessage({ signInPath, unavailable }: { signInPath?: string; unavailable?: boolean }) {
  return <div className="site-shell app-shell"><Header active="workbench" /><main className="page-main evidence-main"><div className="breadcrumb"><Link href="/evidence">Evidence records</Link><span> / </span><span>Controlled record</span></div><section className="review-heading"><div><p className="eyebrow">Controlled evidence access</p><h1>{unavailable ? "Evidence records are temporarily unavailable." : "Sign in to inspect controlled evidence."}</h1><p>{unavailable ? "No unverified fallback evidence is shown while storage is unavailable." : "Only the recorded Attempt owner or an independently assigned reviewer can inspect this record."}</p></div><span className="record-chip">{unavailable ? "Unavailable" : "Personal"}</span></section>{signInPath && <Link className="button button-primary review-sign-in" href={signInPath}>Sign in to inspect <span aria-hidden="true">→</span></Link>}</main><Footer /></div>;
}
