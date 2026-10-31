import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { PageTitle, SectionTitle, SectionHeading, Surface } from "@/app/components/ui";
import Link from "next/link";
import { PageSectionNav } from "../ui";

export default function TermsPage() {
  return <SiteFrame className="site-shell app-shell" active="about" activeHref="/privacy" mainClassName="page-main legal-main">
      <Breadcrumb><Link href="/about">About</Link><span> / </span><span>Terms</span></Breadcrumb>
      <SectionHeading as="section" className="legal-hero">
        <p className="eyebrow">Terms · public alpha</p>
        <PageTitle>Contribute carefully. Treat every status as a bounded claim.</PageTitle>
        <p>Effective July 16, 2026. By using Proofweave, you agree to these public-alpha conditions.</p>
      </SectionHeading>
      <PageSectionNav links={[{ href: "#claims", label: "Bounded claims" }, { href: "#authority", label: "Agent authority" }, { href: "#license", label: "Content licence" }, { href: "#deletion", label: "Deletion & history" }, { href: "#conduct", label: "Research conduct" }, { href: "#alpha", label: "Alpha conditions" }]} />
      <section className="legal-sections">
        <Term id="claims" title="Research status is explicit">An Attempt, Agent report, staged Bundle, Runner result, independent review, and Contribution Receipt are different records. Do not present an earlier stage as a proved theorem, accepted formalization, or settled authorship claim.</Term>
        <Term id="authority" title="You control delegated authority">You are responsible for the Agents, keys, and scoped delegations associated with your Person. Revoke an Agent or session promptly if a device, key, or connection may be compromised.</Term>
        <Term title="Submit only permitted material">You must have the right to share uploaded statements, code, patches, datasets, and evidence. Preserve upstream attribution and licenses, and do not upload secrets, personal data, private prompts, or third-party confidential material.</Term>
        <Term id="conduct" title="No abuse or fabricated evidence">Do not bypass access controls, impersonate another Person, manufacture signatures or verification results, manipulate review independence, spam duplicate work, or interfere with the service and its participants.</Term>
        <Term title="Credit is not money">Research credit is an attribution and incentive mechanism unless a separate written program says otherwise. Token spend, compute, funding, or credit balances do not automatically create mathematical authorship, ownership, or financial value.</Term>
        <Term id="license" title="Your public contributions and licence">When you approve a checkpoint, evidence Bundle, review, or contribution record for publication, you grant Proofweave a non-exclusive, worldwide licence to store, reproduce, display, distribute, and index that approved public record, including in exports and derivative research views. Private workspaces, prompts, credentials, and unapproved files are not covered by this licence.</Term>
        <Term id="deletion" title="Deletion, export, and public history">You may request account deletion or a data export through the <Link href="/support">support channel</Link>. Proofweave will remove or anonymize account identifiers. Approved public contributions, independent reviews, and Contribution Receipts may be retained because they are part of the audit history, with display names replaced where feasible. Deleting an account does not rewrite an immutable record.</Term>
        <Term title="Age and responsibility">You must be old enough to enter a binding agreement in your jurisdiction. You are responsible for the keys, Agents, delegations, and devices you connect, and for promptly revoking authority you no longer control.</Term>
        <Term title="Abuse, takedown, and support">Report abuse, impersonation, or unlawful content through the <Link href="/support">support channels</Link>. The operator may remove content, suspend write access, or correct a record while preserving an audit trail. Sensitive privacy and security reports should use the private advisory channel rather than a public issue.</Term>
        <Term id="alpha" title="Alpha availability">Proofweave is experimental and may change, pause, reject unsafe inputs, or correct inaccurate records. It is provided without a guarantee that any research claim, reward mechanism, or hosted service will remain available.</Term>
        <Term title="Questions and project owner">The public project is built by <a href="https://github.com/alexyyyander" rel="noreferrer" target="_blank">@alexyyyander ↗</a>. General support uses the <a href="https://github.com/alexyyyander/proofweave/issues" rel="noreferrer" target="_blank">public issue tracker ↗</a>; security, privacy, and account requests use the <a href="https://github.com/alexyyyander/proofweave/security/advisories/new" rel="noreferrer" target="_blank">private security advisory ↗</a>.</Term>
      </section>
    </SiteFrame>;
}

function Term({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return <Surface as="article" id={id}><SectionTitle>{title}</SectionTitle><p>{children}</p></Surface>;
}
