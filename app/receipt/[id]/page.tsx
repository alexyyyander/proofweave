import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { PageTitle, SectionTitle, Badge, Field, EmptyState, FieldList, SectionHeading, Surface } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import Link from "next/link";
import { MissingDatabaseBindingError } from "@/db";
import { getContributionReceiptReader, type PublicContributionReceiptRecord, type PublicContributionReceipt, type PublicContributionReceiptDependency, type PublicContributionReceiptLifecycleEvent } from "@/db/repositories/receipts";
import { getI18n } from "@/app/i18n/server";
import type { Locale } from "@/app/i18n/config";
import type { TranslationKey, Translator } from "@/app/i18n/translate";
import { ReceiptBoundary } from "./ReceiptBoundary";
import { ReceiptVerificationClient } from "./ReceiptVerificationClient";

const kindKeys: Record<PublicContributionReceipt["kind"], TranslationKey> = {
  formalization: "receipts.kind.formalization",
  lemma: "receipts.kind.lemma",
  proof_patch: "receipts.kind.proof_patch",
  counterexample: "receipts.kind.counterexample",
  verification: "receipts.kind.verification",
  synthesis: "receipts.kind.synthesis",
  infrastructure: "receipts.kind.infrastructure",
};

const lifecycleKeys: Record<PublicContributionReceiptLifecycleEvent["eventType"], TranslationKey> = {
  corrected: "receipt.lifecycleLabel.corrected",
  superseded: "receipt.lifecycleLabel.superseded",
  retracted: "receipt.lifecycleLabel.retracted",
};

export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { t, locale } = await getI18n();
  const { id } = await params;
  let record: PublicContributionReceiptRecord | null = null;
  let dependencies: readonly PublicContributionReceiptDependency[] | null = null;
  let lifecycle: readonly PublicContributionReceiptLifecycleEvent[] | null = null;
  let unavailable: boolean | null = null;
  try {
    const reader = getContributionReceiptReader();
    record = await reader.findById(id);
    if (record) {
      [dependencies, lifecycle] = await Promise.all([
        reader.findDependenciesById(id),
        reader.findLifecycleById(id),
      ]);
    }
  } catch (error) {
    unavailable = error instanceof MissingDatabaseBindingError;
  }
  if (unavailable !== null) return <ReceiptUnavailable unavailable={unavailable} t={t} />;
  if (!record) return <ReceiptNotIssued id={id} t={t} />;
  if (!dependencies || !lifecycle) return <ReceiptUnavailable unavailable={false} t={t} />;
  return <IssuedReceipt receipt={record.receipt} receiptHash={record.receiptHash} dependencies={dependencies} lifecycle={lifecycle} t={t} locale={locale} />;
}

