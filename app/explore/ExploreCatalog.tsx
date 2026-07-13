"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { projects } from "../lib/content";
import { StatusStack } from "../ui";

const filters = ["All", "Open branch", "Kernel checked", "Review requested"] as const;

export function ExploreCatalog() {
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [expanded, setExpanded] = useState<string | null>(null);
  const visibleProjects = useMemo(() => {
    if (filter === "All") return projects;
    if (filter === "Open branch") return projects.filter((project) => project.statuses.includes("Proof branch open"));
    if (filter === "Kernel checked") return projects.filter((project) => project.statuses.includes("Kernel checked"));
    return projects.filter((project) => project.statuses.includes("Statement review") || project.statuses.includes("Independent review"));
  }, [filter]);

  return (
    <section className="explore-layout">
      <aside className="explore-sidebar">
        <p className="micro-label">Browse records</p>
        <div className="filter-group" aria-label="Catalog filters">
          {filters.map((item) => <button key={item} className={filter === item ? "filter-button active" : "filter-button"} onClick={() => setFilter(item)} type="button">{item}</button>)}
        </div>
        <div className="filter-note"><strong>Data source</strong><p>This first build uses clearly marked preview records. Connect a pinned Formal Conjectures snapshot before presenting live catalog data.</p></div>
      </aside>
      <div className="catalog-list">
        <div className="catalog-toolbar"><span>{visibleProjects.length} visible records</span><span>Sorted by research priority</span></div>
        {visibleProjects.map((project) => {
          const isExpanded = expanded === project.slug;
          return (
            <article className="catalog-card" key={project.slug}>
              <div className="catalog-card-main">
                <div className="card-topline"><span className="micro-label">{project.domain}</span><span className="record-chip">Preview</span></div>
                <Link href={`/explore/${project.slug}`}><h2>{project.title}</h2></Link>
                <p>{project.informal}</p>
                <StatusStack statuses={project.statuses} compact />
              </div>
              <div className="catalog-actions"><button className="code-toggle" onClick={() => setExpanded(isExpanded ? null : project.slug)} type="button" aria-expanded={isExpanded}>{isExpanded ? "Hide Lean" : "Show Lean"}</button><Link className="record-link" href={`/explore/${project.slug}`}>Inspect <span>→</span></Link></div>
              {isExpanded && <pre className="lean-snippet"><code>{project.lean}</code></pre>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
