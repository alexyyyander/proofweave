import { NextResponse } from "next/server";
import { getAccountAuthRepository } from "@/db/repositories/account-auth";
import {
  exchangeGoogleAuthorizationCode,
  GoogleOidcError,
  verifyGoogleAuthorizationFlow,
  verifyGoogleIdToken,
} from "@/packages/auth/google-oidc.mjs";
import {
  APP_SESSION_COOKIE,
  APP_SESSION_SECONDS,
  GOOGLE_FLOW_COOKIE,
} from "@/app/auth";
import { googleAuthConfig } from "@/app/google-auth-config";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const config = googleAuthConfig(requestUrl.origin);
  const flowCookie = readCookie(request.headers.get("cookie"), GOOGLE_FLOW_COOKIE);
  const returnedState = requestUrl.searchParams.get("state") ?? "";
  let returnTo = "/profile";

  try {
    if (!config.configured) throw new GoogleOidcError("Google login is not configured.", "configuration_error");
    const flow = await verifyGoogleAuthorizationFlow({
      flowCookie,
      returnedState,
      stateSecret: config.stateSecret,
    });
    returnTo = flow.returnTo;
    const providerError = requestUrl.searchParams.get("error");
    if (providerError) throw new GoogleOidcError("Google authorization was cancelled.", providerError === "access_denied" ? "access_denied" : "google_oidc_error");
    const code = requestUrl.searchParams.get("code") ?? "";
    const tokens = await exchangeGoogleAuthorizationCode({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      codeVerifier: flow.codeVerifier,
    });
    const claims = await verifyGoogleIdToken({
      idToken: tokens.idToken,
      clientId: config.clientId,
      nonce: flow.nonce,
    });
    const repository = getAccountAuthRepository();
    const identity = await repository.resolveIdentity({ provider: "google", ...claims });
    const { token } = await repository.createSession(identity, APP_SESSION_SECONDS);
    const response = NextResponse.redirect(new URL(returnTo, requestUrl.origin), 302);
    response.cookies.set(APP_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: APP_SESSION_SECONDS,
    });
    clearFlowCookie(response);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    const code = error instanceof GoogleOidcError ? error.code : "google_oidc_error";
    const target = new URL("/sign-in", requestUrl.origin);
    target.searchParams.set("return_to", returnTo);
    target.searchParams.set("error", code);
    const response = NextResponse.redirect(target, 302);
    clearFlowCookie(response);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0 || pair.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(pair.slice(separator + 1).trim());
  }
  return null;
}

function clearFlowCookie(response: NextResponse) {
  response.cookies.set(GOOGLE_FLOW_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/auth/google",
    maxAge: 0,
  });
}
