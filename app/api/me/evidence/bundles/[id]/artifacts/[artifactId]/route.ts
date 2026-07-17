import { currentEvidencePersonId, evidenceFailure } from "@/app/lib/evidence-api";
import { getD1 } from "@/db";
import { getEvidenceRepository } from "@/db/repositories/evidence";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; artifactId: string }> }) {
  try {
    const personId = await currentEvidencePersonId();
    if (personId instanceof Response) return personId;
    const { id, artifactId } = await params;
    const artifact = await getEvidenceRepository().getArtifactForPerson(personId, id, artifactId);
    if (!artifact) return Response.json({ error: { code: "not_found", message: "Evidence artifact not found." } }, { status: 404 });
    const stored = await getD1()
      .prepare("SELECT content_hash, byte_length, content_type, bytes FROM inline_artifact_bytes WHERE object_key = ?")
      .bind(artifact.objectKey)
      .first<{ content_hash: string; byte_length: number; content_type: string; bytes: ArrayBuffer | Uint8Array | number[] }>();
    const bytes = stored ? toBytes(stored.bytes) : null;
    if (
      !stored || !bytes || stored.content_hash !== artifact.contentHash ||
      Number(stored.byte_length) !== artifact.byteLength || stored.content_type !== artifact.contentType ||
      bytes.byteLength !== artifact.byteLength || await sha256(bytes) !== artifact.contentHash
    ) {
      return Response.json({ error: { code: "unavailable", message: "Stored evidence could not be verified against its immutable index." } }, { status: 503 });
    }
    return new Response(copyArrayBuffer(bytes), {
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

function toBytes(value: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value);
  return new Uint8Array(value);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", copyArrayBuffer(bytes)));
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
