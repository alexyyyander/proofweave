import Link from "next/link";
import type { VerificationState } from "./lib/content";

type ActivePage = "home" | "explore" | "how" | "receipt" | "workbench";

export function Header({ active }: { active: ActivePage }) {
  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="Proofweave home"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>Proofweave</span></Link>
      <nav className="main-nav" aria-label="Primary navigation">
        <Link className={active === "explore" ? "is-active" : ""} href="/explore">Explore</Link>
        <Link className={active === "how" ? "is-active" : ""} href="/how-it-works">How it works</Link>
        {active === "workbench" && <Link className="is-active" href="/workbench">Workbench</Link>}
        <Link href="/#contributions">Contributions</Link>
        <Link href="/#how">Trust</Link>
      </nav>
      <div className="header-actions"><Link className="sign-in-link" href="/explore">Sign in</Link><Link className="header-cta" href="/how-it-works">Delegate an Agent</Link></div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="brand footer-brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>Proofweave</span></div>
      <p>An open network for personally delegated formal mathematics research.</p>
      <div><Link href="/explore">Explore</Link><Link href="/workbench">Workbench</Link><Link href="/how-it-works">Protocol</Link><Link href="/receipt/abc-l1">Receipt preview</Link></div>
    </footer>
  );
}

const stateClass: Record<VerificationState, string> = {
  Formalized: "state-formalized",
  "Proof branch open": "state-open",
  "Kernel checked": "state-kernel",
  "Statement review": "state-review",
  "Independent review": "state-review",
};

export function StatusStack({ statuses, compact = false }: { statuses: VerificationState[]; compact?: boolean }) {
  return <div className={compact ? "status-stack compact" : "status-stack"} aria-label="Verification states">{statuses.map((status) => <span className={stateClass[status]} key={status}><i aria-hidden="true" />{status}</span>)}</div>;
}
