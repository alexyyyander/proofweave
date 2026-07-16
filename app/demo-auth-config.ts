import "server-only";
import { env } from "cloudflare:workers";

export function demoAuthConfig() {
  const values = env as unknown as Record<string, string | undefined>;
  return {
    enabled: values.PROOFWEAVE_DEMO_AUTH_ENABLED === "true",
    displayName: boundedLabel(values.PROOFWEAVE_DEMO_PERSON_LABEL) ?? "Build Week Demo Person",
  };
}

function boundedLabel(value: string | undefined): string | null {
  const label = value?.trim() ?? "";
  return label.length >= 2 && label.length <= 80 ? label : null;
}
