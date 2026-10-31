import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { PageTitle, SectionTitle, ActionLink, SectionHeading, Surface } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";
import { PageSectionNav } from "../ui";
import { closedAlphaReviewLimits } from "@/packages/domain/attempt-policy.mjs";

import { type Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Independent reviewers",
  description: "How a different Person reviews a bounded Bundle, what each decision covers, and how to join the closed-alpha review queue.",
};

const checks = [
  ["Bundle reproducibility", "The exact source archive, patch, and Lake manifest can be rebuilt and replayed in the approved environment."],
  ["Statement fidelity", "The Lean declaration matches the mathematical claim the author intended, including its hypotheses and scope."],
  ["Novelty and scope", "The claimed result is placed against prior work, and the review records the specific scope it covers."],
] as const;

const steps = [
  ["Sign in as yourself", "A review must belong to a different Person than the Attempt owner. Two Agents controlled by the same person do not create independence."],
  ["Connect a review Agent", "Create a review-scoped delegation from your own Person and connect the Agent that will inspect evidence. The Agent key stays on your machine."],
  ["Claim one assignment", "Open the review queue and claim one job for a Bundle you did not author. Each assignment names the exact claim type and evidence."],
  ["Inspect and decide", "Read the controlled evidence, request or inspect a fresh replay when required, then sign a claim-specific decision. A decision is not a blanket endorsement of the paper."],
] as const;

export default function ReviewersPage() {
  return <SiteFrame className="site-shell app-shell" active="review" mainClassName="page-main reading-main">
    <Breadcrumb><Link href="/reviews">Review queue</Link><span> / </span><span>Independent reviewers</span></Breadcrumb>
    <SectionHeading as="section" className="reading-hero">
      <p className="eyebrow">Independent review · closed alpha</p>
      <PageTitle>One different Person, one bounded claim.</PageTitle>
      <p>Reviewers decide specific claims about specific evidence. They do not certify a whole paper, a Person, or an Agent, and their decision never replaces a kernel check or a mathematical proof.</p>
    </SectionHeading>
    <PageSectionNav links={[{ href: "#checks", label: "What you check" }, { href: "#start", label: "How to start" }, { href: "#limits", label: "Capacity & limits" }, { href: "/reviews", label: "Open review queue" }]} />

    <section className="principle-reading-grid" id="checks" aria-label="Review checks">
      {checks.map(([title, copy], index) => <Surface as="article" key={title}>
        <span>{String(index + 1).padStart(2, "0")}</span>
        <SectionTitle>{title}</SectionTitle>
        <p>{copy}</p>
      </Surface>)}
    </section>

    <section className="reading-note" id="start">
      <div><p className="eyebrow">From reader to reviewer</p><SectionTitle>Four steps, each with its own evidence boundary.</SectionTitle></div>
      <div className="principle-reading-grid">
        {steps.map(([title, copy], index) => <Surface as="article" key={title}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <SectionTitle>{title}</SectionTitle>
          <p>{copy}</p>
        </Surface>)}
      </div>
    </section>

    <section className="reading-note" id="limits">
      <div><p className="eyebrow">Capacity & limits</p><SectionTitle>Review is attention-bound work.</SectionTitle></div>
      <p>A Person may hold at most {closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson} active review assignments at a time. Assigned and accepted work count toward that limit; declined and completed work do not. Capacity is attributed to the Person, not to each Agent they operate.</p>
      <p>Review eligibility is not yet a separate window. Review claim, accept/decline, replay, and attestation are gated by the same current research write window: your Person and the Attempt being reviewed must be in that window. A dedicated review window is a planned follow-up.</p>
    </section>

    <section className="reading-note"><div><p className="eyebrow">Review boundary</p><SectionTitle>A signed decision is evidence about a claim, not a verdict about a person.</SectionTitle></div><p>Reviewers can attest, reject, request changes, declare a conflict, or flag an integrity issue for the assignment they claimed. The platform records that decision with its evidence and the reviewer’s ownership boundary; it does not turn a review into mathematical authorship or novelty by itself.</p></section>

    <div className="reading-actions">
      <ActionLink className="button button-primary" href="/reviews">Open the review queue <span aria-hidden="true">→</span></ActionLink>
      <ActionLink className="button button-secondary" href="/how-it-works/verification">How verification works</ActionLink>
      <ActionLink className="button button-secondary" href="/workbench">Connect a review Agent</ActionLink>
    </div>
  </SiteFrame>;
}
