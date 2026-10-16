"use client";

import { SectionTitle, Button, EmptyState, Input, SectionHeading, Select } from "@/app/components/ui";

import { ResearchCard, opportunityKind, scopeKind } from "@/app/components/research/ResearchCard";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { type CatalogProblemSummary } from "@/packages/domain/catalog";

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

const pageSize = 10;

type OpportunityFilter = (typeof opportunityFilters)[number]["id"];
type ScopeFilter = (typeof scopeFilters)[number]["id"];
type CatalogSort = "recommended" | "title" | "subject";

export type ExploreCatalogProblem = CatalogProblemSummary;

export function ExploreCatalog({ projects }: { projects: readonly ExploreCatalogProblem[] }) {
  const searchParams = useSearchParams();
  const requestedOpportunity = searchParams.get("kind");
  const requestedScope = searchParams.get("scope");
  const requestedSort = searchParams.get("sort");
  const initialOpportunityFilter: OpportunityFilter = isOpportunityFilter(requestedOpportunity) ? requestedOpportunity : "all";
  const initialScopeFilter: ScopeFilter = isScopeFilter(requestedScope) ? requestedScope : "all";
  const initialSort: CatalogSort = isCatalogSort(requestedSort) ? requestedSort : "recommended";
  const [opportunityFilter, setOpportunityFilter] = useState<OpportunityFilter>(initialOpportunityFilter);
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>(initialScopeFilter);
  const [subjectFilter, setSubjectFilter] = useState(searchParams.get("subject") ?? "all");
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [sort, setSort] = useState<CatalogSort>(initialSort);
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (opportunityFilter !== "all") params.set("kind", opportunityFilter);
    if (scopeFilter !== "all") params.set("scope", scopeFilter);
    if (subjectFilter !== "all") params.set("subject", subjectFilter);
    if (sort !== "recommended") params.set("sort", sort);
    const nextSearch = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`);
  }, [query, opportunityFilter, scopeFilter, subjectFilter, sort]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || target?.matches("input, textarea, select, [contenteditable=\"true\"]")) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const subjects = useMemo(() => {
    const unique = new Map<string, ExploreCatalogProblem["subjects"][number]>();
    for (const project of projects) {
      for (const subject of project.subjects) unique.set(subject.slug, subject);
    }
    return [...unique.values()].sort((a, b) => a.amsCode.localeCompare(b.amsCode));
  }, [projects]);

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const matches = projects.filter((project) => {
      if (opportunityFilter !== "all" && opportunityKind(project) !== opportunityFilter) return false;
      if (scopeFilter !== "all" && scopeKind(project) !== scopeFilter) return false;
      if (subjectFilter !== "all" && !project.subjects.some((subject) => subject.slug === subjectFilter)) return false;
      if (!normalizedQuery) return true;
      return [
        project.title,
        project.projectTitle,
        project.informalStatement,
        project.declaration.qualifiedName,
        project.source.upstreamName,
        ...project.subjects.flatMap((subject) => [subject.name, subject.amsCode]),
      ].join(" ").toLocaleLowerCase().includes(normalizedQuery);
    });

    if (sort === "title") matches.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === "subject") matches.sort((a, b) => (a.subjects[0]?.amsCode ?? "999").localeCompare(b.subjects[0]?.amsCode ?? "999") || a.title.localeCompare(b.title));
    return matches;
  }, [projects, opportunityFilter, scopeFilter, subjectFilter, query, sort]);

  const displayedProjects = filteredProjects.slice(0, visibleCount);
  const remainingCount = Math.max(0, filteredProjects.length - displayedProjects.length);
  const activeFilterCount = Number(opportunityFilter !== "all") + Number(scopeFilter !== "all") + Number(subjectFilter !== "all");
  const openCount = projects.filter((project) => opportunityKind(project) === "advance").length;
  const boundedCount = projects.filter((project) => scopeKind(project) === "bounded").length;
  const verifiedCount = projects.filter((project) => opportunityKind(project) === "verified").length;

  function resetResults() {
    setOpportunityFilter("all");
    setScopeFilter("all");
    setSubjectFilter("all");
    setQuery("");
    setSort("recommended");
    setVisibleCount(pageSize);
  }

  function updateFilter<T>(setter: (value: T) => void, value: T) {
    setter(value);
    setVisibleCount(pageSize);
  }

  return <section className="research-index" id="research-catalog" aria-labelledby="research-index-title">
    <SectionHeading as="div" className="research-index-heading">
      <div><p className="eyebrow">Searchable research index</p><SectionTitle id="research-index-title">Find the exact target you can act on.</SectionTitle></div>
      <p>Use the controls to narrow by contribution type, scope, subject, or declaration. Every result links to its pinned source and the next available action.</p>
    </SectionHeading>

    <div className="research-index-toolbar" aria-label="Research index controls">
      <label className="research-index-search">
        <span>Search title, subject, source, or Lean declaration</span>
        <Input ref={searchInputRef} aria-keyshortcuts="/" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(pageSize); }} placeholder="Try “Erdos”, “topology”, or a declaration name" type="search" />
      </label>
      <label className="research-index-sort"><span>Sort</span><Select value={sort} onChange={(event) => updateFilter(setSort, event.target.value as CatalogSort)}><option value="recommended">Recommended</option><option value="title">Title A–Z</option><option value="subject">MSC subject</option></Select></label>
      <Button className="button button-secondary research-index-clear" onClick={resetResults} type="button" disabled={!query && activeFilterCount === 0 && sort === "recommended"}>Reset</Button>
    </div>

    <div className="research-index-summary" aria-label="Research index summary">
      <div><span>Total targets</span><strong>{projects.length}</strong><small>pinned public records</small></div>
      <div><span>Bounded work</span><strong>{boundedCount}</strong><small>clear starting points</small></div>
      <div><span>Open branches</span><strong>{openCount}</strong><small>cumulative research</small></div>
      <div><span>Verified proofs</span><strong>{verifiedCount}</strong><small>inspectable evidence</small></div>
    </div>

    <div className="research-index-layout">
      <aside className="research-index-filters" aria-label="Filter research targets">
        <div className="research-filter-heading"><span>Filters</span><strong>{filteredProjects.length} matches</strong></div>
        <fieldset><legend>Contribution</legend>{opportunityFilters.map((item) => <Button aria-pressed={opportunityFilter === item.id} className={opportunityFilter === item.id ? "is-active" : ""} key={item.id} onClick={() => updateFilter(setOpportunityFilter, item.id)} type="button">{item.label}<span>{item.id === "all" ? projects.length : projects.filter((project) => opportunityKind(project) === item.id).length}</span></Button>)}</fieldset>
        <fieldset><legend>Scope</legend>{scopeFilters.map((item) => <Button aria-pressed={scopeFilter === item.id} className={scopeFilter === item.id ? "is-active" : ""} key={item.id} onClick={() => updateFilter(setScopeFilter, item.id)} type="button">{item.label}</Button>)}</fieldset>
        <label className="research-subject-select"><span>MSC subject</span><Select value={subjectFilter} onChange={(event) => updateFilter(setSubjectFilter, event.target.value)}><option value="all">All subjects</option>{subjects.map((subject) => <option value={subject.slug} key={subject.slug}>MSC {subject.amsCode} · {subject.name}</option>)}</Select></label>
        <div className="research-filter-note"><strong>Record boundary</strong><p>Catalog status describes only the public record. It does not imply that an Agent has started work or that a proof is complete.</p></div>
      </aside>

      <div className="research-index-results">
        <div className="research-results-meta" aria-live="polite"><span>{filteredProjects.length} matching targets · showing {displayedProjects.length}</span>{(query || activeFilterCount > 0) && <Button onClick={resetResults} type="button">Clear filters</Button>}</div>
        {displayedProjects.length === 0 && <EmptyState as="div" className="catalog-empty"><strong>No targets match the current query.</strong><p>Clear one filter or try a broader title, subject, or declaration.</p><Button className="button button-secondary" onClick={resetResults} type="button">Reset search</Button></EmptyState>}
        <div className="research-result-list">{displayedProjects.map((project) => <ResearchCard project={project} key={project.slug} />)}</div>
        {remainingCount > 0 && <div className="research-results-more"><p>Showing {displayedProjects.length} of {filteredProjects.length} matching targets.</p><Button className="button button-secondary" onClick={() => setVisibleCount((count) => count + pageSize)} type="button">Load {Math.min(pageSize, remainingCount)} more</Button></div>}
      </div>
    </div>
  </section>;
}

function isOpportunityFilter(value: string | null): value is OpportunityFilter {
  return opportunityFilters.some((item) => item.id === value);
}

function isScopeFilter(value: string | null): value is ScopeFilter {
  return scopeFilters.some((item) => item.id === value);
}

function isCatalogSort(value: string | null): value is CatalogSort {
  return value === "recommended" || value === "title" || value === "subject";
}
