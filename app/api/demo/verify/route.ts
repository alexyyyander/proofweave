import { verifyBuildWeekDemoFixture } from "@/app/lib/build-week-demo";
import { getLocale } from "@/app/i18n/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("tamper") === "artifact" ? "tampered_copy" : "reference";
  const verification = await verifyBuildWeekDemoFixture({ mode, locale: await getLocale() });
  return Response.json(verification, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-proofweave-verification-id": verification.verificationId,
    },
  });
}
