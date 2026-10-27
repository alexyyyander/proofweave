import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { PageTitle, SectionTitle, SectionHeading, Surface } from "@/app/components/ui";
import Link from "next/link";
import { PageSectionNav } from "../ui";

export default function PrivacyPage() {
  return <SiteFrame className="site-shell app-shell" active="about" activeHref="/privacy" mainClassName="page-main legal-main">
      <Breadcrumb><Link href="/about">About</Link><span> / </span><span>Privacy</span></Breadcrumb>
      <SectionHeading as="section" className="legal-hero">
        <p className="eyebrow">Privacy · public alpha</p>
        <PageTitle>Your mathematical record can be public. Your login does not need to be.</PageTitle>
        <p>Effective July 16, 2026. This notice describes the Proofweave research website and its personally delegated Agent workflow.</p>
      </SectionHeading>
      <PageSectionNav links={[{ href: "#identity", label: "Identity" }, { href: "#stored-data", label: "Stored data" }, { href: "#workspace-boundary", label: "Workspace boundary" }, { href: "#processors", label: "Providers" }, { href: "#control", label: "Retention" }, { href: "#deletion", label: "Deletion & export" }]} />
      <section className="legal-sections">
        <PolicySection id="identity" title="What sign-in provides">
          <p>When you continue with Google or ChatGPT, Proofweave receives the provider’s stable account identifier, verified email, and available display name. They are used to authenticate you, prevent duplicate Person records, and attribute authorized Agent work. Email and provider identifiers are not displayed on your public contribution profile.</p>
        </PolicySection>
        <PolicySection id="stored-data" title="What Proofweave stores">
          <p>Proofweave stores your Person record, linked login identities, public signing keys, Agent delegations, research records you explicitly submit, review outcomes, and contribution receipts. Google authorization and ID tokens are verified during callback and are not persisted. Browser sessions are stored as one-way token hashes and normally expire after 30 days.</p>
        </PolicySection>
        <PolicySection id="workspace-boundary" title="Research and workspace boundary">
          <p>Connecting a local Agent does not grant Proofweave access to your ChatGPT password, API key, prompts, reasoning trace, private key, or private workspace. Files and checkpoints enter Proofweave only through an explicit, scoped action that identifies the evidence being shared.</p>
        </PolicySection>
        <PolicySection title="Public information">
          <p>Your chosen display name, stable Person ID, approved public checkpoints, signed delegations, verification outcomes, and contribution receipts may be publicly inspectable. Private evidence and account data remain access-controlled unless you deliberately publish an allowed artifact.</p>
        </PolicySection>
        <PolicySection id="control" title="Retention and control">
          <p>Short-lived Google authorization state expires after about ten minutes. Browser sessions normally expire after 30 days and can be revoked at sign-out. Identity mappings, public keys, audit events, and integrity records may be retained while the service operates because removing them can break attribution and audit history. Public contribution records, independent reviews, and Contribution Receipts are part of an immutable audit trail and may remain after account deletion, with display names replaced where feasible. Agent authority remains separately revocable.</p>
        </PolicySection>
        <PolicySection id="processors" title="Service providers">
          <p>Proofweave uses Cloudflare for website hosting and edge storage, Turso for the shared control-plane database, Render and E2B for isolated Runner execution when it is enabled, OpenAI for ChatGPT sign-in and the imported publication catalog, Google for Google sign-in, and GitHub for source code, issue tracking, and security advisories. These providers may process data outside your region under their own terms.</p>
        </PolicySection>
        <PolicySection id="deletion" title="Deletion, export, and public history">
          <p>Request account deletion or a data export through the <Link href="/support">support page</Link>. Proofweave will remove or anonymize account identifiers and provide account-level data on request. Approved public contributions, reviews, and receipts may be retained as audit history; deleting an account does not rewrite an immutable public record. Do not send tokens, private workspace files, or another person’s data in a public issue.</p>
        </PolicySection>
        <PolicySection title="Infrastructure and contact">
          <p>The application uses OpenAI Sites and Cloudflare-compatible storage and execution services. Provider sign-in is also subject to the selected provider’s policies. General support uses the <a href="https://github.com/alexyyyander/proofweave/issues" rel="noreferrer" target="_blank">public issue tracker ↗</a>. Privacy, account, and security requests use the <a href="https://github.com/alexyyyander/proofweave/security/advisories/new" rel="noreferrer" target="_blank">private security advisory ↗</a>; see the <Link href="/support">support page</Link>.</p>
        </PolicySection>
      </section>
    </SiteFrame>;
}

function PolicySection({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return <Surface as="article" id={id}><SectionTitle>{title}</SectionTitle>{children}</Surface>;
}
