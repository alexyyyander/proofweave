import { SectionTitle, CardTitle, Field, ActionLink, EmptyState, FieldList, SectionHeading, Surface } from "@/app/components/ui";

import Link from "next/link";
import { type CuratedResearchKind, type CuratedResearchRole, type CuratedResearchStatus, type PublicCuratedResearchRecord } from "@/db/repositories/curated-research";
import { getI18n } from "@/app/i18n/server";
import type { TranslationKey, Translator } from "@/app/i18n/translate";

const roleKeys: Record<CuratedResearchRole, TranslationKey> = {
  origin: "explore.prior.role.origin",
  definition: "explore.prior.role.definition",
  special_case: "explore.prior.role.special_case",
  key_lemma: "explore.prior.role.key_lemma",
  counterexample: "explore.prior.role.counterexample",
  negative_result: "explore.prior.role.negative_result",
  progress: "explore.prior.role.progress",
  formalization: "explore.prior.role.formalization",
  reproduction: "explore.prior.role.reproduction",
  announcement: "explore.prior.role.announcement",
  current_state: "explore.prior.role.current_state",
};

const kindKeys: Record<CuratedResearchKind, TranslationKey> = {
  paper: "explore.prior.kind.paper",
  preprint: "explore.prior.kind.preprint",
  repository: "explore.prior.kind.repository",
  announcement: "explore.prior.kind.announcement",
  formalization: "explore.prior.kind.formalization",
  result: "explore.prior.kind.result",
  review: "explore.prior.kind.review",
};

const statusKeys: Record<CuratedResearchStatus, TranslationKey> = {
  source_asserted: "explore.prior.status.source_asserted",
  curator_reviewed: "explore.prior.status.curator_reviewed",
  lean_reproduced: "explore.prior.status.lean_reproduced",
  disputed: "explore.prior.status.disputed",
  superseded: "explore.prior.status.superseded",
};

export async function PriorWorkChain({
  records,
  problemSlug,
}: {
  records: readonly PublicCuratedResearchRecord[];
  problemSlug: string;
}) {
  const { t } = await getI18n();
  const paperCount = records.filter((record) => record.kind === "paper" || record.kind === "preprint").length;
  const formalizationCount = records.filter((record) => record.leanRepositoryUrl || record.kind === "formalization").length;
  const reviewedCount = records.filter((record) => record.curationStatus === "curator_reviewed" || record.curationStatus === "lean_reproduced").length;

  return (
    <section className="curated-research-section" id="research-chain" aria-labelledby="curated-research-title">
      <SectionHeading as="div" className="curated-research-heading">
        <div>
          <p className="eyebrow">{t("explore.prior.eyebrow")}</p>
          <SectionTitle id="curated-research-title">{t("explore.prior.title")}</SectionTitle>
          <p>{t("explore.prior.body")}</p>
        </div>
        <FieldList layout="stacked" className="curated-research-stats">
          <Field label={t("explore.prior.records")}>{records.length}</Field>
          <Field label={t("explore.prior.papers")}>{paperCount}</Field>
          <Field label={t("explore.prior.leanPaths")}>{formalizationCount}</Field>
          <Field label={t("explore.prior.reviewed")}>{reviewedCount}</Field>
        </FieldList>
      </SectionHeading>

      <div className="curated-research-boundary">
        <span>{t("explore.prior.boundary.source")}</span>
        <span>{t("explore.prior.boundary.perConjecture")}</span>
        <span>{t("explore.prior.boundary.appendOnly")}</span>
        <strong>{t("explore.prior.boundary.public")}</strong>
      </div>

      {records.length > 0 ? (
        <div className="curated-research-list">
          {records.map((record, index) => (
            <ResearchRecordCard key={record.id} index={index + 1} record={record} problemSlug={problemSlug} t={t} />
          ))}
        </div>
      ) : (
        <EmptyState as="div" className="curated-research-empty">
          <div>
            <strong>{t("explore.prior.empty.title")}</strong>
            <p>{t("explore.prior.empty.body")}</p>
          </div>
          <ActionLink className="button button-secondary" href="/about/catalog-standard">{t("explore.prior.empty.action")} <span aria-hidden="true">→</span></ActionLink>
        </EmptyState>
      )}
    </section>
  );
}

function ResearchRecordCard({
  index,
  record,
  problemSlug,
  t,
}: {
  index: number;
  record: PublicCuratedResearchRecord;
  problemSlug: string;
  t: Translator;
}) {
  return (
    <Surface as="article" className={`curated-research-record is-${record.curationStatus}`}>
      <div className="curated-research-record-index"><span>{String(index).padStart(2, "0")}</span><i aria-hidden="true" /></div>
      <div className="curated-research-record-body">
        <div className="curated-research-record-top">
          <span className="curated-research-role">{t(roleKeys[record.role])}</span>
          <span className="curated-research-kind">{t(kindKeys[record.kind])}</span>
        </div>
        <CardTitle><a href={record.sourceUrl} rel="noreferrer" target="_blank">{record.title}<span aria-hidden="true">↗</span></a></CardTitle>
        <p className="curated-research-authors">{record.authors} · {formatDate(record.occurredAt)}</p>
        <p className="curated-research-summary">{record.summary}</p>
        <div className="curated-research-record-footer">
          <span className={`curated-research-status is-${record.curationStatus}`}>{t(statusKeys[record.curationStatus])}</span>
          <code>{record.sourceSystem} · {record.sourceIdentifier}</code>
        </div>
      </div>
      <div className="curated-research-record-actions">
        {record.leanRepositoryUrl && <a href={record.leanRepositoryUrl} rel="noreferrer" target="_blank">{t("explore.prior.openLean")} <span aria-hidden="true">↗</span></a>}
        <Link href={`/workbench?target=${encodeURIComponent(problemSlug)}#research-launcher`}>{t("explore.prior.replay")} <span aria-hidden="true">→</span></Link>
      </div>
    </Surface>
  );
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : value;
}
