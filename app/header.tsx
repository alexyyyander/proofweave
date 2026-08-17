import Link from "next/link";
import { getCurrentUser, providerAwareSignOutPath, signInPath } from "./auth";
import { navigationGroups, primaryNavigation, type ActivePage } from "./lib/navigation";

export async function Header({ active, activeHref }: { active: ActivePage; activeHref?: string }) {
  const user = await getCurrentUser();

  return <>
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <header className="site-header">
      <Link className="brand" href="/" aria-label="Proofweave home"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>Proofweave</span></Link>
      <nav className="main-nav" aria-label="Primary navigation">
        {primaryNavigation.map((item) => <Link aria-current={active === item.page ? "page" : undefined} className={active === item.page ? "is-active" : ""} href={item.href} key={item.href}>{item.label}</Link>)}
      </nav>
      <div className="header-actions">
        <details className="site-directory-menu" name="header-overlays">
          <summary aria-label="Open Proofweave directory"><span>Menu</span><i aria-hidden="true">⌄</i></summary>
          <div className="site-directory-popover">
            <div className="site-directory-intro">
              <strong>Directory</strong>
              <p>Five core surfaces. Supporting modules stay task-oriented.</p>
              <small>Use the core pages to orient, act, inspect, and understand.</small>
            </div>
            <nav className="site-directory-groups" aria-label="Proofweave menu">
              {navigationGroups.map((group) => <div key={group.label}>
                <strong>{group.label}</strong>
                {group.items.map((item) => {
                  const isActive = navigationItemActive(active, item.href, activeHref);
                  return <Link aria-current={isActive ? "page" : undefined} className={isActive ? "is-active" : ""} href={item.href} key={item.href}>{item.label}<span aria-hidden="true">→</span></Link>;
                })}
              </div>)}
            </nav>
          </div>
        </details>
        {user
          ? <details className={active === "profile" || active === "settings" ? "account-menu is-active" : "account-menu"} name="header-overlays">
            <summary aria-label={`Open account menu for ${user.displayName}`}><span className="account-avatar" aria-hidden="true">{initials(user.displayName)}</span><span className="account-menu-name">{user.displayName}</span><span className="account-chevron" aria-hidden="true">⌄</span></summary>
            <div className="account-popover">
              <div className="account-popover-identity"><strong>{user.displayName}</strong><span>{user.email} · {user.providerLabel}</span></div>
              <Link href="/profile">My profile <span>→</span></Link>
              <Link href="/reviews">My reviews <span>→</span></Link>
              <Link href="/settings">Agent settings <span>→</span></Link>
              <Link className="account-sign-out" href={providerAwareSignOutPath(user, "/")}>Sign out <span>→</span></Link>
            </div>
          </details>
          : <Link className="header-sign-in" href={signInPath("/profile")}>Sign in</Link>}
      </div>
    </header>
  </>;
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "PW";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
}

function navigationItemActive(active: ActivePage, href: string, activeHref?: string) {
  if (activeHref) return activeHref === href;
  const activeRootHref: Partial<Record<ActivePage, string>> = {
    home: "/",
    about: "/about",
    demo: "/demo",
    explore: "/explore",
    history: "/history",
    how: "/how-it-works",
    profile: "/profile",
    receipt: "/receipts",
    review: "/reviews",
    settings: "/settings",
    showcase: "/showcase",
    workbench: "/workbench",
  };
  return activeRootHref[active] === href;
}
