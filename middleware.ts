import { NextResponse, type NextRequest } from "next/server";
import {
  defaultLocale,
  localeCookieName,
  localeReturnPathHeader,
  negotiateLocale,
  parseLocaleCookie,
  pathForLocale,
  stripLocalePrefix,
} from "./app/i18n/config";
import { isNonPagePath, middlewareMatcher } from "./app/i18n/routing";

const zhPrefix = "/zh-CN";

function cookieOptions(request: NextRequest) {
  return {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: request.nextUrl.protocol === "https:",
  };
}

/**
 * Chinese lives at `/zh-CN/...` while English keeps its unprefixed URLs. The
 * prefixed request is rewritten onto the existing route tree with a locale
 * header, so every page keeps a single implementation. Unprefixed navigation
 * from a Chinese browser is redirected to the prefixed canonical URL.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isNonPagePath(pathname)) return NextResponse.next();

  const returnPath = `${pathname}${search}`;

  if (pathname === zhPrefix || pathname.startsWith(`${zhPrefix}/`)) {
    const rest = stripLocalePrefix(pathname);
    const url = request.nextUrl.clone();
    url.pathname = rest;
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-pw-locale", "zh-CN");
    requestHeaders.set("x-pw-pathname", `${zhPrefix}${rest === "/" ? "" : rest}`);
    requestHeaders.set(localeReturnPathHeader, returnPath);
    const response = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
    response.cookies.set(localeCookieName, "zh-CN", cookieOptions(request));
    return response;
  }

  const preferred = parseLocaleCookie(request.headers.get("cookie"))
    ?? negotiateLocale(request.headers.get("accept-language"));
  if (preferred !== defaultLocale && (request.method === "GET" || request.method === "HEAD")) {
    const url = request.nextUrl.clone();
    url.pathname = pathForLocale(pathname, preferred);
    const response = NextResponse.redirect(url);
    response.cookies.set(localeCookieName, preferred, cookieOptions(request));
    return response;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pw-locale", preferred);
  requestHeaders.set("x-pw-pathname", pathname);
  requestHeaders.set(localeReturnPathHeader, returnPath);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [middlewareMatcher],
};
