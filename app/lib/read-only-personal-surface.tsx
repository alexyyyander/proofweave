import { PageTitle, ActionLink } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";
import { type ReactNode } from "react";

import { getParticipantOperationState } from "@/db";

import { type ActivePage } from "./navigation";
import { getI18n } from "@/app/i18n/server";

export function personalWritesPaused(): boolean {
  return !getParticipantOperationState().writesEnabled;
}

export async function ReadOnlyPersonalSurface({
  active,
  eyebrow,
  title,
  detail,
  children,
}: {
  active: ActivePage;
  eyebrow: string;
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  const { t } = await getI18n();
  return <SiteFrame className="site-shell app-shell" active={active} mainClassName="workbench-main signed-out-workbench">
      <section className="workspace-onboarding" aria-labelledby="read-only-personal-title">
        <div className="workspace-onboarding-copy">
          <p className="eyebrow">{eyebrow}</p>
          <PageTitle id="read-only-personal-title">{title}</PageTitle>
          <p>{detail}</p>
          <div className="button-row">
            <ActionLink className="button button-primary" href="/explore">{t("readOnly.browse")} <span aria-hidden="true">→</span></ActionLink>
            <ActionLink className="button button-secondary" href="/demo">{t("readOnly.demo")}</ActionLink>
          </div>
        </div>
        <ol className="workspace-onboarding-steps" aria-label={t("readOnly.aria")}>
          <li><span>01</span><div><strong>{t("readOnly.public.title")}</strong><p>{t("readOnly.public.body")}</p></div></li>
          <li><span>02</span><div><strong>{t("readOnly.nochange.title")}</strong><p>{t("readOnly.nochange.body")}</p></div></li>
          <li><span>03</span><div><strong>{t("readOnly.resume.title")}</strong><p>{t("readOnly.resume.body")}</p></div></li>
        </ol>
      </section>
      {children}
    </SiteFrame>;
}
