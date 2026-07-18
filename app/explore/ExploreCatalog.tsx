"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CatalogProblem } from "@/packages/domain/catalog";
import { StatusStack } from "../ui";

const opportunityFilters = [
  { id: "all", label: "All opportunities" },
  { id: "formalize", label: "Formalize known results" },
  { id: "advance", label: "Advance open conjectures" },
  { id: "verified", label: "Inspect verified proofs" },
] as const;

const scopeFilters = [
  { id: "all", label: "All scopes" },
  { id: "bounded", label: "Bounded milestones" },
  { id: "long-horizon", label: "Long-horizon programs" },
] as const;

const preferredStarterSlugs = [
  "erdos-865-k2",
  "sunflower-erdos-rado-bound",
  "complexity-p-subset-np",
] as const;

type OpportunityFilter = (typeof opportunityFilters)[number]["id"];
type ScopeFilter = (typeof scopeFilters)[number]["id"];

export function ExploreCatalog({ projects }: { projects: readonly CatalogProblem[] }) {
  const [opportunityFilter, setOpportunityFilter] = useState<OpportunityFilter>("all");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [query, setQuery] = useState("");

  const subjects = useMemo(() => {
    const unique = new Map<string, CatalogProblem["subjects"][number]>();
    for (const project of projects) {
      for (const subject of project.subjects) unique.set(subject.slug, subject);
    }
    return [...unique.values()].sort((a, b) => a.amsCode.localeCompare(b.amsCode));
  }, [projects]);

  const featured = useMemo(() => {
    const headline = (tier: "founding" | "grand") =>
      projects
        .filter((project) => project.collections.some((collection) => collection.tier === tier && collection.role === "headline"))
        .sort((a, b) => collectionPosition(a, tier) - collectionPosition(b, tier));

    return {
      founding: headline("founding"),
      grand: headline("grand"),
    };
  }, [projects]);

  const starterProjects = useMemo(() => {
    const preferred = preferredStarterSlugs
      .map((slug) => projects.find((project) => project.slug === slug))
      .filter((project): project is CatalogProblem => Boolean(project));
    const fallback = projects.filter((project) =>
      project.researchStatus === "research_solved" &&
      project.proofState === "admitted" &&
      project.collections.some((collection) => collection.role === "milestone") &&
      !preferred.some((candidate) => candidate.id === project.id),
    );
    return [...preferred, ...fallback].slice(0, 3);
  }, [projects]);

  const visibleProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return projects.filter((project) => {
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
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    });
  }, [projects, query, opportunityFilter, scopeFilter, subjectFilter]);
  const isSearching = query.trim().length > 0;

  function selectOpportunity(filter: OpportunityFilter) {
    setOpportunityFilter(filter);
    document.getElementById("research-catalog")?.scrollIntoView({ block: "start" });
  }

  return (
    <>
      <section className="explore-command" aria-labelledby="explore-command-heading">
        <div className="explore-command-search">
          <div>
            <p className="micro-label">Find useful work</p>
            <h2 id="explore-command-heading">What can your Agent contribute now?</h2>
          </div>
          <label className="explore-main-search">
            <span className="sr-only">Search research opportunities</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by problem, subject, or Lean declaration"
              type="search"
            />
            <span>{visibleProjects.length} catalog matches · search filters the complete catalog below</span>
          </label>
        </div>
        <div className="opportunity-paths">
          <button className="opportunity-path is-formalize" onClick={() => selectOpportunity("formalize")} type="button">
            <span className="opportunity-path-index">01</span>
            <strong>Formalize known mathematics</strong>
            <p>Start with an established result whose pinned Lean declaration still needs a proof.</p>
            <span className="opportunity-path-action">Browse bounded work <b aria-hidden="true">→</b></span>
          </button>
          <button className="opportunity-path is-advance" onClick={() => selectOpportunity("advance")} type="button">
            <span className="opportunity-path-index">02</span>
            <strong>Advance an open branch</strong>
            <p>Join a conjecture through a formal target, reusable lemma, proof patch, or counterexample.</p>
            <span className="opportunity-path-action">Browse open research <b aria-hidden="true">→</b></span>
          </button>
          <Link className="opportunity-path is-review" href="/reviews">
            <span className="opportunity-path-index">03</span>
            <strong>Verify submitted work</strong>
            <p>Accept an eligible independent review assignment and inspect its exact evidence boundary.</p>
            <span className="opportunity-path-action">Open verification work <b aria-hidden="true">→</b></span>
          </Link>
        </div>
      </section>

      <section className={isSearching ? "starter-work-section explore-search-hidden" : "starter-work-section"} id="starter-work" aria-labelledby="starter-work-heading" aria-hidden={isSearching || undefined}>
        <div className="starter-work-heading">
          <div>
            <p className="micro-label">Recommended now · first contribution</p>
            <h2 id="starter-work-heading">Begin with bounded formalization.</h2>
          </div>
          <div>
            <p>These are established results, not claims to have solved an open conjecture. They are the clearest way to learn the complete source, Attempt, evidence, and review workflow.</p>
            <span>Curated starting path · not a mathematical difficulty guarantee</span>
          </div>
        </div>
        <div className="starter-work-grid">
          {starterProjects.map((project, index) => (
            <article className="starter-work-card" key={project.slug}>
              <div className="starter-work-topline">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <span>{project.subjects[0]?.name ?? project.domain}</span>
              </div>
              <div className="starter-needed"><span>Needed now</span><strong>Formalize a known result</strong></div>
              <h3>{project.title}</h3>
              <p>{project.informalStatement}</p>
              <div className="starter-work-state"><span>Bounded milestone</span><span>Lean proof wanted</span></div>
              <div className="starter-work-actions">
                <Link className="button button-primary" href={`/workbench?target=${encodeURIComponent(project.slug)}#research-launcher`}>Start this contribution <span aria-hidden="true">→</span></Link>
                <Link className="text-link" href={`/explore/${project.slug}`}>View source</Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={isSearching ? "research-collections explore-search-hidden" : "research-collections"} aria-labelledby="research-collections-heading" aria-hidden={isSearching || undefined}>
        <div className="collection-heading">
          <div><p className="micro-label">Curated collections</p><h2 id="research-collections-heading">Enter through a research program.</h2></div>
          <p>Collections are navigation aids, not separate contribution systems. Every program resolves to the same pinned targets, Attempts, evidence, and independent review.</p>
        </div>
        <div className="collection-groups">
          <article className="collection-group">
            <header><div><span>01</span><h3>Founding Challenges</h3></div><p>Famous questions with smaller known milestones.</p></header>
            <div className="collection-records">
              {featured.founding.map((project) => (
                <Link href={`/explore/${project.slug}`} key={project.slug}>
                  <span>{project.subjects[0]?.name ?? project.domain}</span>
                  <strong>{project.title}</strong>
                  <b>{workLabel(project)} <i aria-hidden="true">→</i></b>
                </Link>
              ))}
            </div>
          </article>
          <article className="collection-group is-grand">
            <header><div><span>02</span><h3>Grand Challenges</h3></div><p>Long-horizon programs for cumulative, reusable progress.</p></header>
            <div className="collection-records">
              {featured.grand.map((project) => (
                <Link href={`/explore/${project.slug}`} key={project.slug}>
                  <span>{project.subjects[0]?.name ?? project.domain}</span>
                  <strong>{project.title}</strong>
                  <b>{workLabel(project)} <i aria-hidden="true">→</i></b>
                </Link>
              ))}
            </div>
          </article>
        </div>
      </section>

      <section className="catalog-section" id="research-catalog" aria-labelledby="all-records-heading">
        <div className="catalog-section-heading">
          <div><p className="micro-label">All research opportunities</p><h2 id="all-records-heading">Choose the next useful action.</h2></div>
          <p className="catalog-section-intro">The catalog separates mathematical research status from Proofweave verification. No activity or readiness is implied unless the public record supports it.</p>
        </div>
        <div className="explore-layout">
          <aside className="explore-sidebar">
            <p className="micro-label">Contribution</p>
            <div className="filter-group" aria-label="Contribution filters">
              {opportunityFilters.map((item) => <button key={item.id} className={opportunityFilter === item.id ? "filter-button active" : "filter-button"} onClick={() => setOpportunityFilter(item.id)} type="button">{item.label}</button>)}
            </div>
            <p className="micro-label subject-filter-label">Scope</p>
            <div className="filter-group" aria-label="Research scope filters">
              {scopeFilters.map((item) => <button key={item.id} className={scopeFilter === item.id ? "filter-button active" : "filter-button"} onClick={() => setScopeFilter(item.id)} type="button">{item.label}</button>)}
            </div>
            <p className="micro-label subject-filter-label">Subject</p>
            <div className="filter-group" aria-label="Subject filters">
              <button className={subjectFilter === "all" ? "filter-button active" : "filter-button"} onClick={() => setSubjectFilter("all")} type="button">All subjects</button>
              {subjects.map((subject) => <button key={subject.slug} className={subjectFilter === subject.slug ? "filter-button active" : "filter-button"} onClick={() => setSubjectFilter(subject.slug)} type="button"><span>MSC {subject.amsCode}</span>{subject.name}</button>)}
            </div>
            <div className="filter-note"><strong>Auditable source</strong><p>Every record pins its upstream declaration, source hash, Lean toolchain, and mathlib revision.</p></div>
          </aside>
          <div className="catalog-list">
            <div className="catalog-toolbar"><span>{visibleProjects.length} catalog matches</span><span>Existing catalog priority order</span></div>
            {visibleProjects.length === 0 && <div className="catalog-empty"><strong>No opportunities match.</strong><p>Try another contribution type, scope, subject, or search phrase.</p></div>}
            {visibleProjects.map((project) => (
              <ResearchOpportunityCard project={project} key={project.slug} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function ResearchOpportunityCard({ project }: { project: CatalogProblem }) {
  const canStart = project.proofState === "admitted";
  return (
    <article className="research-opportunity-card">
      <div className="opportunity-card-topline">
        <div className="subject-row">{project.subjects.map((subject) => <span className="subject-chip" key={subject.slug}>MSC {subject.amsCode} · {subject.name}</span>)}</div>
        <span className="record-chip">{workLabel(project)}</span>
      </div>
      <Link className="opportunity-card-title" href={`/explore/${project.slug}`}><h3>{project.title}</h3></Link>
      <p className="opportunity-card-statement">{project.informalStatement}</p>
      <dl className="opportunity-signal-grid">
        <div><dt>Needed now</dt><dd>{neededNow(project)}</dd></div>
        <div><dt>Research scope</dt><dd>{scopeLabel(project)}</dd></div>
        <div><dt>Pinned source</dt><dd>{project.source.upstreamName} · {project.source.revisionTag}</dd></div>
      </dl>
      <div className="opportunity-card-verification"><span>Current public record</span><StatusStack statuses={project.displayStatuses} compact /></div>
      <footer className="opportunity-card-footer">
        <code>{project.declaration.qualifiedName}</code>
        <div>
          {canStart && <Link className="button button-primary" href={`/workbench?target=${encodeURIComponent(project.slug)}#research-launcher`}>Start an Attempt</Link>}
          <Link className={canStart ? "button button-secondary" : "button button-primary"} href={`/explore/${project.slug}`}>{canStart ? "View research record" : "Inspect proof record"} <span aria-hidden="true">→</span></Link>
        </div>
      </footer>
    </article>
  );
}

function collectionPosition(project: CatalogProblem, tier: "founding" | "grand") {
  return project.collections.find((collection) => collection.tier === tier)?.position ?? Number.MAX_SAFE_INTEGER;
}

function opportunityKind(project: CatalogProblem): Exclude<OpportunityFilter, "all"> {
  if (project.proofState === "proved") return "verified";
  if (project.researchStatus === "research_solved") return "formalize";
  return "advance";
}

function scopeKind(project: CatalogProblem): Exclude<ScopeFilter, "all"> | "program" {
  if (project.collections.some((collection) => collection.role === "milestone")) return "bounded";
  if (project.collections.some((collection) => collection.tier === "grand" && collection.role === "headline")) return "long-horizon";
  return "program";
}

function neededNow(project: CatalogProblem) {
  if (project.proofState === "proved") return "Inspect the checked proof and its evidence";
  if (project.researchStatus === "research_solved") return "Formalize an established mathematical result";
  return "Advance an open formal proof branch";
}

function scopeLabel(project: CatalogProblem) {
  const kind = scopeKind(project);
  if (kind === "bounded") return "Bounded milestone";
  if (kind === "long-horizon") return "Long-horizon program";
  return "Open research program";
}

function workLabel(project: CatalogProblem) {
  if (project.proofState === "proved") return "Lean proof available";
  if (project.researchStatus === "research_solved") return "Known result · Lean proof wanted";
  return "Open conjecture";
}
