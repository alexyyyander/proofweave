"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, cx } from "@/app/components/ui";
import { useI18n } from "@/app/i18n/client";
import type { TranslationKey } from "@/app/i18n/translate";
import type { ProofMapIndexEntry, ProofMapIndexSubject, ProofMapIndexSummary, ProofMapStatus } from "@/app/lib/proof-map";

const PER_PAGE = 48;

const statusKeys: Record<ProofMapStatus, TranslationKey> = {
  deep: "proofMaps.index.statusDeep",
  draft: "proofMaps.index.statusDraft",
  paper: "proofMaps.index.statusPaper",
  lean: "proofMaps.index.statusLean",
  scaffold: "proofMaps.index.statusScaffold",
};

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
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [status, setStatus] = useState<"all" | ProofMapStatus>("all");
  const [leanStatus, setLeanStatus] = useState<"all" | "extracted" | "none">("all");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (subject && entry.subject !== subject) return false;
      if (status !== "all" && entry.status !== status) return false;
      if (leanStatus === "extracted" && entry.lean.status !== "extracted" && entry.lean.status !== "partial") return false;
      if (leanStatus === "none" && (entry.lean.status === "extracted" || entry.lean.status === "partial")) return false;
      if (query && !entry.searchText.includes(query)) return false;
      return true;
    });
  }, [entries, search, subject, status, leanStatus]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);
  const activeFilters = Boolean(search.trim() || subject || status !== "all" || leanStatus !== "all");

  const updateSearch = (value: string) => { setSearch(value); setPage(1); };
  const updateSubject = (value: string) => { setSubject(value); setPage(1); };
  const updateStatus = (value: "all" | ProofMapStatus) => { setStatus(value); setPage(1); };
  const updateLeanStatus = (value: "all" | "extracted" | "none") => { setLeanStatus(value); setPage(1); };
  const reset = () => { setSearch(""); setSubject(""); setStatus("all"); setLeanStatus("all"); setPage(1); };

  return <section className="proof-map-browser" aria-labelledby="proof-map-browser-title">
    <div className="proof-map-browser-heading">
      <div>
        <p className="eyebrow">{t("proofMaps.browser.eyebrow")}</p>
        <h2 id="proof-map-browser-title">{t("proofMaps.browser.title")}</h2>
      </div>
      <span>{t("proofMaps.browser.summary", { deep: summary.deep, draft: summary.draft, scaffold: summary.scaffold })}</span>
    </div>

    <div className="proof-map-filters">
      <label className="proof-map-search">{t("proofMaps.browser.search")}
        <input type="search" value={search} onChange={(event) => updateSearch(event.target.value)} placeholder={t("proofMaps.browser.searchPlaceholder")} maxLength={240} />
      </label>
      <label>{t("proofMaps.browser.subject")}
        <select value={subject} onChange={(event) => updateSubject(event.target.value)}>
          <option value="">{t("proofMaps.browser.allSubjects", { count: subjects.length })}</option>
          {subjects.map((entry) => <option key={entry.name} value={entry.name}>{entry.name} ({entry.families})</option>)}
        </select>
      </label>
      <label>{t("proofMaps.browser.structure")}
        <select value={status} onChange={(event) => updateStatus(event.target.value as "all" | ProofMapStatus)}>
          <option value="all">{t("proofMaps.browser.allStatuses")}</option>
          <option value="deep">{t("proofMaps.browser.statusDeep", { count: summary.deep })}</option>
          <option value="draft">{t("proofMaps.browser.statusDraft", { count: summary.draft })}</option>
          <option value="paper">{t("proofMaps.browser.statusPaper", { count: summary.paper })}</option>
          <option value="lean">{t("proofMaps.browser.statusLean", { count: summary.lean })}</option>
          <option value="scaffold">{t("proofMaps.browser.statusScaffold", { count: summary.scaffold })}</option>
        </select>
      </label>
      <label>{t("proofMaps.browser.leanStructure")}
        <select value={leanStatus} onChange={(event) => updateLeanStatus(event.target.value as "all" | "extracted" | "none")}>
          <option value="all">{t("proofMaps.browser.allLeanCoverage")}</option>
          <option value="extracted">{t("proofMaps.browser.leanExtracted")}</option>
          <option value="none">{t("proofMaps.browser.leanNone")}</option>
        </select>
      </label>
      {activeFilters && <button type="button" className="proof-map-reset" onClick={reset}>{t("proofMaps.browser.clearFilters")}</button>}
    </div>

    <div className="proof-map-results-heading">
      <p><strong>{filtered.length}</strong> {filtered.length === 1 ? t("proofMaps.browser.resultOne", { count: filtered.length }) : t("proofMaps.browser.resultOther", { count: filtered.length })}{activeFilters ? t("proofMaps.browser.matchFilters") : t("proofMaps.browser.inRelease")}</p>
      <span>{t("proofMaps.browser.pageOf", { page: safePage, total: pageCount })}</span>
    </div>

    {visible.length > 0 ? <div className="proof-map-grid">
      {visible.map((entry) => <article className={cx("proof-map-card", `status-${entry.status}`)} key={entry.familyNumber}>
        <div className="proof-map-card-top">
          <span className="proof-map-family-number">{entry.familyNumber}</span>
          <span className="proof-map-subject">{entry.subject}</span>
          <Badge tone={statusTone(entry.status)}>{t(statusKeys[entry.status])}</Badge>
        </div>
        <h3><Link href={entry.route}>{entry.title}</Link></h3>
        <p className="proof-map-claim">{entry.claimSnippet}</p>
        <div className="proof-map-card-meta">
          <span>{entry.manuscriptCount === 1 ? t("proofMaps.browser.manuscriptOne", { count: entry.manuscriptCount }) : t("proofMaps.browser.manuscriptOther", { count: entry.manuscriptCount })}</span>
          <span>{entry.scopeDocument ? t("proofMaps.browser.scopeDocumented") : t("proofMaps.browser.scopeMissing")}</span>
          <span>{entry.lean.status === "none" ? t("proofMaps.browser.leanNoneStructure") : t("proofMaps.browser.leanModules", { solutions: entry.lean.solutions, comparators: entry.lean.comparators })}</span>
          {entry.formalizedManuscripts > 0 && <span>{t("proofMaps.browser.upstreamLinked", { count: entry.formalizedManuscripts })}</span>}
          <span className="proof-map-replay">{t("proofMaps.browser.replayNotRun")}</span>
        </div>
        <div className="proof-map-card-footer">
          <Link href={entry.route}>{t("proofMaps.browser.openMap")} <span aria-hidden="true">→</span></Link>
          <Link href={entry.publicationRoute}>{t("proofMaps.browser.publicationRecord")}</Link>
        </div>
        {entry.status !== "scaffold" && entry.manifestLabel && <small className="proof-map-manifest-label">{entry.manifestLabel}</small>}
      </article>)}
    </div> : <div className="proof-map-empty">
      <strong>{t("proofMaps.browser.emptyTitle")}</strong>
      <p>{t("proofMaps.browser.emptyBody")}</p>
      <button type="button" onClick={reset}>{t("proofMaps.browser.clearFilters")}</button>
    </div>}

    {pageCount > 1 && <nav className="proof-map-pagination" aria-label={t("proofMaps.browser.paginationAria")}>
      <button type="button" disabled={safePage === 1} onClick={() => setPage(Math.max(1, safePage - 1))}>{t("proofMaps.browser.previous")}</button>
      <span>{t("proofMaps.browser.pageOf", { page: safePage, total: pageCount })}</span>
      <button type="button" disabled={safePage === pageCount} onClick={() => setPage(Math.min(pageCount, safePage + 1))}>{t("proofMaps.browser.next")}</button>
    </nav>}
  </section>;
}
