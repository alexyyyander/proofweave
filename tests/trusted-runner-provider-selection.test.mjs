import assert from "node:assert/strict";
import test from "node:test";
import { E2BSandboxContainerFactory } from "../services/lean-runner/e2b-sandbox-container.mjs";
import {
  createTrustedRunnerContainerFactoryFromEnvironment,
  TrustedRunnerProcessConfigurationError,
} from "../services/lean-runner/trusted-runner-process.mjs";

const imageReference = "registry.example/proofweave/lean-runner@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("trusted Runner selects E2B explicitly and fails closed for missing or unknown providers", () => {
  const environment = {
    PROOFWEAVE_RUNNER_PROVIDER: "e2b",
    E2B_API_KEY: "e2b_test_api_key_1234567890",
    PROOFWEAVE_E2B_TEMPLATE_ID: "template_proofweave_lean_v1",
    PROOFWEAVE_E2B_RUNNER_IMAGE: imageReference,
    PROOFWEAVE_E2B_RESOURCE_POLICY_REVIEWED: "true",
    PROOFWEAVE_E2B_CPU: "2",
    PROOFWEAVE_E2B_MEMORY_MB: "2048",
    PROOFWEAVE_E2B_TIMEOUT_MS: "120000",
    PROOFWEAVE_E2B_STARTUP_TIMEOUT_MS: "30000",
  };
  const factory = createTrustedRunnerContainerFactoryFromEnvironment({
    environment,
    e2bSandboxApi: { async create() { throw new Error("not invoked during selection"); } },
  });
  assert.ok(factory instanceof E2BSandboxContainerFactory);

  assert.throws(
    () => createTrustedRunnerContainerFactoryFromEnvironment({ environment: {} }),
    TrustedRunnerProcessConfigurationError,
  );
  assert.throws(
    () => createTrustedRunnerContainerFactoryFromEnvironment({
      environment: { PROOFWEAVE_RUNNER_PROVIDER: "implicit-provider" },
    }),
    /exactly modal or e2b/,
  );
});
