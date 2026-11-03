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
import { getI18n } from "@/app/i18n/server";
import type { Translator } from "@/app/i18n/translate";

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

export async function ReusePanel({
  index,
  problemSlug,
}: {
  index: ReuseIndexView;
  problemSlug: string;
}) {
  const { t } = await getI18n();
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
          <p className="eyebrow">{t("explore.reuse.eyebrow")}</p>
          <SectionTitle id="reuse-index-title">{t("explore.reuse.title")}</SectionTitle>
          <p>{t("explore.reuse.body")}</p>
        </div>
        <FieldList layout="stacked" className={styles.stats}>
          <Field label={t("explore.reuse.priorWork")}>{priorWork.count}</Field>
          <Field label={t("explore.reuse.relatedTargets")}>{relatedTargets.length}</Field>
          <Field label={t("explore.reuse.leanPaths")}>{reusableLeanPaths.length}</Field>
        </FieldList>
      </SectionHeading>

      <div className={styles.boundary}>
        <span>{t("explore.reuse.boundary.duplicate")}</span>
        <span>{t("explore.reuse.boundary.related")}</span>
        <span>{t("explore.reuse.boundary.prior")}</span>
        <strong>{boundary.statement}</strong>
      </div>

      {unavailableReason && (
        <div className={styles.notice} role="status">
          <strong>{t("explore.reuse.notice.title")}</strong>
          <p>{unavailableReasonText(unavailableReason, t)}</p>
        </div>
      )}

      <div className={styles.grid}>
        <Surface as="article" className={styles.panel}>
          <div className={styles.panelHeading}>
            <span>{t("explore.reuse.related.title")}</span>
            <span className="mono-label">{t("explore.reuse.related.max")}</span>
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
                      {target.label === "possible_duplicate" ? t("explore.reuse.badge.duplicate") : t("explore.reuse.badge.related")}
                    </Badge>
                    <span className={styles.score}>{t("explore.reuse.score", { score: target.score.toFixed(3) })}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState as="div" className={styles.empty}>
              <strong>
                {relatedUnavailable
                  ? t("explore.reuse.related.unavailable")
                  : t("explore.reuse.related.none")}
              </strong>
              <p>
                {relatedUnavailable
                  ? unavailableReasonText(unavailableReason ?? "internal_error", t)
                  : t("explore.reuse.related.noneBody")}
              </p>
            </EmptyState>
          )}
        </Surface>

        <Surface as="article" className={styles.panel}>
          <div className={styles.panelHeading}>
            <span>{t("explore.reuse.lean.title")}</span>
            <span className="mono-label">{t("explore.reuse.lean.recorded", { count: reusableLeanPaths.length })}</span>
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
                    {path.status && <span className={styles.leanStatus}>{statusLabel(path.status, t)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState as="div" className={styles.empty}>
              <strong>
                {leanUnavailable
                  ? t("explore.reuse.lean.unavailable")
                  : t("explore.reuse.lean.none")}
              </strong>
              <p>
                {leanUnavailable
                  ? unavailableReasonText(unavailableReason ?? "internal_error", t)
                  : t("explore.reuse.lean.noneBody")}
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
              ? t("explore.reuse.footer.noPrior")
              : t("explore.reuse.footer.counts", { curated: priorWork.curatedRecords, shared: priorWork.sharedCheckpoints, external: priorWork.externalWorks })}
          </p>
          <ActionLink className="text-link" href={`/api/catalog/${encodeURIComponent(problemSlug)}/reuse`}>
            {t("explore.reuse.footer.json")} <span aria-hidden="true">→</span>
          </ActionLink>
        </div>
      </div>
    </section>
  );
}

function unavailableReasonText(reason: string, t: Translator): string {
  switch (reason) {
    case "catalog_unavailable":
      return t("explore.reuse.reason.catalog");
    case "curated_research_unavailable":
      return t("explore.reuse.reason.curated");
    case "research_graph_unavailable":
      return t("explore.reuse.reason.graph");
    case "missing_current_target":
      return t("explore.reuse.reason.missing");
    case "internal_error":
      return t("explore.reuse.reason.internal");
    default:
      return t("explore.reuse.reason.default");
  }
}

function statusLabel(status: string, t: Translator): string {
  switch (status) {
    case "lean_reproduced":
      return t("explore.reuse.status.lean_reproduced");
    case "curator_reviewed":
      return t("explore.reuse.status.curator_reviewed");
    case "source_asserted":
      return t("explore.reuse.status.source_asserted");
    case "disputed":
      return t("explore.reuse.status.disputed");
    case "superseded":
      return t("explore.reuse.status.superseded");
    default:
      return status.replaceAll("_", " ");
  }
}
