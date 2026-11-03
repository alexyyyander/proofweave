import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { PageTitle, Badge, Field, EmptyState, FieldList, SectionHeading, Surface } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import Link from "next/link";
import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository, type PublicDelegationRecord } from "@/db/repositories/delegation";
import { getI18n } from "@/app/i18n/server";
import type { Locale } from "@/app/i18n/config";
import type { Translator } from "@/app/i18n/translate";

export const dynamic = "force-dynamic";

export default async function DelegationPage({ params }: { params: Promise<{ id: string }> }) {
  const { t, locale } = await getI18n();
  const { id } = await params;
  let delegation: PublicDelegationRecord | null = null;
  let unavailable: boolean | null = null;
  try {
    delegation = await getDelegationRepository().getPublicDelegation(id);
  } catch (error) {
    unavailable = error instanceof MissingDatabaseBindingError;
  }

  if (unavailable !== null) return <DelegationUnavailable unavailable={unavailable} t={t} />;
  if (!delegation) return <DelegationNotFound id={id} t={t} />;
  return <DelegationDocument delegation={delegation} t={t} locale={locale} />;
}

function DelegationDocument({ delegation, t, locale }: { delegation: PublicDelegationRecord; t: Translator; locale: Locale }) {
  const status = delegationStatus(delegation, t, locale);
  const { certificate, evidence, signer } = delegation;
  return (
    <SiteFrame className="site-shell app-shell" active="workbench" mainClassName="page-main receipt-main">
        <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/workbench">{t("nav.primary.workspace")}</Link><span> / </span><span>{t("delegations.breadcrumb.certificate")}</span></Breadcrumb>
        <SectionHeading as="section" className="receipt-heading">
          <div>
            <p className="eyebrow">{t("delegations.eyebrow")}</p>
            <PageTitle>{t("delegations.title")}</PageTitle>
            <p>{t("delegations.body")}</p>
          </div>
          <Badge className="record-chip">{status.label}</Badge>
        </SectionHeading>
        <section className="receipt-summary">
          <div><span>{t("delegations.summary.certificate")}</span><code>{certificate.id}</code></div>
          <div><span>{t("delegations.summary.person")}</span><code>{certificate.attributionPolicy.beneficiaryPersonId}</code></div>
          <div><span>{t("delegations.summary.agent")}</span><code>{certificate.agentId}</code></div>
          <div><span>{t("delegations.summary.window")}</span><strong>{formatDateTime(certificate.validFrom, locale)} → {formatDateTime(certificate.validUntil, locale)}</strong></div>
        </section>
        <section className="receipt-grid">
          <Surface as="article" className="receipt-card">
            <p className="eyebrow">{t("delegations.authority.eyebrow")}</p>
            <DelegationGate label={t("delegations.gate.certificate")} detail={t("delegations.gate.certificateDetail")} />
            <DelegationGate label={t("delegations.gate.scopes")} detail={certificate.scopes.join(" · ")} />
            <DelegationGate label={t("delegations.gate.signerKey")} detail={signer.keyId} />
            <DelegationGate label={t("delegations.gate.current")} detail={status.detail} state={status.revoked ? "revoked" : "verified"} />
            {delegation.revocation && <div className="delegation-revocation-record"><span className="micro-label">{t("delegations.revocation.recorded")}</span><strong>{formatDateTime(delegation.revocation.revokedAt, locale)}</strong><p>{delegation.revocation.reason}</p></div>}
            {signer.keyRevocation && <div className="delegation-revocation-record"><span className="micro-label">{t("delegations.revocation.key")}</span><strong>{formatDateTime(signer.keyRevocation.revokedAt, locale)}</strong><p>{signer.keyRevocation.reason ?? t("delegations.revocation.noReason")}</p></div>}
          </Surface>
          <Surface as="article" className="receipt-card receipt-machine">
            <p className="eyebrow">{t("delegations.machine.eyebrow")}</p>
            <FieldList>
              <Field label={t("delegations.field.protocol")}><code>{delegation.protocolVersion}</code></Field>
              <Field label={t("delegations.field.fingerprint")}><code>{signer.fingerprint}</code></Field>
              <Field label={t("delegations.field.publicKey")}><code>{signer.publicKey}</code></Field>
              <Field label={t("delegations.field.agentKey")}><code>{certificate.agentPublicKey}</code></Field>
              <Field label={t("delegations.field.payloadHash")}><code>{evidence.payloadHash}</code></Field>
              <Field label={t("delegations.field.signature")}><code>{evidence.personSignature}</code></Field>
              <Field label={t("delegations.field.recorded")}><code>{formatDateTime(delegation.recordedAt, locale)}</code></Field>
              <Field label={t("delegations.field.json")}><Link className="text-link" href={`/api/delegations/${encodeURIComponent(certificate.id)}`}>{t("delegations.openJson")} <span>→</span></Link></Field>
            </FieldList>
          </Surface>
        </section>
        <p className="receipt-note">{t("delegations.note")}</p>
      </SiteFrame>
  );
}

