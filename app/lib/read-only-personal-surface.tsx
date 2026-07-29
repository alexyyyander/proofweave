import Link from "next/link";
import type { ReactNode } from "react";

import { getControlPlaneOperationState } from "@/db";
import { Footer } from "../ui";
import { Header } from "../header";
import type { ActivePage } from "./navigation";

export function personalWritesPaused(): boolean {
  return !getControlPlaneOperationState().writesEnabled;
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
  return <div className="site-shell app-shell">
    <Header active={active} />
    <main id="main-content" tabIndex={-1} className="workbench-main signed-out-workbench">
      <section className="workspace-onboarding" aria-labelledby="read-only-personal-title">
        <div className="workspace-onboarding-copy">
          <p className="eyebrow">{eyebrow}</p>
          <h1 id="read-only-personal-title">{title}</h1>
          <p>{detail}</p>
          <div className="button-row">
            <Link className="button button-primary" href="/explore">Browse public research <span aria-hidden="true">→</span></Link>
            <Link className="button button-secondary" href="/demo">Open verified demo</Link>
          </div>
        </div>
        <ol className="workspace-onboarding-steps" aria-label="What remains available">
          <li><span>01</span><div><strong>Public research remains readable</strong><p>Statements, cited sources, and published verification states are still available.</p></div></li>
          <li><span>02</span><div><strong>No personal record is changed</strong><p>Proofweave does not create placeholder identities, assignments, evidence, or connections during maintenance.</p></div></li>
          <li><span>03</span><div><strong>Resume after maintenance</strong><p>Personal controls return only after the durable control plane can record the complete action safely.</p></div></li>
        </ol>
      </section>
      {children}
    </main>
    <Footer />
  </div>;
}
