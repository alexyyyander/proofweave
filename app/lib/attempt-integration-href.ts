import type { McpAttempt } from "@/packages/domain/mcp";

export function attemptIntegrationHref(
  attempt: Pick<McpAttempt, "id" | "problemSlug">,
): string {
  const returnTo = `/workbench/attempts/${encodeURIComponent(attempt.id)}`;
  return `/integrations?target=${encodeURIComponent(attempt.problemSlug)}&return_to=${encodeURIComponent(returnTo)}#codex-beta`;
}
