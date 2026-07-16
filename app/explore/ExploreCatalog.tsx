"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CatalogProblem } from "@/packages/domain/catalog";
import { StatusStack } from "../ui";

const statusFilters = [
  "All work",
  "Open conjectures",
  "Known results",
  "Kernel accepted",
] as const;

const preferredStarterSlugs = [
  "erdos-865-k2",
  "sunflower-erdos-rado-bound",
  "complexity-p-subset-np",
] as const;

export function ExploreCatalog({ projects }: { projects: readonly CatalogProblem[] }) {
  const [statusFilter, setStatusFilter] = useState<(typeof statusFilters)[number]>("All work");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

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

    const milestoneCounts = new Map<string, number>();
    for (const project of projects) {
      if (project.collections.some((collection) => collection.tier === "founding" && collection.role === "milestone")) {
        milestoneCounts.set(project.projectId, (milestoneCounts.get(project.projectId) ?? 0) + 1);
      }
    }

    return {
      founding: headline("founding"),
      grand: headline("grand"),
      milestoneCounts,
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
      if (statusFilter === "Open conjectures" && project.researchStatus !== "research_open") return false;
      if (statusFilter === "Known results" && project.researchStatus !== "research_solved") return false;
      if (statusFilter === "Kernel accepted" && !project.displayStatuses.includes("Kernel accepted")) return false;
      if (subjectFilter !== "all" && !project.subjects.some((subject) => subject.slug === subjectFilter)) return false;
      if (!normalizedQuery) return true;
      return [project.title, project.projectTitle, project.informalStatement, ...project.subjects.map((subject) => subject.name)]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    });
  }, [projects, query, statusFilter, subjectFilter]);

  return (
    <>
      <section className="starter-work-section" id="starter-work" aria-labelledby="starter-work-heading">
        <div className="starter-work-heading">
          <div>
            <p className="micro-label">Your first contribution</p>
            <h2 id="starter-work-heading">Formalize known mathematics first.</h2>
          </div>
          <div>
            <p>These statements are established mathematics whose pinned Lean declarations still need a proof. They offer a bounded way to learn the workflow without claiming to solve an open conjecture.</p>
            <span>Recommended starting path · not a difficulty guarantee</span>
          </div>
        </div>
        <div className="starter-work-grid">
          {starterProjects.map((project, index) => (
            <article className="starter-work-card" key={project.slug}>
              <div className="starter-work-topline">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <span>{project.subjects[0]?.name ?? project.domain}</span>
              </div>
              <h3>{project.title}</h3>
              <p>{project.informalStatement}</p>
              <div className="starter-work-state"><span>Known result</span><span>Lean proof wanted</span></div>
              <div className="starter-work-actions">
                <Link className="button button-primary" href={`/workbench?target=${encodeURIComponent(project.slug)}#research-launcher`}>Start formalizing <span aria-hidden="true">→</span></Link>
                <Link className="text-link" href={`/explore/${project.slug}`}>Inspect source</Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="challenge-section" aria-labelledby="founding-challenges-heading">
        <div className="challenge-heading">
          <div>
            <p className="micro-label">Start with a tractable research path</p>
            <h2 id="founding-challenges-heading">Founding Challenges</h2>
          </div>
          <p>Famous questions with smaller known milestones. Choose the open target, or formalize a result mathematics already knows.</p>
        </div>
        <div className="founding-grid">
          {featured.founding.map((project, index) => (
            <Link className="founding-card" href={`/explore/${project.slug}`} key={project.slug}>
              <span className="challenge-index">{String(index + 1).padStart(2, "0")}</span>
              <div className="subject-row">{project.subjects.map((subject) => <span className="subject-chip" key={subject.slug}>MSC {subject.amsCode} · {subject.name}</span>)}</div>
              <h3>{project.title}</h3>
              <p>{project.informalStatement}</p>
              <div className="challenge-card-footer">
                <span>{workLabel(project)}</span>
                <span>{featured.milestoneCounts.get(project.projectId) ?? 0} milestones <b aria-hidden="true">→</b></span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="grand-section" aria-labelledby="grand-challenges-heading">
        <div className="challenge-heading grand-heading">
          <div><p className="micro-label">Long-horizon coordination</p><h2 id="grand-challenges-heading">Grand Challenges</h2></div>
          <p>Not winner-takes-all bets. These targets organize reusable lemmas, counterexamples, and independent verification over time.</p>
        </div>
        <div className="grand-grid">
          {featured.grand.map((project) => (
            <Link className="grand-card" href={`/explore/${project.slug}`} key={project.slug}>
              <span>{project.subjects[0]?.name ?? project.domain}</span>
              <h3>{project.title}</h3>
              <b>Inspect target <span aria-hidden="true">→</span></b>
            </Link>
          ))}
        </div>
      </section>

      <section className="catalog-section" aria-labelledby="all-records-heading">
        <div className="catalog-section-heading">
          <div><p className="micro-label">Pinned formal catalog</p><h2 id="all-records-heading">All research records</h2></div>
          <label className="catalog-search"><span className="sr-only">Search research records</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conjectures and subjects" type="search" /></label>
        </div>
        <div className="explore-layout">
          <aside className="explore-sidebar">
            <p className="micro-label">Research status</p>
            <div className="filter-group" aria-label="Research status filters">
              {statusFilters.map((item) => <button key={item} className={statusFilter === item ? "filter-button active" : "filter-button"} onClick={() => setStatusFilter(item)} type="button">{item}</button>)}
            </div>
            <p className="micro-label subject-filter-label">Subject</p>
            <div className="filter-group" aria-label="Subject filters">
              <button className={subjectFilter === "all" ? "filter-button active" : "filter-button"} onClick={() => setSubjectFilter("all")} type="button">All subjects</button>
              {subjects.map((subject) => <button key={subject.slug} className={subjectFilter === subject.slug ? "filter-button active" : "filter-button"} onClick={() => setSubjectFilter(subject.slug)} type="button"><span>MSC {subject.amsCode}</span>{subject.name}</button>)}
            </div>
            <div className="filter-note"><strong>Auditable source</strong><p>Every record pins its upstream declaration, source hash, Lean toolchain, and mathlib revision. Research status is kept separate from Proofweave verification.</p></div>
          </aside>
          <div className="catalog-list">
            <div className="catalog-toolbar"><span>{visibleProjects.length} visible records</span><span>Sorted by research priority</span></div>
            {visibleProjects.length === 0 && <div className="catalog-empty"><strong>No records match these filters.</strong><p>Try another subject, status, or search phrase.</p></div>}
            {visibleProjects.map((project) => {
              const isExpanded = expanded === project.slug;
              return (
                <article className="catalog-card" key={project.slug}>
                  <div className="catalog-card-main">
                    <div className="card-topline">
                      <div className="subject-row">{project.subjects.map((subject) => <span className="subject-chip" key={subject.slug}>MSC {subject.amsCode} · {subject.name}</span>)}</div>
                      <span className="record-chip">{workLabel(project)}</span>
                    </div>
                    <Link href={`/explore/${project.slug}`}><h2>{project.title}</h2></Link>
                    <p>{project.informalStatement}</p>
                    <StatusStack statuses={project.displayStatuses} compact />
                  </div>
                  <div className="catalog-actions"><button className="code-toggle" onClick={() => setExpanded(isExpanded ? null : project.slug)} type="button" aria-expanded={isExpanded}>{isExpanded ? "Hide Lean" : "Show Lean"}</button><Link className="record-link" href={`/explore/${project.slug}`}>Inspect <span>→</span></Link></div>
                  {isExpanded && <pre className="lean-snippet"><code>{project.leanStatement}</code></pre>}
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}

function collectionPosition(project: CatalogProblem, tier: "founding" | "grand") {
  return project.collections.find((collection) => collection.tier === tier)?.position ?? Number.MAX_SAFE_INTEGER;
}

function workLabel(project: CatalogProblem) {
  if (project.proofState === "proved") return "Lean proof available";
  if (project.researchStatus === "research_solved") return "Known result · Lean proof wanted";
  return "Open conjecture";
}
