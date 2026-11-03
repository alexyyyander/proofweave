"use client";

import Link from "next/link";
import { useI18n } from "@/app/i18n/client";

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
  const { t } = useI18n();
  return <nav className="workspace-personal-links" aria-label={t("workspace.navAria")}>
    <WorkspaceLink active={active === "workbench"} href="/workbench" label={t("workspace.nav.myWork")} value={activeAttemptCount} />
    <WorkspaceLink active={active === "reviews"} href="/reviews#my-review-work" label={t("workspace.nav.reviewWork")} value={activeReviewCount} />
    <WorkspaceLink active={active === "evidence"} href="/evidence" label={t("workspace.nav.evidence")} value={evidenceCount} />
    <WorkspaceLink active={active === "profile"} href="/profile" label={t("workspace.nav.profile")} />
    <WorkspaceLink active={active === "settings"} href="/settings" label={t("workspace.nav.settings")} />
  </nav>;
}

function WorkspaceLink({ active, href, label, value }: { active: boolean; href: string; label: string; value?: number | null }) {
  return <Link className={active ? "is-current" : ""} href={href} aria-current={active ? "page" : undefined}>
    <span>{label}</span>
    <b>{typeof value === "number" ? value : "↗"}</b>
  </Link>;
}
