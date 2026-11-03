import Link from "next/link";
import { BrandMark } from "../ui";
import { getI18n } from "@/app/i18n/server";

export async function Footer() {
  const { t } = await getI18n();
  return (
    <footer className="site-footer site-footer-compact">
      <div className="footer-intro">
        <div className="brand footer-brand"><BrandMark /><span>Proofweave</span></div>
        <p>{t("footer.tagline")}</p>
      </div>
      <div className="footer-meta">
        <nav className="footer-legal-links" aria-label={t("footer.legalAria")}>
          <Link href="/privacy">{t("nav.item.privacy")}</Link>
          <Link href="/terms">{t("nav.item.terms")}</Link>
          <Link href="/support">{t("nav.item.support")}</Link>
          <a href="https://github.com/alexyyyander/proofweave/issues" rel="noreferrer" target="_blank">{t("footer.reportIssue")} ↗</a>
          <a href="https://github.com/alexyyyander/proofweave/security/advisories/new" rel="noreferrer" target="_blank">{t("footer.security")} ↗</a>
        </nav>
        <p className="footer-compact-note">{t("footer.note")}</p>
      </div>
    </footer>
  );
}
