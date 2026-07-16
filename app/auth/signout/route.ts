import { NextResponse } from "next/server";
import { APP_SESSION_COOKIE } from "@/app/auth";
import { chatGPTSignOutPath, getChatGPTUser, safeRelativeReturnPath } from "@/app/chatgpt-auth";
import { getAccountAuthRepository } from "@/db/repositories/account-auth";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const returnTo = safeRelativeReturnPath(requestUrl.searchParams.get("return_to") ?? "/");
  const token = readCookie(request.headers.get("cookie"), APP_SESSION_COOKIE);
  if (token) await getAccountAuthRepository().revokeSession(token);
  const chatGPTUser = await getChatGPTUser();
  const target = chatGPTUser
    ? new URL(chatGPTSignOutPath(returnTo), requestUrl.origin)
    : new URL(returnTo, requestUrl.origin);
  const response = NextResponse.redirect(target, 302);
  response.cookies.set(APP_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator >= 0 && pair.slice(0, separator).trim() === name) {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    }
  }
  return null;
}
