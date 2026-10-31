import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { PageTitle, SectionTitle, SectionHeading, Surface, ActionLink } from "@/app/components/ui";
import Link from "next/link";
import { PageSectionNav } from "../ui";

export const metadata = {
  title: "Support, abuse, and security",
  description: "Where to ask for help, report abuse, request account deletion, or disclose a security issue during the Proofweave public alpha.",
};

const channels = [
  ["General support", "Use the public issue tracker for access questions, bugs, documentation problems, and non-sensitive account requests. Do not include tokens, keys, private workspace contents, or another person’s data.", "https://github.com/alexyyyander/proofweave/issues", "Open the issue tracker ↗"],
  ["Security disclosure", "Report vulnerabilities, credential exposure, or a suspected integrity failure privately through GitHub Security Advisories. Do not open a public issue for an active vulnerability.", "https://github.com/alexyyyander/proofweave/security/advisories/new", "Open a private advisory ↗"],
  ["Privacy or account request", "Deletion, export, correction, and other requests that contain personal data should use the private security advisory channel rather than a public issue.", "https://github.com/alexyyyander/proofweave/security/advisories/new", "Request privately ↗"],
  ["Abuse or impersonation", "Report impersonation, fabricated evidence, review manipulation, or unlawful content. Include links and dates, but not private evidence or credentials. Sensitive reports should use the private advisory channel.", "https://github.com/alexyyyander/proofweave/issues", "Report abuse ↗"],
] as const;

export default function SupportPage() {
  return <SiteFrame className="site-shell app-shell" active="about" mainClassName="page-main legal-main">
    <Breadcrumb><Link href="/about">About</Link><span> / </span><span>Support</span></Breadcrumb>
    <SectionHeading as="section" className="legal-hero">
      <p className="eyebrow">Support · public alpha</p>
      <PageTitle>Ask, report, or disclose through a channel we actually monitor.</PageTitle>
      <p>Proofweave is an experimental public alpha. Support is best-effort and has no guaranteed response time; there is no separate status page yet.</p>
    </SectionHeading>
    <PageSectionNav links={[{ href: "#channels", label: "Channels" }, { href: "#response", label: "Response" }, { href: "/privacy", label: "Privacy" }, { href: "/terms", label: "Terms" }]} />

    <section className="legal-sections" id="channels">
      {channels.map(([title, copy, href, label]) => <Surface as="article" key={title}>
        <SectionTitle>{title}</SectionTitle>
        <p>{copy}</p>
        <a className="text-link" href={href} rel="noreferrer" target="_blank">{label}</a>
      </Surface>)}
    </section>

    <section className="reading-note" id="response">
      <div><p className="eyebrow">What to expect</p><SectionTitle>No SLA, but explicit handling.</SectionTitle></div>
      <p>Access requests are reviewed against the current research write window. Security and privacy reports are handled privately. Abuse reports may lead to content removal, suspension of write access, or a correction record. During the alpha, response times vary with operator availability.</p>
      <p>Account deletion removes or anonymizes account identifiers. Published contribution records, reviews, and receipts may be retained as audit history; display names are replaced where feasible. Export requests use the same private channel.</p>
    </section>

    <div className="reading-actions">
      <ActionLink className="button button-primary" href="https://github.com/alexyyyander/proofweave/issues" rel="noreferrer" target="_blank">Open the issue tracker <span aria-hidden="true">↗</span></ActionLink>
      <ActionLink className="button button-secondary" href="https://github.com/alexyyyander/proofweave/security/advisories/new" rel="noreferrer" target="_blank">Private security advisory</ActionLink>
    </div>
  </SiteFrame>;
}
