import { headers } from "next/headers";
import { I18nProvider } from "@/app/i18n/client";
import { clientDictionaryForPath } from "@/app/i18n/client-dictionary";
import { getI18n } from "@/app/i18n/server";

/**
 * A template re-renders on every navigation, so the client dictionary can be
 * scoped to the route section being entered instead of being replayed from the
 * root layout (which persists across navigations).
 */
export default async function Template({ children }: { children: React.ReactNode }) {
  const { locale, dictionary } = await getI18n();
  const pathname = (await headers()).get("x-pw-pathname") ?? "/";
  return <I18nProvider locale={locale} dictionary={clientDictionaryForPath(dictionary, pathname)}>
    {children}
  </I18nProvider>;
}
