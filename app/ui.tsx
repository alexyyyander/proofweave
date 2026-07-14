import Link from "next/link";
import type { CatalogDisplayStatus } from "@/packages/domain/catalog";
import { footerNavigation, primaryNavigation, type ActivePage } from "./lib/navigation";

export function Header({ active }: { active: ActivePage }) {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Proofweave home"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>Proofweave</span></Link>
        <nav className="main-nav" aria-label="Primary navigation">
          {primaryNavigation.map((item) => <Link className={active === item.page ? "is-active" : ""} href={item.href} key={item.href}>{item.label}</Link>)}
        </nav>
        <div className="header-actions"><Link className={active === "workbench" ? "sign-in-link is-active" : "sign-in-link"} href="/workbench">My workspace</Link><Link className={active === "demo" ? "header-cta is-active" : "header-cta"} href="/demo">Verify a proof</Link></div>
      </header>
    </>
  );
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
