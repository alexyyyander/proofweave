import { BrandMark } from "../ui";

export function Footer() {
  return (
    <footer className="site-footer site-footer-compact">
      <div className="footer-intro">
        <div className="brand footer-brand"><BrandMark /><span>Proofweave</span></div>
        <p>An open network for personally delegated formal mathematics research.</p>
      </div>
      <p className="footer-compact-note">Open formal mathematics · Evidence before claims</p>
    </footer>
  );
}
