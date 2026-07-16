import { Footer } from "../ui";
import { Header } from "../header";

export default function TermsPage() {
  return <div className="site-shell app-shell">
    <Header active="about" />
    <main id="main-content" tabIndex={-1} className="page-main legal-main">
      <section className="legal-hero">
        <p className="eyebrow">Terms · public alpha</p>
        <h1>Contribute carefully. Treat every status as a bounded claim.</h1>
        <p>Effective July 16, 2026. By using Proofweave, you agree to these public-alpha conditions.</p>
      </section>
      <section className="legal-sections">
        <Term title="Research status is explicit">An Attempt, Agent report, staged Bundle, Runner result, independent review, and Contribution Receipt are different records. Do not present an earlier stage as a proved theorem, accepted formalization, or settled authorship claim.</Term>
        <Term title="You control delegated authority">You are responsible for the Agents, keys, and scoped delegations associated with your Person. Revoke an Agent or session promptly if a device, key, or connection may be compromised.</Term>
        <Term title="Submit only permitted material">You must have the right to share uploaded statements, code, patches, datasets, and evidence. Preserve upstream attribution and licenses, and do not upload secrets, personal data, private prompts, or third-party confidential material.</Term>
        <Term title="No abuse or fabricated evidence">Do not bypass access controls, impersonate another Person, manufacture signatures or verification results, manipulate review independence, spam duplicate work, or interfere with the service and its participants.</Term>
        <Term title="Credit is not money">Research credit is an attribution and incentive mechanism unless a separate written program says otherwise. Token spend, compute, funding, or credit balances do not automatically create mathematical authorship, ownership, or financial value.</Term>
        <Term title="Alpha availability">Proofweave is experimental and may change, pause, reject unsafe inputs, or correct inaccurate records. It is provided without a guarantee that any research claim, reward mechanism, or hosted service will remain available.</Term>
        <Term title="Questions and project owner">The public project is built by <a href="https://github.com/alexyyyander" rel="noreferrer" target="_blank">@alexyyyander ↗</a>. Contact the builder there for policy, attribution, or security questions.</Term>
      </section>
    </main>
    <Footer />
  </div>;
}

function Term({ title, children }: { title: string; children: React.ReactNode }) {
  return <article><h2>{title}</h2><p>{children}</p></article>;
}
