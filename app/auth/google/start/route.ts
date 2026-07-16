import { NextResponse } from "next/server";
import { createGoogleAuthorization } from "@/packages/auth/google-oidc.mjs";
import { GOOGLE_FLOW_COOKIE } from "@/app/auth";
import { googleAuthConfig } from "@/app/google-auth-config";
import { safeRelativeReturnPath } from "@/app/chatgpt-auth";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const returnTo = safeRelativeReturnPath(requestUrl.searchParams.get("return_to") ?? "/profile");
  const config = googleAuthConfig(requestUrl.origin);
  if (!config.configured) return redirectWithError(requestUrl, returnTo, "configuration_error");

  try {
    const authorization = await createGoogleAuthorization({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      stateSecret: config.stateSecret,
      returnTo,
    });
    const response = NextResponse.redirect(authorization.authorizationUrl, 302);
    response.cookies.set(GOOGLE_FLOW_COOKIE, authorization.flowCookie, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/auth/google",
      maxAge: 10 * 60,
    });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch {
    return redirectWithError(requestUrl, returnTo, "configuration_error");
  }
}

function redirectWithError(requestUrl: URL, returnTo: string, error: string) {
  const target = new URL("/sign-in", requestUrl.origin);
  target.searchParams.set("return_to", returnTo);
  target.searchParams.set("error", error);
  const response = NextResponse.redirect(target, 302);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
