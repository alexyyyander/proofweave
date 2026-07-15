import Link from "next/link";
import type { ReactNode } from "react";
import type { CatalogDisplayStatus } from "@/packages/domain/catalog";
import { footerNavigation, primaryNavigation, type ActivePage } from "./lib/navigation";

export function Header({ active }: { active: ActivePage }) {
  const workspaceActive = active === "workbench" || active === "review";

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Proofweave home"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>Proofweave</span></Link>
        <nav className="main-nav" aria-label="Primary navigation">
          {primaryNavigation.map((item) => <Link className={active === item.page ? "is-active" : ""} href={item.href} key={item.href}>{item.label}</Link>)}
        </nav>
        <div className="header-actions">
          <Link className={workspaceActive ? "sign-in-link is-active" : "sign-in-link"} href="/workbench">Workspace</Link>
          <Link className={active === "settings" ? "settings-link is-active" : "settings-link"} href="/settings">Settings</Link>
          <Link className={active === "demo" ? "mobile-demo-link is-active" : "mobile-demo-link"} href="/demo" aria-label="Open the verified proof demo"><span className="mobile-demo-link-long">Verified demo</span><span className="mobile-demo-link-short">Verify</span></Link>
        </div>
      </header>
    </>
  );
}

export type ProductStateTone = "available" | "provisional" | "verified" | "not-deployed";

export function ProductStateBadge({ tone, children }: { tone: ProductStateTone; children: ReactNode }) {
  return <span className={`product-state product-state-${tone}`}>{children}</span>;
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="brand footer-brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>Proofweave</span></div>
      <p>An open network for personally delegated formal mathematics research.</p>
      <div>{footerNavigation.map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}</div>
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
