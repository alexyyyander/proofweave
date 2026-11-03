"use client";

import { SectionTitle, Badge, Button, EmptyState, Input, SectionHeading, Surface, Textarea } from "@/app/components/ui";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { type ProblemProposal, type ProblemProposalStatus } from "@/db/repositories/problem-proposals";
import { useI18n } from "@/app/i18n/client";
import type { Locale } from "@/app/i18n/config";
import type { TranslationKey } from "@/app/i18n/translate";

const statusKeys: Record<ProblemProposalStatus, TranslationKey> = {
  submitted: "propose.status.submitted",
  under_review: "propose.status.under_review",
  accepted: "propose.status.accepted",
  rejected: "propose.status.rejected",
  withdrawn: "propose.status.withdrawn",
};

export function ProblemProposalClient() {
  const { t, locale } = useI18n();
  const [proposals, setProposals] = useState<readonly ProblemProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    let live = true;
    void fetch("/api/me/problem-proposals", { headers: { accept: "application/json" } })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(payload?.proposals)) {
          throw new Error(locale === "en" ? payload?.error?.message ?? "Proofweave could not load your proposals." : t("propose.error.load"));
        }
        if (live) setProposals(payload.proposals as ProblemProposal[]);
      })
      .catch((error) => {
        if (live) setNotice({ tone: "error", message: locale === "en" && error instanceof Error ? error.message : t("propose.error.load") });
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => { live = false; };
  }, [locale, t]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setNotice(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const idempotencyKey = `problem-proposal:${crypto.randomUUID()}`;
    try {
      const response = await fetch("/api/me/problem-proposals", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          title: data.get("title"),
          domain: data.get("domain"),
          informalStatement: data.get("informalStatement"),
          motivation: data.get("motivation"),
          sourceUrl: data.get("sourceUrl"),
          idempotencyKey,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.proposal) {
        throw new Error(locale === "en" ? payload?.error?.message ?? "Proofweave could not record this proposal." : t("propose.error.record"));
      }
      setProposals((current) => [payload.proposal as ProblemProposal, ...current.filter((item) => item.id !== payload.proposal.id)]);
      form.reset();
      setNotice({ tone: "success", message: t("propose.notice.recorded") });
    } catch (error) {
      setNotice({ tone: "error", message: locale === "en" && error instanceof Error ? error.message : t("propose.error.record") });
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="proposal-layout">
    <Surface as="section" className="proposal-form-panel" aria-labelledby="proposal-form-title">
      <SectionHeading as="div" className="proposal-panel-heading">
        <div><p className="eyebrow">{t("propose.form.eyebrow")}</p><SectionTitle id="proposal-form-title">{t("propose.form.title")}</SectionTitle></div>
        <Badge className="record-chip">{t("propose.form.badge")}</Badge>
      </SectionHeading>
      <form className="proposal-form" onSubmit={submit}>
        <label>{t("propose.field.title")}<Input name="title" minLength={5} maxLength={240} required placeholder={t("propose.field.titlePlaceholder")} /></label>
        <label>{t("propose.field.domain")}<Input name="domain" minLength={2} maxLength={120} required placeholder={t("propose.field.domainPlaceholder")} /></label>
        <label className="proposal-wide-field">{t("propose.field.statement")}<Textarea name="informalStatement" minLength={20} maxLength={8000} required rows={7} placeholder={t("propose.field.statementPlaceholder")} /></label>
        <label className="proposal-wide-field">{t("propose.field.motivation")}<Textarea name="motivation" minLength={10} maxLength={4000} required rows={4} placeholder={t("propose.field.motivationPlaceholder")} /></label>
        <label className="proposal-wide-field">{t("propose.field.sourceUrl")} <span>{t("propose.field.optional")}</span><Input name="sourceUrl" type="url" maxLength={1000} pattern="https://.*" placeholder={t("propose.field.sourceUrlPlaceholder")} /></label>
        <div className="proposal-submit-row">
          <p>{t("propose.submit.note")}</p>
          <Button className="button button-primary" type="submit" disabled={submitting}>{submitting ? t("propose.submit.recording") : t("propose.submit.action")}<span aria-hidden="true">→</span></Button>
        </div>
        {notice ? <p className={`proposal-notice is-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.message}</p> : null}
      </form>
    </Surface>

    <aside className="proposal-history" aria-labelledby="proposal-history-title">
      <SectionHeading as="div" className="proposal-panel-heading"><div><p className="eyebrow">{t("propose.history.eyebrow")}</p><SectionTitle id="proposal-history-title">{t("propose.history.title")}</SectionTitle></div><Badge className="record-chip">{proposals.length}</Badge></SectionHeading>
      {loading ? <p className="proposal-history-empty">{t("propose.history.loading")}</p> : proposals.length === 0
        ? <EmptyState as="div" className="proposal-history-empty"><strong>{t("propose.history.emptyTitle")}</strong><p>{t("propose.history.emptyBody")}</p></EmptyState>
        : <ol className="proposal-list">{proposals.map((proposal) => <li key={proposal.id}>
          <div><span className={`proposal-status is-${proposal.status.replace("_", "-")}`}>{t(statusKeys[proposal.status])}</span><time dateTime={proposal.submittedAt}>{formatDate(proposal.submittedAt, locale)}</time></div>
          <strong>{proposal.title}</strong>
          <p>{proposal.domain}</p>
          <code>{proposal.id}</code>
          {proposal.sourceUrl ? <a href={proposal.sourceUrl} target="_blank" rel="noreferrer">{t("propose.history.openSource")} ↗</a> : null}
        </li>)}</ol>}
      <p className="proposal-history-boundary">{t("propose.history.boundaryA")} <Link href="/explore">{t("propose.history.boundaryLink")} →</Link></p>
    </aside>
  </div>;
}

function formatDate(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(date);
}