function DelegationGate({ label, detail, state = "verified" }: { label: string; detail: string; state?: "verified" | "revoked" }) {
  return <div className="receipt-state"><span className={state === "revoked" ? "pending-dot" : "accepted-dot"} /><span>{label}</span><strong className="receipt-state-detail">{detail}</strong></div>;
}

function DelegationNotFound({ id, t }: { id: string; t: Translator }) {
  return <DelegationMessage title={t("delegations.notFound.title")} detail={t("delegations.notFound.detail")} id={id} t={t} />;
}

function DelegationUnavailable({ unavailable, t }: { unavailable: boolean; t: Translator }) {
  return <DelegationMessage title={t("delegations.unavailable.title")} detail={unavailable ? t("delegations.unavailable.storage") : t("delegations.unavailable.verify")} t={t} />;
}

function DelegationMessage({ title, detail, id, t }: { title: string; detail: string; id?: string; t: Translator }) {
  return (
    <SiteFrame className="site-shell app-shell" active="workbench" mainClassName="page-main receipt-main">
        <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/workbench">{t("nav.primary.workspace")}</Link><span> / </span><span>{t("delegations.breadcrumb.certificate")}</span></Breadcrumb>
        <SectionHeading as="section" className="receipt-heading"><div><p className="eyebrow">{t("delegations.message.eyebrow")}</p><PageTitle>{title}</PageTitle><p>{detail}</p></div><Badge className="record-chip">{id ? t("delegations.notFound.badge") : t("delegations.unavailable.badge")}</Badge></SectionHeading>
        {id && <EmptyState as="section" className="receipt-card receipt-message"><p className="eyebrow">{t("delegations.requestedLabel")}</p><code>{id}</code><Link className="text-link" href="/how-it-works">{t("delegations.readModel")} <span>→</span></Link></EmptyState>}
      </SiteFrame>
  );
}

function delegationStatus(delegation: PublicDelegationRecord, t: Translator, locale: Locale) {
  if (delegation.revocation) {
    return { label: t("delegations.status.revoked"), detail: t("delegations.status.revokedAt", { time: formatDateTime(delegation.revocation.revokedAt, locale) }), revoked: true };
  }
  const now = Date.now();
  if (delegation.signer.keyRevocation && Date.parse(delegation.signer.keyRevocation.revokedAt) <= now) {
    return { label: t("delegations.status.signerRevoked"), detail: t("delegations.status.signerRevokedAt", { time: formatDateTime(delegation.signer.keyRevocation.revokedAt, locale) }), revoked: true };
  }
  if (Date.parse(delegation.certificate.validFrom) > now) {
    return { label: t("delegations.status.notYet"), detail: t("delegations.status.validFrom", { time: formatDateTime(delegation.certificate.validFrom, locale) }), revoked: false };
  }
  if (Date.parse(delegation.certificate.validUntil) <= now) {
    return { label: t("delegations.status.expired"), detail: t("delegations.status.expiredAt", { time: formatDateTime(delegation.certificate.validUntil, locale) }), revoked: false };
  }
  return { label: t("delegations.status.active"), detail: t("delegations.status.activeDetail"), revoked: false };
}

function formatDateTime(value: string, locale: Locale) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(timestamp)
    : value;
}
