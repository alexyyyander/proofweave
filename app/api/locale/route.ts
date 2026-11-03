import { defaultLocale, isLocale, localeCookieName, pathForLocale, stripLocalePrefix } from "@/app/i18n/config";

export const dynamic = "force-dynamic";

/**
 * Persists a language choice and returns to the page that linked here. The
 * language menu uses plain links so switching still works without JavaScript.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("to");
  const locale = isLocale(requested) ? requested : defaultLocale;
  const target = localizedPath(safeReturnPath(url.searchParams.get("next")) ?? refererPath(request) ?? "/", locale);
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return new Response(null, {
    status: 303,
    headers: {
      location: new URL(target, url.origin).toString(),
      "set-cookie": `${localeCookieName}=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`,
      "cache-control": "no-store",
      vary: "cookie, accept-language",
    },
  });
}

function localizedPath(value: string, locale: typeof defaultLocale | "zh-CN"): string {
  const parsed = new URL(value, "https://app.local");
  parsed.pathname = pathForLocale(stripLocalePrefix(parsed.pathname), locale);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function safeReturnPath(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, "https://app.local");
    if (url.origin !== "https://app.local") return null;
    if (url.pathname === "/api/locale") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function refererPath(request: Request): string | null {
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    const source = new URL(referer);
    if (source.pathname === "/api/locale") return null;
    return `${source.pathname}${source.search}${source.hash}`;
  } catch {
    return null;
  }
}
