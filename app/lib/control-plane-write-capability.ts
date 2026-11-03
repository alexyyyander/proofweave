import type { Translator } from "@/app/i18n/translate";
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
  t: Translator,
): Readonly<{ title: string; detail: string }> {
  if (availability === "checking") return { title: t("controlPlane.checking.title"), detail: t("controlPlane.checking.detail") };
  if (availability === "read_only") return { title: t("controlPlane.readOnly.title"), detail: t("controlPlane.readOnly.detail") };
  if (availability === "edge_blocked") return { title: t("controlPlane.edgeBlocked.title"), detail: t("controlPlane.edgeBlocked.detail") };
  if (availability === "network_unavailable") return { title: t("controlPlane.network.title"), detail: t("controlPlane.network.detail") };
  return { title: t("controlPlane.unavailable.title"), detail: t("controlPlane.unavailable.detail") };
}

export function controlPlaneAvailabilityLabel(
  availability: ControlPlaneWriteAvailability,
  t: Translator,
): string {
  if (availability === "checking") return t("controlPlane.label.checking");
  if (availability === "read_only") return t("controlPlane.label.readOnly");
  if (availability === "edge_blocked") return t("controlPlane.label.edgeBlocked");
  if (availability === "network_unavailable") return t("controlPlane.label.unavailable");
  if (availability === "unavailable") return t("controlPlane.label.unavailable");
  return t("controlPlane.label.available");
}
