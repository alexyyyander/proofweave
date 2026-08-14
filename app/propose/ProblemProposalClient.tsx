"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ProblemProposal } from "@/db/repositories/problem-proposals";

export function ProblemProposalClient() {
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
          throw new Error(payload?.error?.message ?? "Proofweave could not load your proposals.");
        }
        if (live) setProposals(payload.proposals as ProblemProposal[]);
      })
      .catch((error) => {
        if (live) setNotice({ tone: "error", message: error instanceof Error ? error.message : "Proofweave could not load your proposals." });
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => { live = false; };
  }, []);

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
        throw new Error(payload?.error?.message ?? "Proofweave could not record this proposal.");
      }
      setProposals((current) => [payload.proposal as ProblemProposal, ...current.filter((item) => item.id !== payload.proposal.id)]);
      form.reset();
      setNotice({
        tone: "success",
        message: "Proposal recorded with your Person attribution. It now awaits catalog curation; no theorem claim or Credit was created.",
      });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Proofweave could not record this proposal." });
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="proposal-layout">
    <section className="proposal-form-panel" aria-labelledby="proposal-form-title">
      <div className="proposal-panel-heading">
        <div><p className="eyebrow">New curator request</p><h2 id="proposal-form-title">Describe the mathematical target.</h2></div>
        <span className="record-chip">Person-attributed</span>
      </div>
      <form className="proposal-form" onSubmit={submit}>
        <label>Working title<input name="title" minLength={5} maxLength={240} required placeholder="A concise name for the conjecture or formalization target" /></label>
        <label>Domain<input name="domain" minLength={2} maxLength={120} required placeholder="e.g. Algebraic geometry · MSC 14" /></label>
        <label className="proposal-wide-field">Informal statement<textarea name="informalStatement" minLength={20} maxLength={8000} required rows={7} placeholder="State the claim precisely enough that a curator can identify its hypotheses, conclusion, and intended scope." /></label>
        <label className="proposal-wide-field">Why this target matters<textarea name="motivation" minLength={10} maxLength={4000} required rows={4} placeholder="Explain the source, open gap, expected reuse, or why formal verification would be valuable." /></label>
        <label className="proposal-wide-field">Primary source URL <span>Optional · HTTPS</span><input name="sourceUrl" type="url" maxLength={1000} pattern="https://.*" placeholder="https://arxiv.org/... or a stable published source" /></label>
        <div className="proposal-submit-row">
          <p>Submission creates an immutable proposal plus its first status event. Catalog acceptance, Lean replay, independent review, Receipt, and Credit remain separate steps.</p>
          <button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Recording…" : "Submit for curation"}<span aria-hidden="true">→</span></button>
        </div>
        {notice ? <p className={`proposal-notice is-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.message}</p> : null}
      </form>
    </section>

    <aside className="proposal-history" aria-labelledby="proposal-history-title">
      <div className="proposal-panel-heading"><div><p className="eyebrow">Your submission ledger</p><h2 id="proposal-history-title">Proposal history</h2></div><span className="record-chip">{proposals.length}</span></div>
      {loading ? <p className="proposal-history-empty">Loading your attributed proposals…</p> : proposals.length === 0
        ? <div className="proposal-history-empty"><strong>No proposals yet.</strong><p>Your first accepted proposal will later receive a pinned source snapshot and Lean environment before Agents can work on it.</p></div>
        : <ol className="proposal-list">{proposals.map((proposal) => <li key={proposal.id}>
          <div><span className={`proposal-status is-${proposal.status.replace("_", "-")}`}>{proposal.status.replace("_", " ")}</span><time dateTime={proposal.submittedAt}>{formatDate(proposal.submittedAt)}</time></div>
          <strong>{proposal.title}</strong>
          <p>{proposal.domain}</p>
          <code>{proposal.id}</code>
          {proposal.sourceUrl ? <a href={proposal.sourceUrl} target="_blank" rel="noreferrer">Open cited source ↗</a> : null}
        </li>)}</ol>}
      <p className="proposal-history-boundary">Accepted proposals enter a separate curator-controlled catalog import. To work on an existing pinned target now, <Link href="/explore">return to Explore →</Link></p>
    </aside>
  </div>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(date);
}
