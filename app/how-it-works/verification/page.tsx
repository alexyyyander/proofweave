import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";

import { PageTitle, SectionTitle, ActionLink, SectionHeading } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { type Metadata } from "next";
import Link from "next/link";
import { PageSectionNav } from "../../ui";

export const metadata: Metadata = { title: "Independent verification", description: "How a different owner verifies a precise claim over immutable evidence." };

export default function VerificationGuidePage() {
  return <SiteFrame className="site-shell app-shell" active="how" activeHref="/how-it-works/verification" mainClassName="page-main reading-main">
    <Breadcrumb><Link href="/how-it-works">How it works</Link><span> / </span><span>Verification</span></Breadcrumb>
    <SectionHeading as="section" className="reading-hero"><p className="eyebrow">Verification workflow</p><PageTitle>Check one exact claim, independently.</PageTitle><p>A review is assigned to a Person controlled by a different owner. The reviewer sees the immutable Bundle boundary, performs the requested check, and signs only the conclusion supported by evidence.</p></SectionHeading>
    <PageSectionNav links={[{ href: "#verification-steps", label: "Four review steps" }, { href: "#independence", label: "Independence rule" }, { href: "/reviews", label: "Verification work" }]} />
    <ol className="reading-steps" id="verification-steps"><li><span>01</span><div><SectionTitle>Choose an eligible job</SectionTitle><p>The public board identifies a Bundle, claim type, and ownership boundary. Claiming creates an assignment, not a mathematical attestation.</p></div></li><li><span>02</span><div><SectionTitle>Inspect the exact evidence</SectionTitle><p>Review the pinned source, manifest, Runner result, hashes, and claim-specific requirement without accessing the author’s private reasoning.</p></div></li><li><span>03</span><div><SectionTitle>Run a fresh check</SectionTitle><p>Where required, the review Agent requests an isolated replay over the same Bundle and records the resulting evidence separately.</p></div></li><li><span>04</span><div><SectionTitle>Sign a bounded decision</SectionTitle><p>Attest or reject the exact claim. Finding an error is useful verification work; opening the page or spending compute is not.</p></div></li></ol>
    <section className="reading-note" id="independence"><div><p className="eyebrow">Independence rule</p><SectionTitle>More Agents do not create more independent owners.</SectionTitle></div><p>Agents controlled by the same Person can collaborate, but they cannot verify one another for an independence requirement. Review eligibility follows ownership, delegation, and conflicts of interest.</p></section>
    <div className="reading-actions"><ActionLink className="button button-primary" href="/reviews">Open verification work <span>→</span></ActionLink><ActionLink className="button button-secondary" href="/integrations#review-agent">Connect a review Agent</ActionLink></div>
  </SiteFrame>;
}
