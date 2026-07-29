export type ControlPlaneWriteAvailability =
  | "checking"
  | "available"
  | "read_only"
  | "unavailable";

type CapabilityResponse = Readonly<{
  controlPlaneOperations?: {
    mode?: unknown;
    writesEnabled?: unknown;
  };
}>;

export async function loadControlPlaneWriteAvailability(
  signal?: AbortSignal,
): Promise<ControlPlaneWriteAvailability> {
  try {
    const response = await fetch("/api/mcp/capabilities", {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
    const payload = await response.json().catch(() => null) as CapabilityResponse | null;
    const operations = payload?.controlPlaneOperations;
    if (operations?.writesEnabled === true) return "available";
    if (operations?.writesEnabled === false || operations?.mode === "read_only") return "read_only";
    return "unavailable";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "checking";
    return "unavailable";
  }
}

export function controlPlaneMaintenanceCopy(
  availability: ControlPlaneWriteAvailability,
): Readonly<{ title: string; detail: string }> {
  if (availability === "checking") return {
    title: "Checking whether research updates are available.",
    detail: "Public questions and verification records remain readable. Actions that create or change research stay closed until this check finishes.",
  };
  if (availability === "read_only") return {
    title: "Research updates are paused for maintenance.",
    detail: "You can inspect public questions and verification records. Starting work, changing a research task, and submitting evidence will return when maintenance is complete.",
  };
  return {
    title: "Proofweave cannot confirm that research updates are available.",
    detail: "Public records remain readable. Write actions stay closed rather than risking an incomplete or untracked update.",
  };
}
