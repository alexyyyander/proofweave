import { PageTitle, ActionLink } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";
import { type ReactNode } from "react";

import { getParticipantOperationState } from "@/db";

import { type ActivePage } from "./navigation";

export function personalWritesPaused(): boolean {
  return !getParticipantOperationState().writesEnabled;
}

export function ReadOnlyPersonalSurface({
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
  return <SiteFrame className="site-shell app-shell" active={active} mainClassName="workbench-main signed-out-workbench">
      <section className="workspace-onboarding" aria-labelledby="read-only-personal-title">
        <div className="workspace-onboarding-copy">
          <p className="eyebrow">{eyebrow}</p>
          <PageTitle id="read-only-personal-title">{title}</PageTitle>
          <p>{detail}</p>
          <div className="button-row">
            <ActionLink className="button button-primary" href="/explore">Browse public research <span aria-hidden="true">→</span></ActionLink>
            <ActionLink className="button button-secondary" href="/demo">Open verified demo</ActionLink>
          </div>
        </div>
        <ol className="workspace-onboarding-steps" aria-label="What remains available">
          <li><span>01</span><div><strong>Public research remains readable</strong><p>Statements, cited sources, and published verification states are still available.</p></div></li>
          <li><span>02</span><div><strong>No personal record is changed</strong><p>Proofweave does not create placeholder identities, assignments, evidence, or connections during maintenance.</p></div></li>
          <li><span>03</span><div><strong>Resume after maintenance</strong><p>Personal controls return only after the durable control plane can record the complete action safely.</p></div></li>
        </ol>
      </section>
      {children}
    </SiteFrame>;
}
