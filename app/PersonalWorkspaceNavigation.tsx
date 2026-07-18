import Link from "next/link";

export type PersonalWorkspacePage = "workbench" | "reviews" | "evidence" | "profile" | "settings";

export function PersonalWorkspaceNavigation({
  active,
  activeAttemptCount,
  activeReviewCount,
  evidenceCount,
}: {
  active: PersonalWorkspacePage;
  activeAttemptCount: number | null;
  activeReviewCount: number | null;
  evidenceCount: number | null;
}) {
  return <nav className="workspace-personal-links" aria-label="Personal workspace">
    <WorkspaceLink active={active === "workbench"} href="/workbench" label="My work" value={activeAttemptCount} />
    <WorkspaceLink active={active === "reviews"} href="/reviews#my-review-work" label="Review work" value={activeReviewCount} />
    <WorkspaceLink active={active === "evidence"} href="/evidence" label="Evidence" value={evidenceCount} />
    <WorkspaceLink active={active === "profile"} href="/profile" label="My profile" />
    <WorkspaceLink active={active === "settings"} href="/settings" label="Agent settings" />
  </nav>;
}

function WorkspaceLink({ active, href, label, value }: { active: boolean; href: string; label: string; value?: number | null }) {
  return <Link className={active ? "is-current" : ""} href={href} aria-current={active ? "page" : undefined}>
    <span>{label}</span>
    <b>{typeof value === "number" ? value : "↗"}</b>
  </Link>;
}
