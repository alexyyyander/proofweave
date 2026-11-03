export const locales = ["en", "zh-CN"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const localeCookieName = "pw_locale";

/** Middleware-set header carrying the visitor's current path and query. */
export const localeReturnPathHeader = "x-pw-return-path";

export const localeNames: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
};

export const localeShortNames: Record<Locale, string> = {
  en: "EN",
  "zh-CN": "中文",
};

export const htmlLang: Record<Locale, string> = {
  en: "en",
  "zh-CN": "zh-CN",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

export function parseLocaleCookie(cookieHeader: string | null | undefined): Locale | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== localeCookieName) continue;
    const raw = part.slice(separator + 1).trim();
    let value: string;
    try {
      value = decodeURIComponent(raw);
    } catch {
      continue;
    }
    if (isLocale(value)) return value;
  }
  return null;
}

/**
 * Picks the best supported locale from an Accept-Language header. Chinese
 * regional variants (zh, zh-Hans, zh-TW, …) all resolve to Simplified Chinese
 * until a separate translation is maintained.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return defaultLocale;
  const preferences = acceptLanguage
    .split(",")
    .map((entry) => {
      const [tag, ...parameters] = entry.trim().split(";");
      const quality = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => parameter.startsWith("q="));
      const parsedQuality = quality ? Number.parseFloat(quality.slice(2)) : 1;
      return {
        tag: tag.trim().toLowerCase(),
        quality: Number.isFinite(parsedQuality) ? parsedQuality : 0,
      };
    })
    .filter((entry) => entry.tag && entry.quality > 0)
    .sort((left, right) => right.quality - left.quality);

  for (const { tag } of preferences) {
    if (tag === "en" || tag.startsWith("en-")) return "en";
    if (tag === "zh" || tag.startsWith("zh-")) return "zh-CN";
    if (tag === "*") return defaultLocale;
  }
  return defaultLocale;
}

export const localePathPrefixes: Record<Locale, string> = {
  en: "",
  "zh-CN": "/zh-CN",
};

/** Returns the canonical URL pathname for a locale. */
export function pathForLocale(pathname: string, locale: Locale): string {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const prefix = localePathPrefixes[locale];
  if (!prefix) return normalized;
  return normalized === "/" ? prefix : `${prefix}${normalized}`;
}

/** Removes a supported locale prefix from a pathname. */
export function stripLocalePrefix(pathname: string): string {
  for (const locale of locales) {
    const prefix = localePathPrefixes[locale];
    if (!prefix) continue;
    if (pathname === prefix) return "/";
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  }
  return pathname;
}

export function localeRedirectPath(locale: Locale, next?: string): string {
  const parameters = new URLSearchParams({ to: locale });
  if (next) parameters.set("next", next);
  return `/api/locale?${parameters.toString()}`;
}
