import { env } from "cloudflare:workers";
import {
  parseRunnerAvailability,
  runnerAvailabilitySchemaVersion,
  runnerEnvironmentAvailability,
} from "@/services/lean-runner/runner-availability.mjs";
import type { RunnerTargetAvailability } from "./runner-availability";

const invalidAvailability = Object.freeze({
  schemaVersion: runnerAvailabilitySchemaVersion,
  state: "invalid",
  executionDeclared: false,
  environments: Object.freeze([]),
});

export function loadRunnerAvailability() {
  const settings = env as unknown as Record<string, string | undefined>;
  try {
    return parseRunnerAvailability({
      approvedImagesJson: settings.RUNNER_APPROVED_IMAGES_JSON,
      executionEnvironmentsJson: settings.RUNNER_EXECUTION_ENVIRONMENTS_JSON,
    });
  } catch {
    return invalidAvailability;
  }
}

export function targetRunnerAvailability(source: {
  leanToolchain: string;
  mathlibRevision: string;
}): RunnerTargetAvailability {
  return runnerEnvironmentAvailability(loadRunnerAvailability(), source);
}
