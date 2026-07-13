import { currentEvidencePersonId, evidenceFailure } from "@/app/lib/evidence-api";
import { getArtifactBucket } from "@/db";
import { getEvidenceRepository } from "@/db/repositories/evidence";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; artifactId: string }> }) {
  try {
    const personId = await currentEvidencePersonId();
    if (personId instanceof Response) return personId;
    const { id, artifactId } = await params;
    const artifact = await getEvidenceRepository().getArtifactForPerson(personId, id, artifactId);
    if (!artifact) return Response.json({ error: { code: "not_found", message: "Evidence artifact not found." } }, { status: 404 });
    const object = await getArtifactBucket().get(artifact.objectKey);
    if (!object || !object.body || object.customMetadata?.sha256 !== artifact.contentHash || Number(object.size) !== artifact.byteLength) {
      return Response.json({ error: { code: "unavailable", message: "Stored evidence could not be verified against its immutable index." } }, { status: 503 });
    }
    return new Response(object.body, {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename=\"${artifact.filename}\"`,
        "content-length": String(artifact.byteLength),
        "content-type": artifact.contentType,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return evidenceFailure(error);
  }
}
