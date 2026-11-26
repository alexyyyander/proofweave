import { SectionTitle, CardTitle } from "@/app/components/ui/primitives";
import Link from "next/link";

import type { Translator } from "@/app/i18n/translate";

const icons = {
  local: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>,
  upload: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></>,
  publish: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
};

export function PrivacyBoundary({ t, policyHref }: { t: Translator; policyHref: string }) {
  return <section id="privacy-boundary" className="rh-section rh-boundary" aria-labelledby="rh-boundary-title">
    <header className="rh-section-head">
      <SectionTitle id="rh-boundary-title">{t("home.research.privacy")}</SectionTitle>
      <Link className="rh-link" href={policyHref}>{t("home.privacy.policy")} <span aria-hidden="true">→</span></Link>
    </header>
    <div className="rh-boundary-map">
      {(["local", "upload", "publish"] as const).map(stage =>
        <section key={stage} className={`rh-boundary-zone rh-boundary-${stage}`} aria-labelledby={`privacy-${stage}`}>
          <CardTitle id={`privacy-${stage}`}>
            <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{icons[stage]}</svg>
            {t(`home.privacy.${stage}`)}
          </CardTitle>
          {stage === "upload" ? <>
            <p>{t("home.privacy.choose")}</p>
            <p className="rh-boundary-access">{t("home.privacy.access")}</p>
          </> : <ul>
            {(stage === "local" ? ["privateNotes", "privateKeys", "privateFiles"] as const : ["publicNodes", "publicArtifacts", "publicRuns", "publicReceipts"] as const).map(item =>
              <li key={item}>{t(`home.privacy.${item}`)}</li>)}
          </ul>}
        </section>)}
    </div>
  </section>;
}
