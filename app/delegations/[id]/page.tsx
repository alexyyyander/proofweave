import Link from "next/link";
import { MissingDatabaseBindingError } from "@/db";
import {
  getDelegationRepository,
  type PublicDelegationRecord,
} from "@/db/repositories/delegation";
import { Footer } from "../../ui";
import { Header } from "../../header";

export const dynamic = "force-dynamic";

export default async function DelegationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let delegation: PublicDelegationRecord | null = null;
  let unavailable: boolean | null = null;
  try {
    delegation = await getDelegationRepository().getPublicDelegation(id);
  } catch (error) {
    unavailable = error instanceof MissingDatabaseBindingError;
  }

  if (unavailable !== null) return <DelegationUnavailable unavailable={unavailable} />;
  if (!delegation) return <DelegationNotFound id={id} />;
  return <DelegationDocument delegation={delegation} />;
}

function DelegationDocument({ delegation }: { delegation: PublicDelegationRecord }) {
  const status = delegationStatus(delegation);
  const { certificate, evidence, signer } = delegation;
  return (
    <div className="site-shell app-shell">
      <Header active="workbench" />
      <main id="main-content" tabIndex={-1} className="page-main receipt-main">
        <div className="breadcrumb"><Link href="/workbench">Workbench</Link><span> / </span><span>Delegation certificate</span></div>
        <section className="receipt-heading">
          <div>
            <p className="eyebrow">Public delegation record · signature rechecked</p>
            <h1>Delegation certificate</h1>
            <p>This is a signed authority record for one Person and Agent. It is not a proof result, independent review, or Contribution Receipt.</p>
          </div>
          <span className="record-chip">{status.label}</span>
        </section>
        <section className="receipt-summary">
          <div><span>Certificate</span><code>{certificate.id}</code></div>
          <div><span>Attributed Person</span><code>{certificate.attributionPolicy.beneficiaryPersonId}</code></div>
          <div><span>Delegated Agent</span><code>{certificate.agentId}</code></div>
          <div><span>Authority window</span><strong>{certificate.validFrom} → {certificate.validUntil}</strong></div>
        </section>
        <section className="receipt-grid">
          <article className="receipt-card">
            <p className="eyebrow">Authority and status</p>
            <DelegationGate label="Signed certificate" detail="Canonical payload and Ed25519 signature verified" />
            <DelegationGate label="Granted scopes" detail={certificate.scopes.join(" · ")} />
            <DelegationGate label="Signer key" detail={signer.keyId} />
            <DelegationGate label="Current authority" detail={status.detail} state={status.revoked ? "revoked" : "verified"} />
            {delegation.revocation && <div className="delegation-revocation-record"><span className="micro-label">Recorded revocation</span><strong>{delegation.revocation.revokedAt}</strong><p>{delegation.revocation.reason}</p></div>}
            {signer.keyRevocation && <div className="delegation-revocation-record"><span className="micro-label">Signer key revocation</span><strong>{signer.keyRevocation.revokedAt}</strong><p>{signer.keyRevocation.reason ?? "Historical key state is recorded without a public reason."}</p></div>}
          </article>
          <article className="receipt-card receipt-machine">
            <p className="eyebrow">Machine-verifiable evidence</p>
            <dl>
              <div><dt>Protocol</dt><dd><code>{delegation.protocolVersion}</code></dd></div>
              <div><dt>Signer fingerprint</dt><dd><code>{signer.fingerprint}</code></dd></div>
              <div><dt>Signer public key</dt><dd><code>{signer.publicKey}</code></dd></div>
              <div><dt>Agent public key</dt><dd><code>{certificate.agentPublicKey}</code></dd></div>
              <div><dt>Payload hash</dt><dd><code>{evidence.payloadHash}</code></dd></div>
              <div><dt>Person signature</dt><dd><code>{evidence.personSignature}</code></dd></div>
              <div><dt>Recorded</dt><dd><code>{delegation.recordedAt}</code></dd></div>
              <div><dt>Canonical JSON</dt><dd><Link className="text-link" href={`/api/delegations/${encodeURIComponent(certificate.id)}`}>Open delegation JSON <span>→</span></Link></dd></div>
            </dl>
          </article>
        </section>
        <p className="receipt-note">The JSON representation includes the exact canonical payload and public signer key needed to verify the signature. It deliberately omits provider identities, display names, private keys, Agent credentials, and private reasoning.</p>
      </main>
      <Footer />
    </div>
  );
}

function DelegationGate({ label, detail, state = "verified" }: { label: string; detail: string; state?: "verified" | "revoked" }) {
  return <div className="receipt-state"><span className={state === "revoked" ? "pending-dot" : "accepted-dot"} /><span>{label}</span><strong className="receipt-state-detail">{detail}</strong></div>;
}

function DelegationNotFound({ id }: { id: string }) {
  return <DelegationMessage title="Delegation not found" detail="No stored delegation certificate exists for this identifier." id={id} />;
}

function DelegationUnavailable({ unavailable }: { unavailable: boolean }) {
  return <DelegationMessage title="Delegation record unavailable" detail={unavailable ? "Delegation storage is not configured in this environment." : "The stored evidence could not be verified for display. Please try again later."} />;
}

function DelegationMessage({ title, detail, id }: { title: string; detail: string; id?: string }) {
  return (
    <div className="site-shell app-shell">
      <Header active="workbench" />
      <main id="main-content" tabIndex={-1} className="page-main receipt-main">
        <div className="breadcrumb"><Link href="/workbench">Workbench</Link><span> / </span><span>Delegation certificate</span></div>
        <section className="receipt-heading"><div><p className="eyebrow">Public delegation record</p><h1>{title}</h1><p>{detail}</p></div><span className="record-chip">{id ? "Not found" : "Unavailable"}</span></section>
        {id && <section className="receipt-card receipt-message"><p className="eyebrow">Requested certificate ID</p><code>{id}</code><Link className="text-link" href="/how-it-works">Read the delegation model <span>→</span></Link></section>}
      </main>
      <Footer />
    </div>
  );
}

function delegationStatus(delegation: PublicDelegationRecord) {
  if (delegation.revocation) {
    return { label: "Revoked", detail: `Revoked at ${delegation.revocation.revokedAt}`, revoked: true };
  }
  const now = Date.now();
  if (delegation.signer.keyRevocation && Date.parse(delegation.signer.keyRevocation.revokedAt) <= now) {
    return { label: "Signer key revoked", detail: `Signer key revoked at ${delegation.signer.keyRevocation.revokedAt}`, revoked: true };
  }
  if (Date.parse(delegation.certificate.validFrom) > now) {
    return { label: "Not yet valid", detail: `Valid from ${delegation.certificate.validFrom}`, revoked: false };
  }
  if (Date.parse(delegation.certificate.validUntil) <= now) {
    return { label: "Expired", detail: `Expired at ${delegation.certificate.validUntil}`, revoked: false };
  }
  return { label: "Active", detail: "Within its recorded validity window", revoked: false };
}
