import { currentEvidencePersonId, evidenceFailure } from "@/app/lib/evidence-api";
import { getEvidenceRepository } from "@/db/repositories/evidence";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const personId = await currentEvidencePersonId();
    if (personId instanceof Response) return personId;
    const { id } = await params;
    const evidence = await getEvidenceRepository().getForPerson(personId, id);
    if (!evidence) return Response.json({ error: { code: "not_found", message: "Evidence record not found." } }, { status: 404 });
    return Response.json({ evidence }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return evidenceFailure(error);
  }
}
