"use client";

import { Button, Input, Select } from "@/app/components/ui";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useI18n } from "@/app/i18n/client";

export function HistoricalSourceImporter({ problemSlug, canImport, signInPath }: { problemSlug: string; canImport: boolean; signInPath: string }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!canImport) {
    return <p className="historical-source-signin"><Link href={signInPath}>{t("explore.import.signIn")}</Link> {t("explore.import.signInBody")}</p>;
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
      if (!response.ok) throw new Error(payload?.error?.message ?? t("explore.import.error"));
      setStatus(payload?.created ? t("explore.import.created") : t("explore.import.known"));
      formElement.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("explore.import.error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return <details className="historical-source-importer">
    <summary>{t("explore.import.summary")}</summary>
    <form onSubmit={(event) => { void submit(event); }}>
      <p>{t("explore.import.note")}</p>
      <div className="historical-source-fields">
        <label>{t("explore.import.sourceUrl")}<Input name="sourceUrl" type="url" required placeholder={t("explore.import.sourceUrlPlaceholder")} /></label>
        <label>{t("explore.import.title")}<Input name="title" required maxLength={500} /></label>
        <label>{t("explore.import.revision")}<Input name="sourceRevision" required maxLength={240} placeholder={t("explore.import.revisionPlaceholder")} /></label>
        <label>{t("explore.import.contentHash")}<Input name="contentHash" required pattern="sha256:[a-f0-9]{64}" placeholder="sha256:…" /></label>
        <label>{t("explore.import.license")}<Input name="sourceLicense" required maxLength={160} placeholder={t("explore.import.licensePlaceholder")} /></label>
        <label>{t("explore.import.contributorName")}<Input name="contributorName" required maxLength={240} /></label>
        <label>{t("explore.import.contributorRole")}<Select name="contributorRole" defaultValue="author"><option value="author">{t("explore.import.role.author")}</option><option value="formalizer">{t("explore.import.role.formalizer")}</option><option value="prover">{t("explore.import.role.prover")}</option><option value="reviewer">{t("explore.import.role.reviewer")}</option><option value="maintainer">{t("explore.import.role.maintainer")}</option></Select></label>
        <label>{t("explore.import.evidenceUrl")}<Input name="contributorEvidenceUrl" type="url" placeholder={t("explore.import.evidenceUrlPlaceholder")} /></label>
      </div>
      <Button className="button button-secondary" disabled={isSubmitting} type="submit">{isSubmitting ? t("explore.import.submitting") : t("explore.import.submit")}</Button>
      {status && <p className="historical-source-message is-success" role="status">{status}</p>}
      {error && <p className="historical-source-message is-error" role="alert">{error}</p>}
    </form>
  </details>;
}
