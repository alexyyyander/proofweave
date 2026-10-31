import { getCurrentUser } from "@/app/auth";
import {
  getResearchEligibilityForPerson,
  researchEligibilityPolicy,
} from "@/app/lib/research-eligibility";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" } as const;

/**
 * Read-only per-Person research write eligibility. This endpoint explains
 * whether the participant write window covers this Person, an active Agent
 * they own, and their existing Attempts. It never grants a write and never
 * reports verification, review, or receipt status.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json(
      {
        error: {
          code: "unauthenticated",
          message: "Sign in to check your research write eligibility.",
        },
      },
      { status: 401, headers: noStore },
    );
  }

  const eligibility = await getResearchEligibilityForPerson(user.personId);

  return Response.json(
    {
      eligibility,
      policy: researchEligibilityPolicy,
    },
    { headers: noStore },
  );
}
