import type { CatalogProblem } from "@/packages/domain/catalog";

import type { TranslationKey } from "@/app/i18n/translate";

export type RunnerAvailabilityReason = "invalid_configuration" | "not_configured" | "no_image" | "executable" | "paused" | "not_deployed" | "approved";

export const runnerAvailabilityKeys: Record<RunnerAvailabilityReason, { label: TranslationKey; detail: TranslationKey }> = {
  invalid_configuration: { label: "explore.runner.invalid_configuration.label", detail: "explore.runner.invalid_configuration.detail" },
  not_configured: { label: "explore.runner.not_configured.label", detail: "explore.runner.not_configured.detail" },
  no_image: { label: "explore.runner.no_image.label", detail: "explore.runner.no_image.detail" },
  executable: { label: "explore.runner.executable.label", detail: "explore.runner.executable.detail" },
  paused: { label: "explore.runner.paused.label", detail: "explore.runner.paused.detail" },
  not_deployed: { label: "explore.runner.not_deployed.label", detail: "explore.runner.not_deployed.detail" },
  approved: { label: "explore.runner.approved.label", detail: "explore.runner.approved.detail" },
};

export type RunnerTargetAvailability = Readonly<{
  status: "executable" | "paused" | "approved" | "unavailable";
  reason: RunnerAvailabilityReason;
  label: string;
  detail: string;
}>;

export type WorkbenchCatalogTarget = CatalogProblem & Readonly<{
  runnerAvailability: RunnerTargetAvailability;
}>;
