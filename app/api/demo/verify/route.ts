import { verifyBuildWeekDemoFixture } from "@/app/lib/build-week-demo";

export const dynamic = "force-dynamic";

export async function GET() {
  const verification = await verifyBuildWeekDemoFixture();
  return Response.json(verification, {
    status: verification.status === "verified" ? 200 : 500,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