function IssuedReceipt({ receipt, receiptHash, dependencies, lifecycle, t, locale }: { receipt: PublicContributionReceipt; receiptHash: string; dependencies: readonly PublicContributionReceiptDependency[]; lifecycle: readonly PublicContributionReceiptLifecycleEvent[]; t: Translator; locale: Locale }) {
  const independentReviewers = new Set(receipt.claims.map((claim) => claim.reviewerPersonId)).size;
  const latestLifecycleEvent = lifecycle.at(-1) ?? null;
  return (
    <SiteFrame className="site-shell app-shell" active="receipt" mainClassName="page-main receipt-main">
        <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/explore">{t("explore.breadcrumb")}</Link><span> / </span><span>{t("receipt.breadcrumb.receipt")}</span></Breadcrumb>
        <SectionHeading as="section" className="receipt-heading"><div><p className="eyebrow">{t("receipt.eyebrow")}</p><PageTitle>{t(kindKeys[receipt.kind])}</PageTitle><p>{t("receipt.body")}</p></div><Badge className="record-chip">{t("receipt.badge.issued")}</Badge></SectionHeading>
        <section className="receipt-summary"><div><span>{t("receipt.summary.credited")}</span><Link className="person-record-link" href={`/people/${encodeURIComponent(receipt.beneficiary.personId)}`}><code>{receipt.beneficiary.personId}</code></Link></div><div><span>{t("receipt.summary.viaAgent")}</span><code>{receipt.beneficiary.agentId}</code></div><div><span>{t("receipt.summary.target")}</span><strong>{receipt.target.declaration}</strong></div><div><span>{t("receipt.summary.issued")}</span><strong>{formatDate(receipt.issuedAt, locale)}</strong></div></section>
        <ReceiptBoundary receipt={receipt} reviewerCount={independentReviewers} t={t} />
        <ReceiptVerificationClient receiptId={receipt.id} />
        <section className="receipt-grid">
          <Surface as="article" className="receipt-card"><p className="eyebrow">{t("receipt.stack.eyebrow")}</p><ReceiptGate label={t("receipt.stack.delegation")} detail={receipt.beneficiary.delegationCertificateId} /><ReceiptGate label={t("receipt.stack.bundle")} detail={t("receipt.stack.attested")} /><ReceiptGate label={t("receipt.stack.kernel")} detail={t("receipt.stack.accepted")} /><ReceiptGate label={t("receipt.stack.review")} detail={t(independentReviewers === 1 ? "receipt.stack.reviewValue.one" : "receipt.stack.reviewValue.other", { attestations: receipt.claims.length, people: independentReviewers })} /></Surface>
          <Surface as="article" className="receipt-card receipt-machine"><p className="eyebrow">{t("receipt.machine.eyebrow")}</p><FieldList><Field label={t("receipt.field.receiptId")}><code>{receipt.id}</code></Field><Field label={t("receipt.field.receiptHash")}><code>{receiptHash}</code></Field><Field label={t("receipt.field.payloadHash")}><code>{receipt.payloadHash}</code></Field><Field label={t("receipt.field.artifactBundle")}><code>{receipt.artifactBundleHash}</code></Field><Field label={t("receipt.field.runResult")}><code>{receipt.run.resultHash}</code></Field>{receipt.run.environment && <><Field label={t("receipt.field.runnerImage")}><code>{receipt.run.environment.imageDigest}</code></Field><Field label={t("receipt.field.runnerLean")}><code>{receipt.run.environment.leanToolchain}</code> · mathlib:{receipt.run.environment.mathlibRevision.slice(0, 12)}</Field><Field label={t("receipt.field.template")}>{receipt.run.environment.templateId ? <code>{receipt.run.environment.templateId}</code> : t("receipt.notRecorded")}</Field><Field label={t("receipt.field.templateBuild")}>{receipt.run.environment.templateBuildId ? <code>{receipt.run.environment.templateBuildId}</code> : t("receipt.notRecorded")}</Field></>}<Field label={t("receipt.field.issuerKey")}><code>{receipt.issuerKeyId}</code></Field><Field label={t("receipt.field.json")}><Link className="text-link" href={`/api/receipts/${encodeURIComponent(receipt.id)}`}>{t("receipt.openJson")} <span>→</span></Link></Field><Field label={t("receipt.field.portable")}><Link className="text-link" href={`/api/receipts/${encodeURIComponent(receipt.id)}/verification-bundle`}>{t("receipt.downloadBundle")} <span>→</span></Link></Field><Field label={t("receipt.field.currentKeys")}><Link className="text-link" href="/api/receipts/issuer-keys">{t("receipt.openKeyset")} <span>→</span></Link></Field></FieldList></Surface>
        </section>
        <section className="receipt-dependencies" aria-labelledby="receipt-dependencies-heading"><div><p className="eyebrow">{t("receipt.dependencies.eyebrow")}</p><SectionTitle id="receipt-dependencies-heading">{t("receipt.dependencies.title")}</SectionTitle><p>{t("receipt.dependencies.body")}</p></div>{dependencies.length === 0 ? <p className="receipt-dependency-empty">{t("receipt.dependencies.empty")}</p> : <ol>{dependencies.map((dependency) => <li key={dependency.receiptId}><div><span>{t(kindKeys[dependency.kind])}</span><Link href={`/receipt/${encodeURIComponent(dependency.receiptId)}`}>{dependency.target.declaration}</Link><small>{t("receipt.summary.issued")} {formatDate(dependency.issuedAt, locale)}</small></div><div><code>{dependency.receiptId}</code><code>{dependency.receiptHash}</code></div></li>)}</ol>}<Link className="text-link receipt-dependency-json" href={`/api/receipts/${encodeURIComponent(receipt.id)}/dependencies`}>{t("receipt.dependencies.openJson")} <span>→</span></Link></section>
        <section className={`receipt-lifecycle${latestLifecycleEvent ? ` is-${latestLifecycleEvent.eventType}` : ""}`} aria-labelledby="receipt-lifecycle-heading"><div><p className="eyebrow">{t("receipt.lifecycle.eyebrow")}</p><SectionTitle id="receipt-lifecycle-heading">{latestLifecycleEvent ? lifecycleHeading(latestLifecycleEvent, t) : t("receipt.lifecycle.noEventTitle")}</SectionTitle><p>{latestLifecycleEvent ? lifecycleDetail(latestLifecycleEvent, t, locale) : t("receipt.lifecycle.noEventBody")}</p></div>{lifecycle.length > 0 && <ol>{lifecycle.map((event) => <li key={event.id}><span>{t(lifecycleKeys[event.eventType])}</span><div><strong>{formatDate(event.occurredAt, locale)}</strong><code>{event.reasonHash}</code></div>{event.replacementReceiptId ? <Link className="text-link" href={`/receipt/${encodeURIComponent(event.replacementReceiptId)}`}>{t("receipt.lifecycle.openReplacement")} <span>→</span></Link> : <small>{t("receipt.lifecycle.originalRetained")}</small>}</li>)}</ol>}<Link className="text-link receipt-lifecycle-json" href={`/api/receipts/${encodeURIComponent(receipt.id)}/lifecycle`}>{t("receipt.lifecycle.openJson")} <span>→</span></Link></section>
        <p className="receipt-note">{t("receipt.note")}</p>
      </SiteFrame>
  );
}

