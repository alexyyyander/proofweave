import { getCurrentUser } from "@/app/auth";
import { loadPersonalWorkspaceSummary } from "@/app/lib/personal-workspace-summary";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: { code: "unauthenticated", message: "Sign in to inspect your personal Workspace summary." } }, { status: 401 });
  }
  const summary = await loadPersonalWorkspaceSummary(user);
  if (!summary.available) {
    return Response.json({ error: { code: "unavailable", message: "The personal Workspace summary is temporarily unavailable." } }, { status: 503 });
  }
  return Response.json({
    summary,
    note: "Counts are Person-scoped record totals. They do not imply mathematical correctness, verification, novelty, or settled contribution credit.",
  });
}
