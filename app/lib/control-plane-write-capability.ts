export type ControlPlaneWriteAvailability =
  | "checking"
  | "available"
  | "read_only"
  | "edge_blocked"
  | "network_unavailable"
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
    if (response.status === 403) return "edge_blocked";
    if (!response.ok) return "unavailable";
    const payload = await response.json().catch(() => null) as CapabilityResponse | null;
    const operations = payload?.controlPlaneOperations;
    if (operations?.writesEnabled === true) return "available";
    if (operations?.writesEnabled === false || operations?.mode === "read_only") return "read_only";
    return "unavailable";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "checking";
    return "network_unavailable";
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
  if (availability === "edge_blocked") return {
    title: "Proofweave is blocked at its public edge.",
    detail: "Public access is currently being blocked before Proofweave can receive your request. Keep your Agent connection; reconnecting or uploading files will not fix this service-side problem.",
  };
  if (availability === "network_unavailable") return {
    title: "Proofweave cannot be reached from this browser.",
    detail: "Your research controls stay closed until the service is reachable again. Keep your Agent connection and try again after the network path is restored.",
  };
  return {
    title: "Proofweave cannot confirm that research updates are available.",
    detail: "Public records remain readable. Write actions stay closed rather than risking an incomplete or untracked update.",
  };
}

export function controlPlaneAvailabilityLabel(
  availability: ControlPlaneWriteAvailability,
): string {
  if (availability === "checking") return "Checking research access";
  if (availability === "read_only") return "Research updates paused";
  if (availability === "edge_blocked") return "Service edge blocked";
  if (availability === "network_unavailable") return "Service unavailable";
  if (availability === "unavailable") return "Service unavailable";
  return "Research updates available";
}
