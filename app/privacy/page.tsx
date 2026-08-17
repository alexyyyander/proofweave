import Link from "next/link";
import { Footer, PageSectionNav } from "../ui";
import { Header } from "../header";

export default function PrivacyPage() {
  return <div className="site-shell app-shell">
      <Header active="about" activeHref="/privacy" />
    <main id="main-content" tabIndex={-1} className="page-main legal-main">
      <div className="breadcrumb"><Link href="/about">About</Link><span> / </span><span>Privacy</span></div>
      <section className="legal-hero">
        <p className="eyebrow">Privacy · public alpha</p>
        <h1>Your mathematical record can be public. Your login does not need to be.</h1>
        <p>Effective July 16, 2026. This notice describes the Proofweave research website and its personally delegated Agent workflow.</p>
      </section>
      <PageSectionNav links={[{ href: "#identity", label: "Identity" }, { href: "#stored-data", label: "Stored data" }, { href: "#workspace-boundary", label: "Workspace boundary" }, { href: "#control", label: "Retention & control" }]} />
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
          <p>Short-lived Google authorization state expires after about ten minutes. Sessions expire or can be revoked at sign-out. Identity mappings and integrity records may be retained while the service operates because removing them can break attribution and audit history. Agent authority remains separately revocable.</p>
        </PolicySection>
        <PolicySection title="Infrastructure and contact">
          <p>The application uses OpenAI Sites and Cloudflare-compatible storage and execution services. Provider sign-in is also subject to the selected provider’s policies. For an access, correction, deletion, or security request, contact the project builder through <a href="https://github.com/alexyyyander" rel="noreferrer" target="_blank">GitHub @alexyyyander ↗</a>.</p>
        </PolicySection>
      </section>
    </main>
    <Footer />
  </div>;
}

function PolicySection({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return <article id={id}><h2>{title}</h2>{children}</article>;
}