function ReceiptGate({ label, detail }: { label: string; detail: string }) {
  return <div className="receipt-state"><span className="accepted-dot" /><span>{label}</span><strong className="receipt-state-detail">{detail}</strong></div>;
}

function ReceiptNotIssued({ id, t }: { id: string; t: Translator }) {
  return <ReceiptMessage title={t("receipt.message.notIssuedTitle")} detail={t("receipt.message.notIssuedDetail")} id={id} t={t} />;
}

function ReceiptUnavailable({ unavailable, t }: { unavailable: boolean; t: Translator }) {
  return <ReceiptMessage title={t("receipt.message.unavailableTitle")} detail={unavailable ? t("receipt.message.unavailableStorage") : t("receipt.message.unavailableVerify")} t={t} />;
}

function ReceiptMessage({ title, detail, id, t }: { title: string; detail: string; id?: string; t: Translator }) {
  return (
    <SiteFrame className="site-shell app-shell" active="receipt" mainClassName="page-main receipt-main">
        <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/explore">{t("explore.breadcrumb")}</Link><span> / </span><span>{t("receipt.breadcrumb.receipt")}</span></Breadcrumb>
        <SectionHeading as="section" className="receipt-heading"><div><p className="eyebrow">{t("receipt.message.eyebrow")}</p><PageTitle>{title}</PageTitle><p>{detail}</p></div><Badge className="record-chip">{id ? t("receipt.message.notIssuedBadge") : t("receipt.message.unavailableBadge")}</Badge></SectionHeading>
        {id && <EmptyState as="section" className="receipt-card receipt-message"><p className="eyebrow">{t("receipt.message.requestedLabel")}</p><code>{id}</code><Link className="text-link" href="/how-it-works">{t("receipt.message.readRequirements")} <span>→</span></Link></EmptyState>}
      </SiteFrame>
  );
}

function lifecycleHeading(event: PublicContributionReceiptLifecycleEvent, t: Translator) {
  if (event.eventType === "retracted") return t("receipt.lifecycleHeading.retracted");
  if (event.eventType === "superseded") return t("receipt.lifecycleHeading.superseded");
  return t("receipt.lifecycleHeading.default");
}

function lifecycleDetail(event: PublicContributionReceiptLifecycleEvent, t: Translator, locale: Locale) {
  if (event.eventType === "retracted") return t("receipt.lifecycleDetail.retracted", { time: formatDate(event.occurredAt, locale) });
  return t("receipt.lifecycleDetail.default", { time: formatDate(event.occurredAt, locale) });
}

function formatDate(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(date);
}
