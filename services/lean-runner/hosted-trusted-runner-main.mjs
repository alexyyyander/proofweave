import { startHostedTrustedRunner } from "./hosted-trusted-runner.mjs";

let service;
try {
  service = await startHostedTrustedRunner();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      service.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
    });
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: "pw-audit-v1",
    kind: "hosted_trusted_runner_failed",
    component: "trusted_lean_runner",
    outcome: "startup_error",
    errorCode: privacySafeErrorCode(error),
  })}\n`);
  process.exitCode = 1;
}

function privacySafeErrorCode(error) {
  const name = typeof error?.name === "string" ? error.name : "runner_error";
  const normalized = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "").toLowerCase().slice(0, 56);
  return /^[a-z][a-z0-9_]{2,63}$/.test(normalized) ? normalized : "runner_error";
}
