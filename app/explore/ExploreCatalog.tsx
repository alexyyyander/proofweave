"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CatalogProblem } from "@/packages/domain/catalog";
import { StatusStack } from "../ui";

const filters = ["All", "Open proof", "Kernel accepted", "Source review pending"] as const;

export function ExploreCatalog({ projects }: { projects: readonly CatalogProblem[] }) {
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [expanded, setExpanded] = useState<string | null>(null);
  const visibleProjects = useMemo(() => {
    if (filter === "All") return projects;
    if (filter === "Open proof") return projects.filter((project) => project.proofState === "admitted");
    if (filter === "Kernel accepted") return projects.filter((project) => project.displayStatuses.includes("Kernel accepted"));
    return projects.filter((project) => project.claims.some((claim) => claim.type === "statement_faithful" && claim.status !== "attested"));
  }, [filter, projects]);

  return (
    <section className="explore-layout">
      <aside className="explore-sidebar">
        <p className="micro-label">Browse records</p>
        <div className="filter-group" aria-label="Catalog filters">
          {filters.map((item) => <button key={item} className={filter === item ? "filter-button active" : "filter-button"} onClick={() => setFilter(item)} type="button">{item}</button>)}
        </div>
        <div className="filter-note"><strong>Data source</strong><p>Pinned Formal Conjectures records with declaration-level source and environment provenance. Practice exercises are stored separately and never mixed into this frontier catalog.</p></div>
      </aside>
      <div className="catalog-list">
        <div className="catalog-toolbar"><span>{visibleProjects.length} visible records</span><span>Sorted by research priority</span></div>
        {visibleProjects.map((project) => {
          const isExpanded = expanded === project.slug;
          return (
            <article className="catalog-card" key={project.slug}>
              <div className="catalog-card-main">
                <div className="card-topline"><span className="micro-label">{project.domain}</span><span className="record-chip">Pinned source</span></div>
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
    </section>
  );
}
