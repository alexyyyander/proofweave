"use client";

import { SectionTitle, Button, EmptyState, Input, SectionHeading, Select } from "@/app/components/ui";

import { ResearchCard } from "@/app/components/research/ResearchCard";
import { researchCardCopy } from "@/app/lib/research-card-copy";
import { useI18n } from "@/app/i18n/client";
import type { TranslationKey } from "@/app/i18n/translate";
import { useCallback, useEffect, useRef, useState } from "react";
import { type CatalogProblemSummary } from "@/packages/domain/catalog";
import { catalogQueryParams, type CatalogMetadata, type CatalogPage, type CatalogQuery,
  type CatalogSort } from "@/packages/domain/catalog-browser";

const opportunityFilters: readonly { id: "all" | "formalize" | "advance" | "verified"; labelKey: TranslationKey }[] = [
  { id: "all", labelKey: "explore.filter.allWork" },
  { id: "formalize", labelKey: "explore.filter.formalize" },
  { id: "advance", labelKey: "explore.filter.advance" },
  { id: "verified", labelKey: "explore.filter.verified" },
];

const scopeFilters: readonly { id: "all" | "bounded" | "long-horizon"; labelKey: TranslationKey }[] = [
  { id: "all", labelKey: "explore.filter.allScopes" },
  { id: "bounded", labelKey: "explore.filter.bounded" },
  { id: "long-horizon", labelKey: "explore.filter.longHorizon" },
];

export type ExploreCatalogProblem = CatalogProblemSummary;

type PageRequest = { criteria: CatalogQuery; cursor: string | null; previous: (string | null)[] };

