import Link from "next/link";
import type {
  CuratedResearchKind,
  CuratedResearchRole,
  CuratedResearchStatus,
  PublicCuratedResearchRecord,
} from "@/db/repositories/curated-research";

export function PriorWorkChain({
  records,
  problemSlug,
}: {
  records: readonly PublicCuratedResearchRecord[];
  problemSlug: string;
}) {
  const paperCount = records.filter((record) => record.kind === "paper" || record.kind === "preprint").length;
  const formalizationCount = records.filter((record) => record.leanRepositoryUrl || record.kind === "formalization").length;
  const reviewedCount = records.filter((record) => record.curationStatus === "curator_reviewed" || record.curationStatus === "lean_reproduced").length;

  return (
    <section className="curated-research-section" id="research-chain" aria-labelledby="curated-research-title">
      <div className="curated-research-heading">
        <div>
          <p className="eyebrow">Curated research record</p>
          <h2 id="curated-research-title">Start from the chain, not from zero.</h2>
          <p>Papers, special cases, key lemmas, counterexamples, and formalization repositories are archived per conjecture. Every record keeps its source and evidence state; external material does not become a Proofweave proof automatically.</p>
        </div>
        <dl className="curated-research-stats">
          <div><dt>Records</dt><dd>{records.length}</dd></div>
          <div><dt>Papers</dt><dd>{paperCount}</dd></div>
          <div><dt>Lean paths</dt><dd>{formalizationCount}</dd></div>
          <div><dt>Reviewed</dt><dd>{reviewedCount}</dd></div>
        </dl>
      </div>

      <div className="curated-research-boundary">
        <span>Source-backed</span>
        <span>Per-conjecture</span>
        <span>Append-only curation</span>
        <strong>Public context ≠ Proofweave verification</strong>
      </div>

      {records.length > 0 ? (
        <div className="curated-research-list">
          {records.map((record, index) => (
            <ResearchRecordCard key={record.id} index={index + 1} record={record} problemSlug={problemSlug} />
          ))}
        </div>
      ) : (
        <div className="curated-research-empty">
          <div>
            <strong>This conjecture has no curated prior-work entries yet.</strong>
            <p>The target remains searchable and its Agent research graph is independent. Add a source-backed record when a paper, result, or formalization has been checked into the public research record.</p>
          </div>
          <Link className="button button-secondary" href="/about/catalog-standard">Read the curation standard <span aria-hidden="true">→</span></Link>
        </div>
      )}
    </section>
  );
}

function ResearchRecordCard({
  index,
  record,
  problemSlug,
}: {
  index: number;
  record: PublicCuratedResearchRecord;
  problemSlug: string;
}) {
  return (
    <article className={`curated-research-record is-${record.curationStatus}`}>
      <div className="curated-research-record-index"><span>{String(index).padStart(2, "0")}</span><i aria-hidden="true" /></div>
      <div className="curated-research-record-body">
        <div className="curated-research-record-top">
          <span className="curated-research-role">{roleLabel(record.role)}</span>
          <span className="curated-research-kind">{kindLabel(record.kind)}</span>
        </div>
        <h3><a href={record.sourceUrl} rel="noreferrer" target="_blank">{record.title}<span aria-hidden="true">↗</span></a></h3>
        <p className="curated-research-authors">{record.authors} · {formatDate(record.occurredAt)}</p>
        <p className="curated-research-summary">{record.summary}</p>
        <div className="curated-research-record-footer">
          <span className={`curated-research-status is-${record.curationStatus}`}>{statusLabel(record.curationStatus)}</span>
          <code>{record.sourceSystem} · {record.sourceIdentifier}</code>
        </div>
      </div>
      <div className="curated-research-record-actions">
        {record.leanRepositoryUrl && <a href={record.leanRepositoryUrl} rel="noreferrer" target="_blank">Open Lean path <span aria-hidden="true">↗</span></a>}
        <Link href={`/workbench?target=${encodeURIComponent(problemSlug)}#research-launcher`}>Replay in workspace <span aria-hidden="true">→</span></Link>
      </div>
    </article>
  );
}

function roleLabel(role: CuratedResearchRole): string {
  return {
    origin: "Origin",
    definition: "Definition",
    special_case: "Special case",
    key_lemma: "Key lemma",
    counterexample: "Counterexample",
    negative_result: "Negative result",
    progress: "Research progress",
    formalization: "Formalization",
    reproduction: "Reproduction",
    announcement: "Announcement",
    current_state: "Current state",
  }[role];
}

function kindLabel(kind: CuratedResearchKind): string {
  return {
    paper: "Paper",
    preprint: "Preprint",
    repository: "Repository",
    announcement: "Public note",
    formalization: "Lean project",
    result: "Result",
    review: "Review",
  }[kind];
}

function statusLabel(status: CuratedResearchStatus): string {
  return {
    source_asserted: "Source asserted",
    curator_reviewed: "Curator reviewed",
    lean_reproduced: "Lean reproduced",
    disputed: "Disputed",
    superseded: "Superseded",
  }[status];
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : value;
}
