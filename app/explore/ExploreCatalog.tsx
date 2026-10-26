"use client";

import { SectionTitle, Button, EmptyState, Input, SectionHeading, Select } from "@/app/components/ui";

import { ResearchCard } from "@/app/components/research/ResearchCard";
import { useCallback, useEffect, useRef, useState } from "react";
import { type CatalogProblemSummary } from "@/packages/domain/catalog";
import { catalogQueryParams, type CatalogMetadata, type CatalogPage, type CatalogQuery,
  type CatalogSort } from "@/packages/domain/catalog-browser";

const opportunityFilters = [
  { id: "all", label: "All work" },
  { id: "formalize", label: "Formalize known results" },
  { id: "advance", label: "Advance open branches" },
  { id: "verified", label: "Inspect verified proofs" },
] as const;

const scopeFilters = [
  { id: "all", label: "All scopes" },
  { id: "bounded", label: "Bounded milestones" },
  { id: "long-horizon", label: "Long-horizon programs" },
] as const;

export type ExploreCatalogProblem = CatalogProblemSummary;

type PageRequest = { criteria: CatalogQuery; cursor: string | null; previous: (string | null)[] };

export function ExploreCatalog({ initialPage, metadata, initialQuery }: {
  initialPage: CatalogPage; metadata: CatalogMetadata; initialQuery: CatalogQuery;
}) {
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
      <div><p className="eyebrow">Searchable research index</p><SectionTitle id="research-index-title">Find the exact target you can act on.</SectionTitle></div>
      <p>Use the controls to narrow by contribution type, scope, subject, or declaration. Every result links to its pinned source and the next available action.</p>
    </SectionHeading>

    <div className="research-index-toolbar" aria-label="Research index controls">
      <label className="research-index-search">
        <span>Search title, subject, source, or Lean declaration</span>
        <Input ref={searchInputRef} aria-keyshortcuts="/" value={query} onChange={(event) => updateFilter("q", event.target.value)} maxLength={200} placeholder="Try “Erdos”, “topology”, or a declaration name" type="search" />
        <small>Search words or the beginning of a name. Add words to narrow the results.</small>
      </label>
      <label className="research-index-sort"><span>Sort</span><Select value={sort} onChange={(event) => updateFilter("sort", event.target.value as CatalogSort)}><option value="recommended">Recommended</option><option value="title">Title A–Z</option><option value="subject">MSC subject</option></Select></label>
      <Button className="button button-secondary research-index-clear" onClick={resetResults} type="button" disabled={!query && activeFilterCount === 0 && sort === "recommended"}>Reset</Button>
    </div>

    <div className="research-index-summary" aria-label="Research index summary">
      <div><span>Total targets</span><strong>{metadata.total}</strong><small>pinned public records</small></div>
      <div><span>Bounded work</span><strong>{metadata.bounded}</strong><small>clear starting points</small></div>
      <div><span>Open branches</span><strong>{metadata.opportunities.advance}</strong><small>cumulative research</small></div>
      <div><span>Verified proofs</span><strong>{metadata.opportunities.verified}</strong><small>inspectable evidence</small></div>
    </div>

    <div className="research-index-layout">
      <aside className="research-index-filters" aria-label="Filter research targets">
        <div className="research-filter-heading"><span>Filters</span><strong>{pending ? "Updating…" : `Page ${previous.length + 1}`}</strong></div>
        <fieldset><legend>Contribution</legend>{opportunityFilters.map((item) => <Button aria-pressed={opportunityFilter === item.id} className={opportunityFilter === item.id ? "is-active" : ""} key={item.id} onClick={() => updateFilter("opportunity", item.id)} type="button">{item.label}<span>{item.id === "all" ? metadata.total : metadata.opportunities[item.id]}</span></Button>)}</fieldset>
        <fieldset><legend>Scope</legend>{scopeFilters.map((item) => <Button aria-pressed={scopeFilter === item.id} className={scopeFilter === item.id ? "is-active" : ""} key={item.id} onClick={() => updateFilter("scope", item.id)} type="button">{item.label}</Button>)}</fieldset>
        <label className="research-subject-select"><span>MSC subject</span><Select value={subjectFilter} onChange={(event) => updateFilter("subject", event.target.value)}><option value="all">All subjects</option>{subjects.map((subject) => <option value={subject.slug} key={subject.slug}>MSC {subject.amsCode} · {subject.name}</option>)}</Select></label>
        <div className="research-filter-note"><strong>Record boundary</strong><p>Catalog status describes only the public record. It does not imply that an Agent has started work or that a proof is complete.</p></div>
      </aside>

      <div className="research-index-results" aria-busy={pending}>
        <div className="research-results-meta" aria-live="polite"><span>{pending ? "Updating results…" : error ? "Results unavailable" : `Page ${previous.length + 1} · ${page.records.length} targets`}</span>{(query || activeFilterCount > 0) && <Button onClick={resetResults} type="button">Clear filters</Button>}</div>
        {error && <EmptyState as="div" className="catalog-empty"><strong>Unable to load the research catalog.</strong><p>Please try again.</p><Button className="button button-secondary" disabled={pending} onClick={() => void requestPage(failedRequest.current)} type="button">Retry</Button><Button onClick={resetResults} type="button">Restart search</Button></EmptyState>}
        {!error && !pending && page.records.length === 0 && <EmptyState as="div" className="catalog-empty"><strong>No targets match the current query.</strong><p>Clear one filter or try a broader title, subject, or declaration.</p><Button className="button button-secondary" onClick={resetResults} type="button">Reset search</Button></EmptyState>}
        {!error && <div className="research-result-list">{page.records.map((project) => <ResearchCard project={project} key={project.slug} />)}</div>}
        <nav className="research-results-more" aria-label="Research results pages">
          <Button className="button button-secondary" disabled={pending || error || previous.length === 0} onClick={() => void requestPage({ criteria, cursor: previous[previous.length - 1], previous: previous.slice(0, -1) })} type="button">Previous page</Button>
          <Button className="button button-secondary" disabled={pending || error || !page.nextCursor} onClick={() => void requestPage({ criteria, cursor: page.nextCursor, previous: [...previous, pageCursor] })} type="button">Next page</Button>
        </nav>
      </div>
    </div>
  </section>;
}
