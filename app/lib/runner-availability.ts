import type { CatalogProblem } from "@/packages/domain/catalog";

export type RunnerTargetAvailability = Readonly<{
  status: "executable" | "paused" | "approved" | "unavailable";
  label: string;
  detail: string;
}>;

export type WorkbenchCatalogTarget = CatalogProblem & Readonly<{
  runnerAvailability: RunnerTargetAvailability;
}>;
