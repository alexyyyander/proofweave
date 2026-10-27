import Link from "next/link";
import { BrandMark } from "../ui";

export function Footer() {
  return (
    <footer className="site-footer site-footer-compact">
      <div className="footer-intro">
        <div className="brand footer-brand"><BrandMark /><span>Proofweave</span></div>
        <p>An open network for personally delegated formal mathematics research.</p>
      </div>
      <div className="footer-meta">
        <nav className="footer-legal-links" aria-label="Legal, support, and security">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/support">Support</Link>
          <a href="https://github.com/alexyyyander/proofweave/issues" rel="noreferrer" target="_blank">Report an issue ↗</a>
          <a href="https://github.com/alexyyyander/proofweave/security/advisories/new" rel="noreferrer" target="_blank">Security ↗</a>
        </nav>
        <p className="footer-compact-note">Open formal mathematics · Evidence before claims</p>
      </div>
    </footer>
  );
}
