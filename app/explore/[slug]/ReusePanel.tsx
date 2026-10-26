import Link from "next/link";

import {
  ActionLink,
  Badge,
  CardTitle,
  EmptyState,
  Field,
  FieldList,
  SectionHeading,
  SectionTitle,
  Surface,
} from "@/app/components/ui";

import styles from "./ReusePanel.module.css";

type ReuseLabel = "possible_duplicate" | "related";

type RelatedTarget = Readonly<{
  slug: string;
  title: string;
  score: number;
  label: ReuseLabel;
}>;

type PriorWork = Readonly<{
  count: number;
  curatedRecords: number;
  sharedCheckpoints: number;
  externalWorks: number;
}>;

type ReusableLeanPath = Readonly<{
  id: string;
  title: string;
  url: string;
  commit: string | null;
  declaration: string | null;
  status: string | null;
  role: string | null;
  sourceSystem: string | null;
  sourceIdentifier: string | null;
}>;

export type ReuseIndexView = Readonly<{
  relatedTargets: readonly RelatedTarget[];
  priorWork: PriorWork;
  reusableLeanPaths: readonly ReusableLeanPath[];
  boundary: Readonly<{
    statement: string;
    notes: readonly string[];
  }>;
  unavailableReason?: string;
}>;

export function ReusePanel({
  index,
  problemSlug,
}: {
  index: ReuseIndexView;
  problemSlug: string;
}) {
  const { relatedTargets, priorWork, reusableLeanPaths, boundary, unavailableReason } = index;
  const relatedUnavailable = unavailableReason === "catalog_unavailable"
    || unavailableReason === "missing_current_target"
    || unavailableReason === "internal_error";
  const leanUnavailable = unavailableReason === "curated_research_unavailable"
    || unavailableReason === "missing_current_target"
    || unavailableReason === "internal_error";

  return (
    <section className={styles.section} id="reuse-index" aria-labelledby="reuse-index-title">
      <SectionHeading as="div" className={styles.heading}>
        <div className={styles.headingCopy}>
          <p className="eyebrow">Reuse index · read-only</p>
          <SectionTitle id="reuse-index-title">Check for existing work before starting.</SectionTitle>
          <p>Possible duplicate, related, and prior-work signals are computed from public catalog metadata. They point at material worth reusing; they are not findings about novelty or correctness.</p>
        </div>
        <FieldList layout="stacked" className={styles.stats}>
          <Field label="Prior work">{priorWork.count}</Field>
          <Field label="Related targets">{relatedTargets.length}</Field>
          <Field label="Lean paths">{reusableLeanPaths.length}</Field>
        </FieldList>
      </SectionHeading>

      <div className={styles.boundary}>
        <span>Possible duplicate ≠ decision</span>
        <span>Related ≠ equivalence</span>
        <span>Prior work ≠ endorsement</span>
        <strong>{boundary.statement}</strong>
      </div>

      {unavailableReason && (
        <div className={styles.notice} role="status">
          <strong>Reuse index is incomplete.</strong>
          <p>{unavailableReasonText(unavailableReason)}</p>
        </div>
      )}

      <div className={styles.grid}>
        <Surface as="article" className={styles.panel}>
          <div className={styles.panelHeading}>
            <span>Related targets</span>
            <span className="mono-label">max 5</span>
          </div>
          {relatedTargets.length > 0 ? (
            <ul className={styles.relatedList}>
              {relatedTargets.map((target) => (
                <li className={styles.relatedItem} key={target.slug}>
                  <CardTitle as="h3">
                    <Link href={`/explore/${encodeURIComponent(target.slug)}`}>{target.title}</Link>
                  </CardTitle>
                  <div className={styles.relatedMeta}>
                    <Badge tone={target.label === "possible_duplicate" ? "warning" : "neutral"}>
                      {target.label === "possible_duplicate" ? "Possible duplicate" : "Related"}
                    </Badge>
                    <span className={styles.score}>score {target.score.toFixed(3)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState as="div" className={styles.empty}>
              <strong>
                {relatedUnavailable
                  ? "Related targets are unavailable."
                  : "No related targets cleared the similarity threshold."}
              </strong>
              <p>
                {relatedUnavailable
                  ? unavailableReasonText(unavailableReason ?? "internal_error")
                  : "Scores compare normalized public titles and statements. No match is not evidence that this target is new; search the catalog before assuming the work has not been done."}
              </p>
            </EmptyState>
          )}
        </Surface>

        <Surface as="article" className={styles.panel}>
          <div className={styles.panelHeading}>
            <span>Reusable Lean paths</span>
            <span className="mono-label">{reusableLeanPaths.length} recorded</span>
          </div>
          {reusableLeanPaths.length > 0 ? (
            <ul className={styles.leanList}>
              {reusableLeanPaths.map((path) => (
                <li className={styles.leanItem} key={path.id}>
                  <a href={path.url} rel="noreferrer" target="_blank">
                    {path.title}<span aria-hidden="true"> ↗</span>
                  </a>
                  <div className={styles.leanMeta}>
                    {path.sourceSystem && <span>{path.sourceSystem}</span>}
                    {path.declaration && <code>{path.declaration}</code>}
                    {path.commit && <code>@{path.commit.slice(0, 12)}</code>}
                    {path.status && <span className={styles.leanStatus}>{statusLabel(path.status)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState as="div" className={styles.empty}>
              <strong>
                {leanUnavailable
                  ? "Reusable Lean paths are unavailable."
                  : "No reusable Lean path is recorded yet."}
              </strong>
              <p>
                {leanUnavailable
                  ? unavailableReasonText(unavailableReason ?? "internal_error")
                  : "Curated prior-work records can carry a Lean repository, commit, and declaration. None is attached to this target's public record yet."}
              </p>
            </EmptyState>
          )}
        </Surface>
      </div>

      <div className={styles.footer}>
        <div className={styles.footerNotes}>
          <strong>{boundary.statement}.</strong>
          <ul>
            {boundary.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </div>
        <div className={styles.footerMeta}>
          <p>
            {priorWork.count === 0
              ? "No prior-work entries are recorded yet."
              : `${priorWork.curatedRecords} curated records · ${priorWork.sharedCheckpoints} shared checkpoints · ${priorWork.externalWorks} external works`}
          </p>
          <ActionLink className="text-link" href={`/api/catalog/${encodeURIComponent(problemSlug)}/reuse`}>
            Read-only JSON for Agents <span aria-hidden="true">→</span>
          </ActionLink>
        </div>
      </div>
    </section>
  );
}

function unavailableReasonText(reason: string): string {
  switch (reason) {
    case "catalog_unavailable":
      return "The public catalog list could not be read, so related targets are not shown right now.";
    case "curated_research_unavailable":
      return "The curated prior-work registry is not active in this control plane, so recorded Lean paths and curated counts are not shown.";
    case "research_graph_unavailable":
      return "The shared research graph is not active in this control plane, so shared checkpoints and external works are excluded from the prior-work count.";
    case "missing_current_target":
      return "The current target could not be resolved, so no reuse hints were computed.";
    case "internal_error":
      return "The reuse index could not be built from the available public data.";
    default:
      return "Part of the reuse index is unavailable.";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "lean_reproduced":
      return "Lean reproduced · record state";
    case "curator_reviewed":
      return "Curator reviewed";
    case "source_asserted":
      return "Source asserted";
    case "disputed":
      return "Disputed";
    case "superseded":
      return "Superseded";
    default:
      return status.replaceAll("_", " ");
  }
}
