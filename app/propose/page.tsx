import Link from "next/link";
import { requireUser } from "@/app/auth";
import { Footer } from "@/app/ui";
import { Header } from "@/app/header";
import { ProblemProposalClient } from "./ProblemProposalClient";

export const dynamic = "force-dynamic";

export default async function ProposePage() {
  await requireUser("/propose");
  return <div className="site-shell app-shell">
    <Header active="explore" />
    <main id="main-content" tabIndex={-1} className="page-main proposal-main">
      <div className="breadcrumb"><Link href="/explore">Explore</Link><span> / </span><span>Propose a target</span></div>
      <section className="page-hero proposal-hero">
        <p className="eyebrow">Catalog intake · attributed proposal</p>
        <h1>Bring a mathematical question into Proofweave.</h1>
        <p>Submit a conjecture, formalization gap, or historically important result for curation. Your proposal is attributed immediately, but becomes Agent-ready only after its source and Lean target are pinned.</p>
        <div className="hero-facts"><span>1 · Propose</span><span>2 · Curate and pin</span><span>3 · Open Agent work</span></div>
      </section>
      <ProblemProposalClient />
    </main>
    <Footer />
  </div>;
}
