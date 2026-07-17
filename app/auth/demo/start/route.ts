import { NextResponse } from "next/server";
import { APP_SESSION_COOKIE, APP_SESSION_SECONDS } from "@/app/auth";
import { safeRelativeReturnPath } from "@/app/chatgpt-auth";
import { demoAuthConfig } from "@/app/demo-auth-config";
import { getD1 } from "@/db";
import { getAccountAuthRepository } from "@/db/repositories/account-auth";
import {
  D1RemoteMcpRateLimiter,
  RemoteMcpRequestRateLimitError,
} from "@/services/proofweave-mcp-gateway/d1-rate-limiter.mjs";

export const dynamic = "force-dynamic";

const demoSessionRateLimits = Object.freeze({
  create_demo_session: Object.freeze({ maxRequests: 5, windowSeconds: 3_600 }),
});

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  if (!demoAuthConfig().enabled) return new Response("Not found", { status: 404 });
  if (request.headers.get("origin") !== requestUrl.origin) {
    return Response.json({ error: { message: "The demo sign-in request did not originate from Proofweave." } }, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    await enforceDemoSessionRateLimit(request);
    const form = await request.formData();
    const returnTo = safeRelativeReturnPath(typeof form.get("return_to") === "string" ? String(form.get("return_to")) : "/profile");
    const subject = `demo:${crypto.randomUUID()}`;
    const identity = await getAccountAuthRepository().resolveIdentity({
      provider: "proofweave",
      subject,
      displayName: demoAuthConfig().displayName,
      email: `${subject.slice(5)}@demo.proofweave.invalid`,
      emailVerified: false,
    });
    const { token } = await getAccountAuthRepository().createSession(identity, APP_SESSION_SECONDS);
    const response = NextResponse.redirect(new URL(returnTo, requestUrl.origin), 303);
    response.cookies.set(APP_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: APP_SESSION_SECONDS,
    });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    if (error instanceof RemoteMcpRequestRateLimitError) {
      return Response.json({ error: { message: "Too many demo sessions were created from this connection. Try again later." } }, {
        status: 429,
        headers: { "Cache-Control": "no-store", "Retry-After": retryAfterSeconds(error.retryAt) },
      });
    }
    return Response.json({ error: { message: "The temporary demo identity could not be created." } }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

async function enforceDemoSessionRateLimit(request: Request) {
  const limiter = new D1RemoteMcpRateLimiter({
    database: getD1(),
    policies: demoSessionRateLimits,
    retentionSeconds: 3_600,
  });
  const address = normalizedAddress(request.headers.get("cf-connecting-ip"));
  await limiter.enforce({ personId: `public-demo-session:${address}` }, "create_demo_session");
}

function normalizedAddress(value: string | null) {
  const normalized = value?.trim() ?? "";
  return normalized.length >= 3 && normalized.length <= 64 && /^[0-9A-Fa-f:.]+$/.test(normalized)
    ? normalized.toLowerCase()
    : "unknown";
}

function retryAfterSeconds(retryAt: string) {
  return String(Math.max(1, Math.ceil((Date.parse(retryAt) - Date.now()) / 1_000)));
}
