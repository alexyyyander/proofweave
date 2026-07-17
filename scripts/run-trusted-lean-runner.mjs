import {
  createTrustedRunnerRuntimeFromEnvironment,
} from "../services/lean-runner/trusted-runner-process.mjs";

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => controller.abort());
}

let runtime;
try {
  runtime = await createTrustedRunnerRuntimeFromEnvironment();
  await runtime.run({ signal: controller.signal });
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: "pw-audit-v1",
    kind: "trusted_runner_process_failed",
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
