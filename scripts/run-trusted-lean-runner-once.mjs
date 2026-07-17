import {
  createTrustedRunnerRuntimeFromEnvironment,
} from "../services/lean-runner/trusted-runner-process.mjs";

let runtime;
try {
  runtime = await createTrustedRunnerRuntimeFromEnvironment();
  const result = await runtime.processNext();
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "pw-audit-v1",
    kind: "trusted_runner_once_completed",
    component: "trusted_lean_runner",
    outcome: result.outcome,
    deliveryAttempt: result.deliveryAttempt ?? null,
    errorCode: result.errorCode ?? null,
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: "pw-audit-v1",
    kind: "trusted_runner_once_failed",
    component: "trusted_lean_runner",
    outcome: "startup_or_control_plane_error",
    errorCode: privacySafeErrorCode(error),
  })}\n`);
  process.exitCode = 1;
} finally {
  await runtime?.close().catch(() => {});
}

function privacySafeErrorCode(error) {
  const name = typeof error?.name === "string" ? error.name : "runner_error";
  const normalized = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 56);
  return /^[a-z][a-z0-9_]{2,63}$/.test(normalized) ? normalized : "runner_error";
}
