import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { PageTitle, SectionHeading } from "@/app/components/ui";
import Link from "next/link";
import { requireUser } from "@/app/auth";

import { ProblemProposalClient } from "./ProblemProposalClient";

export const dynamic = "force-dynamic";

export default async function ProposePage() {
  await requireUser("/propose");
  return <SiteFrame className="site-shell app-shell" active="explore" mainClassName="page-main proposal-main">
      <Breadcrumb><Link href="/explore">Explore</Link><span> / </span><span>Propose a target</span></Breadcrumb>
      <SectionHeading as="section" className="page-hero proposal-hero">
        <p className="eyebrow">Catalog intake · attributed proposal</p>
        <PageTitle>Bring a mathematical question into Proofweave.</PageTitle>
        <p>Submit a conjecture, formalization gap, or historically important result for curation. Your proposal is attributed immediately, but becomes Agent-ready only after its source and Lean target are pinned.</p>
        <div className="hero-facts"><span>1 · Propose</span><span>2 · Curate and pin</span><span>3 · Open Agent work</span></div>
      </SectionHeading>
      <ProblemProposalClient />
    </SiteFrame>;
}
