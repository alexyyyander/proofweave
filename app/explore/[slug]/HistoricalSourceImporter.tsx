"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

export function HistoricalSourceImporter({ problemSlug, canImport, signInPath }: { problemSlug: string; canImport: boolean; signInPath: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!canImport) {
    return <p className="historical-source-signin"><Link href={signInPath}>Sign in</Link> to link source-backed prior work to this problem.</p>;
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    const formElement = event.currentTarget;
    setIsSubmitting(true);
    setStatus(null);
    setError(null);
    const form = new FormData(formElement);
    const sourceUrl = String(form.get("sourceUrl") ?? "").trim();
    try {
      const url = new URL(sourceUrl);
      const contributorEvidenceUrl = String(form.get("contributorEvidenceUrl") ?? "").trim() || sourceUrl;
      const response = await fetch("/api/me/research/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          problemSlug,
          sourceSystem: url.hostname,
          sourceUrl,
          sourceObjectId: `${url.hostname}${url.pathname}`,
          sourceRevision: String(form.get("sourceRevision") ?? "").trim(),
          title: String(form.get("title") ?? "").trim(),
          contentHash: String(form.get("contentHash") ?? "").trim(),
          sourceLicense: String(form.get("sourceLicense") ?? "").trim(),
          contributors: [{
            displayName: String(form.get("contributorName") ?? "").trim(),
            persistentIdScheme: null,
            persistentId: null,
            role: String(form.get("contributorRole") ?? "author"),
            evidenceUrl: contributorEvidenceUrl,
          }],
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Proofweave could not link this historical source.");
      setStatus(payload?.created ? "Prior work linked with source-backed attribution. Refresh to see it in the graph." : "This exact source revision was already known; its problem link and attribution are now recorded.");
      formElement.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Proofweave could not link this historical source.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return <details className="historical-source-importer">
    <summary>Add source-backed prior work</summary>
    <form onSubmit={(event) => { void submit(event); }}>
      <p>This preserves the original source and contributor name. It does not create Proofweave verification, delegation, novelty, contribution credit, or a Receipt.</p>
      <div className="historical-source-fields">
        <label>Source URL<input name="sourceUrl" type="url" required placeholder="https://doi.org/… or repository URL" /></label>
        <label>Title<input name="title" required maxLength={500} /></label>
        <label>Exact revision<input name="sourceRevision" required maxLength={240} placeholder="DOI version, commit SHA, or release tag" /></label>
        <label>Content SHA-256<input name="contentHash" required pattern="sha256:[a-f0-9]{64}" placeholder="sha256:…" /></label>
        <label>Source license<input name="sourceLicense" required maxLength={160} placeholder="For example, MIT or CC BY 4.0" /></label>
        <label>Contributor name<input name="contributorName" required maxLength={240} /></label>
        <label>Contributor role<select name="contributorRole" defaultValue="author"><option value="author">Author</option><option value="formalizer">Formalizer</option><option value="prover">Prover</option><option value="reviewer">Reviewer</option><option value="maintainer">Maintainer</option></select></label>
        <label>Attribution evidence URL<input name="contributorEvidenceUrl" type="url" placeholder="Defaults to source URL" /></label>
      </div>
      <button className="button button-secondary" disabled={isSubmitting} type="submit">{isSubmitting ? "Linking source…" : "Link prior work"}</button>
      {status && <p className="historical-source-message is-success" role="status">{status}</p>}
      {error && <p className="historical-source-message is-error" role="alert">{error}</p>}
    </form>
  </details>;
}
