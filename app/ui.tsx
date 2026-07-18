import type { ReactNode } from "react";
import type { CatalogDisplayStatus } from "@/packages/domain/catalog";

export type ProductStateTone = "available" | "provisional" | "verified" | "not-deployed";

export function ProductStateBadge({ tone, children }: { tone: ProductStateTone; children: ReactNode }) {
  return <span className={`product-state product-state-${tone}`}>{children}</span>;
}

export function Footer() {
  return (
    <footer className="site-footer site-footer-compact">
      <div className="footer-intro">
        <div className="brand footer-brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>Proofweave</span></div>
        <p>An open network for personally delegated formal mathematics research.</p>
      </div>
      <p className="footer-compact-note">Open formal mathematics · Evidence before claims</p>
    </footer>
  );
}

export type PageSectionLink = {
  href: string;
  label: string;
};

export function PageSectionNav({
  links,
  label = "On this page",
  tone = "light",
}: {
  links: readonly PageSectionLink[];
  label?: string;
  tone?: "light" | "dark";
}) {
  return <nav className={`page-section-nav page-section-nav-${tone}`} aria-label={label}>
    <span>{label}</span>
    <div>{links.map((link) => <a href={link.href} key={link.href}>{link.label}</a>)}</div>
  </nav>;
}

const stateClass: Record<CatalogDisplayStatus, string> = {
  "Formalized statement": "state-formalized",
  "Open proof branch": "state-open",
  "Kernel accepted": "state-kernel",
  "Statement fidelity reviewed": "state-review",
  "Independent review": "state-review",
  "No Proofweave attestation": "state-unverified",
};

export function StatusStack({ statuses, compact = false }: { statuses: readonly CatalogDisplayStatus[]; compact?: boolean }) {
  return <div className={compact ? "status-stack compact" : "status-stack"} aria-label="Verification states">{statuses.map((status) => <span className={stateClass[status]} key={status}><i aria-hidden="true" />{status}</span>)}</div>;
}
