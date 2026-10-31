"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, cx } from "@/app/components/ui";
import type { ProofMapIndexEntry, ProofMapIndexSubject, ProofMapIndexSummary, ProofMapStatus } from "@/app/lib/proof-map";

const PER_PAGE = 48;

function statusTone(status: ProofMapStatus): "positive" | "warning" | "neutral" {
  if (status === "deep") return "positive";
  if (status === "draft") return "warning";
  return "neutral";
}

export function ProofMapIndexView({ entries, subjects, summary }: {
  entries: ProofMapIndexEntry[];
  subjects: ProofMapIndexSubject[];
  summary: ProofMapIndexSummary;
}) {
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [status, setStatus] = useState<"all" | ProofMapStatus>("all");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (subject && entry.subject !== subject) return false;
      if (status !== "all" && entry.status !== status) return false;
      if (query && !entry.searchText.includes(query)) return false;
      return true;
    });
  }, [entries, search, subject, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);
  const activeFilters = Boolean(search.trim() || subject || status !== "all");

  const updateSearch = (value: string) => { setSearch(value); setPage(1); };
  const updateSubject = (value: string) => { setSubject(value); setPage(1); };
  const updateStatus = (value: "all" | ProofMapStatus) => { setStatus(value); setPage(1); };
  const reset = () => { setSearch(""); setSubject(""); setStatus("all"); setPage(1); };

  return <section className="proof-map-browser" aria-labelledby="proof-map-browser-title">
    <div className="proof-map-browser-heading">
      <div>
        <p className="eyebrow">Browse the structure</p>
        <h2 id="proof-map-browser-title">Find a result, then inspect what exists.</h2>
      </div>
      <span>{summary.deep} deep · {summary.draft} draft · {summary.scaffold} scaffold</span>
    </div>

    <div className="proof-map-filters">
      <label className="proof-map-search">Search
        <input type="search" value={search} onChange={(event) => updateSearch(event.target.value)} placeholder="Family number, title, claim, or subject" maxLength={240} />
      </label>
      <label>Subject
        <select value={subject} onChange={(event) => updateSubject(event.target.value)}>
          <option value="">All {subjects.length} subjects</option>
          {subjects.map((entry) => <option key={entry.name} value={entry.name}>{entry.name} ({entry.families})</option>)}
        </select>
      </label>
      <label>Structure
        <select value={status} onChange={(event) => updateStatus(event.target.value as "all" | ProofMapStatus)}>
          <option value="all">All statuses</option>
          <option value="deep">Deep argument map ({summary.deep})</option>
          <option value="draft">Draft proof chain ({summary.draft})</option>
          <option value="scaffold">Metadata scaffold ({summary.scaffold})</option>
        </select>
      </label>
      {activeFilters && <button type="button" className="proof-map-reset" onClick={reset}>Clear filters</button>}
    </div>

    <div className="proof-map-results-heading">
      <p><strong>{filtered.length}</strong> {filtered.length === 1 ? "family" : "families"}{activeFilters ? " match these filters" : " in the release"}</p>
      <span>Page {safePage} of {pageCount}</span>
    </div>

    {visible.length > 0 ? <div className="proof-map-grid">
      {visible.map((entry) => <article className={cx("proof-map-card", `status-${entry.status}`)} key={entry.familyNumber}>
        <div className="proof-map-card-top">
          <span className="proof-map-family-number">{entry.familyNumber}</span>
          <span className="proof-map-subject">{entry.subject}</span>
          <Badge tone={statusTone(entry.status)}>{entry.statusLabel}</Badge>
        </div>
        <h3><Link href={entry.route}>{entry.title}</Link></h3>
        <p className="proof-map-claim">{entry.claimSnippet}</p>
        <div className="proof-map-card-meta">
          <span>{entry.manuscriptCount} {entry.manuscriptCount === 1 ? "manuscript" : "manuscripts"}</span>
          <span>{entry.scopeDocument ? "Lean scope documented" : "No Lean scope linked"}</span>
          {entry.comparatorCount > 0 && <span>{entry.comparatorCount} comparator {entry.comparatorCount === 1 ? "link" : "links"}</span>}
          {entry.formalizedManuscripts > 0 && <span>{entry.formalizedManuscripts} upstream-linked</span>}
          <span className="proof-map-replay">Replay not run</span>
        </div>
        <div className="proof-map-card-footer">
          <Link href={entry.route}>Open proof map <span aria-hidden="true">→</span></Link>
          <Link href={entry.publicationRoute}>Publication record</Link>
        </div>
        {entry.status !== "scaffold" && entry.manifestLabel && <small className="proof-map-manifest-label">{entry.manifestLabel}</small>}
      </article>)}
    </div> : <div className="proof-map-empty">
      <strong>No family matches these filters.</strong>
      <p>Try a shorter query, another subject, or all structure statuses.</p>
      <button type="button" onClick={reset}>Clear filters</button>
    </div>}

    {pageCount > 1 && <nav className="proof-map-pagination" aria-label="Proof map pages">
      <button type="button" disabled={safePage === 1} onClick={() => setPage(Math.max(1, safePage - 1))}>← Previous</button>
      <span>Page <strong>{safePage}</strong> of {pageCount}</span>
      <button type="button" disabled={safePage === pageCount} onClick={() => setPage(Math.min(pageCount, safePage + 1))}>Next →</button>
    </nav>}
  </section>;
}
