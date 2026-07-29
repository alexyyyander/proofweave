import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getControlPlaneOperationState, MissingDatabaseBindingError } from "@/db";
import { getAccountAuthRepository } from "@/db/repositories/account-auth";
import type { PersonIdentity } from "@/db/repositories/delegation";
import {
  chatGPTSignOutPath,
  safeRelativeReturnPath,
} from "./chatgpt-auth";

export const APP_SESSION_COOKIE = "__Host-pw_session";
export const GOOGLE_FLOW_COOKIE = "__Secure-pw_google_flow";
export const APP_SESSION_SECONDS = 60 * 60 * 24 * 30;

export type AuthUser = Readonly<{
  provider: "chatgpt" | "google" | "proofweave";
  providerLabel: "ChatGPT" | "Google" | "Demo";
  subject: string;
  personId: string | null;
  displayName: string;
  email: string;
  fullName: string | null;
}>;

export async function getCurrentUser(): Promise<AuthUser | null> {
  const requestHeaders = await headers();
  const token = readCookie(requestHeaders.get("cookie"), APP_SESSION_COOKIE);
  if (token) {
    try {
      const session = await getAccountAuthRepository().findSession(token);
      if ((session?.provider === "google" || session?.provider === "proofweave") && session.email) {
        return {
          provider: session.provider,
          providerLabel: session.provider === "google" ? "Google" : "Demo",
          subject: session.subject,
          personId: session.personId,
          displayName: session.displayName,
          email: session.email,
          fullName: session.displayName,
        };
      }
    } catch {
      // Fail closed as an unauthenticated app session. Public pages and an
      // independently valid dispatch-owned ChatGPT session can still render.
    }
  }

  const email = requestHeaders.get("oai-authenticated-user-email")?.trim();
  if (!email) return null;
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName = encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8"
      ? safeDecodeURIComponent(encodedFullName)
      : null;
  const subject = email.toLowerCase();
  const displayName = fullName ?? email;
  if (!getControlPlaneOperationState().writesEnabled) {
    return {
      provider: "chatgpt",
      providerLabel: "ChatGPT",
      subject,
      personId: null,
      displayName,
      email: subject,
      fullName,
    };
  }
  try {
    // Dispatch-owned ChatGPT auth has no application cookie. Resolve it into
    // the same identity table used by Google before any workspace repository
    // is opened, so a later verified-email login keeps one stable Person.
    const identity = await getAccountAuthRepository().resolveIdentity({
      provider: "chatgpt",
      subject,
      displayName,
      email: subject,
      emailVerified: true,
    });
    return {
      provider: "chatgpt",
      providerLabel: "ChatGPT",
      subject: identity.subject,
      personId: identity.personId,
      displayName: identity.displayName,
      email: identity.email ?? subject,
      fullName,
    };
  } catch (error) {
    if (!(error instanceof MissingDatabaseBindingError)) throw error;
  }
  return {
    provider: "chatgpt",
    providerLabel: "ChatGPT",
    subject,
    personId: null,
    displayName,
    email: subject,
    fullName,
  };
}

export async function requireUser(returnTo: string): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (user) return user;
  redirect(signInPath(returnTo));
}

export function toPersonIdentity(user: AuthUser): PersonIdentity {
  return {
    provider: user.provider,
    subject: user.subject,
    displayName: user.displayName,
    email: user.email,
    emailVerified: true,
  };
}

export function signInPath(returnTo: string): string {
  return `/sign-in?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}

export function signOutPath(returnTo = "/"): string {
  return `/auth/signout?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}

export function providerAwareSignOutPath(user: AuthUser, returnTo = "/"): string {
  return user.provider === "chatgpt" ? chatGPTSignOutPath(returnTo) : signOutPath(returnTo);
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0 || pair.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
