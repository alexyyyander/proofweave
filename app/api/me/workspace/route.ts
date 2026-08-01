import { getCurrentUser } from "@/app/auth";
import { loadWorkbenchData } from "@/app/workbench/workbench-data";

export const dynamic = "force-dynamic";

/**
 * One owner-scoped refresh projection for the interactive Workbench. Keeping
 * these records in one response avoids repeating authentication, profile
 * lookup, and HTTP setup across three client requests. The evidence classes
 * remain separate fields and retain their original verification boundaries.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json(
      { error: { code: "unauthenticated", message: "Sign in to refresh your personal Workspace." } },
      { status: 401 },
    );
  }

  const data = await loadWorkbenchData(user);
  if (!data.storageAvailable) {
    return Response.json(
      { error: { code: "unavailable", message: "The personal Workspace is temporarily unavailable." } },
      { status: 503 },
    );
  }

  return Response.json({
    attempts: data.attempts,
    runs: data.runs,
    provisionalContributions: data.provisionalContributions,
    provisionalLedgerAvailable: data.provisionalLedgerAvailable,
    reviewCount: data.reviewCount,
    evidenceCount: data.evidenceCount,
    note: "This response groups owner-scoped records for transport efficiency. Attempt progress, Runner evidence, review, and provisional contribution records remain distinct claims.",
  });
}
