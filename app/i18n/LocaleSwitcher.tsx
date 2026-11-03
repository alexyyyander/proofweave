import { headers } from "next/headers";
import { locales, localeNames, localeRedirectPath, localeReturnPathHeader, localeShortNames } from "./config";
import { getI18n } from "./server";

/**
 * A server-rendered language menu. Each option is a normal link to a route that
 * persists the choice in a cookie and redirects back, so switching works
 * without client JavaScript.
 */
export async function LocaleSwitcher() {
  const { locale, t } = await getI18n();
  const returnPath = (await headers()).get(localeReturnPathHeader) ?? undefined;
  return <details className="locale-menu" name="header-overlays">
    <summary aria-label={t("locale.menuSummary", { language: localeNames[locale] })}>
      <span aria-hidden="true">{localeShortNames[locale]}</span><i aria-hidden="true">⌄</i>
    </summary>
    <div className="locale-popover">
      <strong>{t("locale.title")}</strong>
      <div className="locale-options" role="group" aria-label={t("locale.title")}>
        {locales.map((candidate) => <a
          aria-current={candidate === locale ? "true" : undefined}
          href={localeRedirectPath(candidate, returnPath)}
          key={candidate}
          rel="nofollow"
        >
          <span>{localeNames[candidate]}</span>
          {candidate === locale
            ? <small>{t("locale.current")}</small>
            : <span aria-hidden="true">→</span>}
        </a>)}
      </div>
      <p>{t("locale.pending")}</p>
    </div>
  </details>;
}
