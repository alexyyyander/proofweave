import Link from "next/link";
import type { ReactNode } from "react";
import type { CatalogDisplayStatus } from "@/packages/domain/catalog";
import { footerNavigationGroups } from "./lib/navigation";

export type ProductStateTone = "available" | "provisional" | "verified" | "not-deployed";

export function ProductStateBadge({ tone, children }: { tone: ProductStateTone; children: ReactNode }) {
  return <span className={`product-state product-state-${tone}`}>{children}</span>;
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-intro">
        <div className="brand footer-brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>Proofweave</span></div>
        <p>An open network for personally delegated formal mathematics research.</p>
      </div>
      <nav className="footer-groups" aria-label="Footer navigation">
        {footerNavigationGroups.map((group) => <div key={group.label}><strong>{group.label}</strong>{group.items.map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}</div>)}
      </nav>
    </footer>
  );
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
