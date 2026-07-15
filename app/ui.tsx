import Link from "next/link";
import type { ReactNode } from "react";
import type { CatalogDisplayStatus } from "@/packages/domain/catalog";
import { footerNavigation, primaryNavigation, type ActivePage } from "./lib/navigation";
import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from "./chatgpt-auth";

export async function Header({ active }: { active: ActivePage }) {
  const user = await getChatGPTUser();
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
          {user
            ? <details className={active === "profile" || active === "settings" ? "account-menu is-active" : "account-menu"}>
              <summary aria-label={`Open account menu for ${user.displayName}`}><span className="account-avatar" aria-hidden="true">{initials(user.displayName)}</span><span className="account-menu-name">{user.displayName}</span><span className="account-chevron" aria-hidden="true">⌄</span></summary>
              <div className="account-popover">
                <div className="account-popover-identity"><strong>{user.displayName}</strong><span>{user.email}</span></div>
                <Link href="/profile">My profile <span>→</span></Link>
                <Link href="/workbench">Workspace <span>→</span></Link>
                <Link href="/reviews">Verification work <span>→</span></Link>
                <Link href="/settings">Agent settings <span>→</span></Link>
                <Link className="account-sign-out" href={chatGPTSignOutPath("/")}>Sign out <span>→</span></Link>
              </div>
            </details>
            : <Link className="header-sign-in" href={chatGPTSignInPath("/profile")}>Sign in</Link>}
        </div>
      </header>
    </>
  );
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "PW";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
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