export function ExploreCatalog({ initialPage, metadata, initialQuery }: {
  initialPage: CatalogPage; metadata: CatalogMetadata; initialQuery: CatalogQuery;
}) {
  const { t } = useI18n();
  const cardCopy = researchCardCopy(t);
  const [criteria, setCriteria] = useState(initialQuery);
  const { opportunity: opportunityFilter, scope: scopeFilter, subject: subjectFilter, q: query, sort } = criteria;
  const [page, setPage] = useState(initialPage);
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<(string | null)[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const requestNumber = useRef(0);
  const firstRender = useRef(true);
  const previousSearch = useRef(initialQuery.q);
  const failedRequest = useRef<PageRequest>({ criteria: initialQuery, cursor: null, previous: [] });

  const requestPage = useCallback(async (request: PageRequest) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const number = ++requestNumber.current;
    failedRequest.current = request;
    setPending(true);
    setError(false);
    try {
      const params = catalogQueryParams(request.criteria);
      if (request.cursor) params.set("cursor", request.cursor);
      const response = await fetch(`/api/catalog/browse?${params}`, { signal: abort.signal });
      if (!response.ok) throw new Error("Catalog request failed");
      const result = await response.json() as CatalogPage;
      if (number !== requestNumber.current || abort.signal.aborted) return;
      setPage(result);
      setPageCursor(request.cursor);
      setPrevious(request.previous);
    } catch {
      if (number === requestNumber.current && !abort.signal.aborted) setError(true);
    } finally {
      if (number === requestNumber.current && !abort.signal.aborted) setPending(false);
    }
  }, []);

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    // Cancel immediately when controls change, including during the debounce,
    // so a response for an older query can never replace the current results.
    controller.current?.abort();
    ++requestNumber.current;
    setPending(true);
    setError(false);
    const delay = previousSearch.current === criteria.q ? 0 : 300;
    previousSearch.current = criteria.q;
    const timer = window.setTimeout(() => {
      const params = catalogQueryParams(criteria).toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${params ? `?${params}` : ""}${window.location.hash}`);
      void requestPage({ criteria, cursor: null, previous: [] });
    }, delay);
    return () => {
      window.clearTimeout(timer);
      controller.current?.abort();
    };
  }, [criteria, requestPage]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || target?.matches("input, textarea, select, [contenteditable=\"true\"]")) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", focusSearch);
    return () => {
      window.removeEventListener("keydown", focusSearch);
      controller.current?.abort();
    };
  }, []);

  const subjects = metadata.subjects;
  const activeFilterCount = Number(opportunityFilter !== "all") + Number(scopeFilter !== "all") + Number(subjectFilter !== "all");

  function resetResults() {
    setCriteria({ q: "", opportunity: "all", scope: "all", subject: "all", sort: "recommended" });
  }

  function updateFilter<K extends keyof CatalogQuery>(key: K, value: CatalogQuery[K]) {
    setCriteria((current) => ({ ...current, [key]: value }));
  }

  return <section className="research-index" id="research-catalog" aria-labelledby="research-index-title">
    <SectionHeading as="div" className="research-index-heading">
      <div><p className="eyebrow">{t("explore.index.eyebrow")}</p><SectionTitle id="research-index-title">{t("explore.index.title")}</SectionTitle></div>
      <p>{t("explore.index.body")}</p>
    </SectionHeading>

    <div className="research-index-toolbar" aria-label={t("explore.controlsAria")}>
      <label className="research-index-search">
        <span>{t("explore.search.label")}</span>
        <Input ref={searchInputRef} aria-keyshortcuts="/" value={query} onChange={(event) => updateFilter("q", event.target.value)} maxLength={200} placeholder={t("explore.search.placeholder")} type="search" />
        <small>{t("explore.search.hint")}</small>
      </label>
      <label className="research-index-sort"><span>{t("explore.sort.label")}</span><Select value={sort} onChange={(event) => updateFilter("sort", event.target.value as CatalogSort)}><option value="recommended">{t("explore.sort.recommended")}</option><option value="title">{t("explore.sort.title")}</option><option value="subject">{t("explore.sort.subject")}</option></Select></label>
      <Button className="button button-secondary research-index-clear" onClick={resetResults} type="button" disabled={!query && activeFilterCount === 0 && sort === "recommended"}>{t("explore.reset")}</Button>
    </div>

    <div className="research-index-summary" aria-label={t("explore.summaryAria")}>
      <div><span>{t("explore.summary.total")}</span><strong>{metadata.total}</strong><small>{t("explore.summary.totalNote")}</small></div>
      <div><span>{t("explore.summary.bounded")}</span><strong>{metadata.bounded}</strong><small>{t("explore.summary.boundedNote")}</small></div>
      <div><span>{t("explore.summary.open")}</span><strong>{metadata.opportunities.advance}</strong><small>{t("explore.summary.openNote")}</small></div>
      <div><span>{t("explore.summary.verified")}</span><strong>{metadata.opportunities.verified}</strong><small>{t("explore.summary.verifiedNote")}</small></div>
    </div>

    <div className="research-index-layout">
      <aside className="research-index-filters" aria-label={t("explore.filtersAria")}>
        <div className="research-filter-heading"><span>{t("explore.filters.title")}</span><strong>{pending ? t("explore.filters.updating") : t("explore.filters.page", { page: previous.length + 1 })}</strong></div>
        <fieldset><legend>{t("explore.filters.contribution")}</legend>{opportunityFilters.map((item) => <Button aria-pressed={opportunityFilter === item.id} className={opportunityFilter === item.id ? "is-active" : ""} key={item.id} onClick={() => updateFilter("opportunity", item.id)} type="button">{t(item.labelKey)}<span>{item.id === "all" ? metadata.total : metadata.opportunities[item.id]}</span></Button>)}</fieldset>
        <fieldset><legend>{t("explore.filters.scope")}</legend>{scopeFilters.map((item) => <Button aria-pressed={scopeFilter === item.id} className={scopeFilter === item.id ? "is-active" : ""} key={item.id} onClick={() => updateFilter("scope", item.id)} type="button">{t(item.labelKey)}</Button>)}</fieldset>
        <label className="research-subject-select"><span>{t("explore.filters.subject")}</span><Select value={subjectFilter} onChange={(event) => updateFilter("subject", event.target.value)}><option value="all">{t("explore.filter.allSubjects")}</option>{subjects.map((subject) => <option value={subject.slug} key={subject.slug}>MSC {subject.amsCode} · {subject.name}</option>)}</Select></label>
        <div className="research-filter-note"><strong>{t("explore.boundary.title")}</strong><p>{t("explore.boundary.body")}</p></div>
      </aside>

      <div className="research-index-results" aria-busy={pending}>
        <div className="research-results-meta" aria-live="polite"><span>{pending ? t("explore.results.updating") : error ? t("explore.results.unavailable") : t("explore.results.page", { page: previous.length + 1, count: page.records.length })}</span>{(query || activeFilterCount > 0) && <Button onClick={resetResults} type="button">{t("explore.results.clear")}</Button>}</div>
        {error && <EmptyState as="div" className="catalog-empty"><strong>{t("explore.error.title")}</strong><p>{t("explore.error.body")}</p><Button className="button button-secondary" disabled={pending} onClick={() => void requestPage(failedRequest.current)} type="button">{t("explore.error.retry")}</Button><Button onClick={resetResults} type="button">{t("explore.error.restart")}</Button></EmptyState>}
        {!error && !pending && page.records.length === 0 && <EmptyState as="div" className="catalog-empty"><strong>{t("explore.empty.title")}</strong><p>{t("explore.empty.body")}</p><Button className="button button-secondary" onClick={resetResults} type="button">{t("explore.empty.reset")}</Button></EmptyState>}
        {!error && <div className="research-result-list">{page.records.map((project) => <ResearchCard project={project} copy={cardCopy} key={project.slug} />)}</div>}
        <nav className="research-results-more" aria-label={t("explore.paginationAria")}>
          <Button className="button button-secondary" disabled={pending || error || previous.length === 0} onClick={() => void requestPage({ criteria, cursor: previous[previous.length - 1], previous: previous.slice(0, -1) })} type="button">{t("explore.pagination.previous")}</Button>
          <Button className="button button-secondary" disabled={pending || error || !page.nextCursor} onClick={() => void requestPage({ criteria, cursor: page.nextCursor, previous: [...previous, pageCursor] })} type="button">{t("explore.pagination.next")}</Button>
        </nav>
      </div>
    </div>
  </section>;
}
