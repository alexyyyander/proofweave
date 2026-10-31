import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRunnerAvailability,
  parseRunnerAvailability,
  runnerEnvironmentAvailability,
  runnerEnvironmentDispatchDecision,
} from "../services/lean-runner/runner-availability.mjs";

const lean431 = "leanprover/lean4:v4.31.0";
const lean427 = "leanprover/lean4:v4.27.0";
const mathlib431 = "9a9483a92959bc92bd6a60176dd1fe597298c1f8";
const mathlib427 = "a3a10db0e9d66acbebf76c5e6a135066525ac900";
const image431 = `ghcr.io/proofweave/lean-runner@sha256:${"a".repeat(64)}`;
const image427 = `ghcr.io/proofweave/lean-runner@sha256:${"b".repeat(64)}`;

const approved = [
  { imageDigest: image431, leanToolchain: lean431, mathlibRevision: mathlib431 },
  { imageDigest: image427, leanToolchain: lean427, mathlibRevision: mathlib427 },
];

test("runner availability distinguishes executing, paused, approved and missing environments", () => {
  const availability = buildRunnerAvailability({
    approvedImages: approved,
    executionEnvironments: [
      { leanToolchain: lean431, mathlibRevision: mathlib431, executionEnabled: true },
      { leanToolchain: lean427, mathlibRevision: mathlib427, executionEnabled: false },
    ],
  });

  assert.equal(availability.state, "configured");
  assert.equal(availability.executionDeclared, true);
  assert.equal(runnerEnvironmentAvailability(availability, approved[0]).status, "executable");
  assert.equal(runnerEnvironmentAvailability(availability, approved[1]).status, "paused");
  assert.equal(runnerEnvironmentAvailability(availability, {
    leanToolchain: "leanprover/lean4:v4.35.0",
    mathlibRevision: "56a005855ea17e0b0958f73ec801ae140b0a1679",
  }).status, "unavailable");
});

test("legacy availability without an execution declaration reports approved, not executing", () => {
  const availability = buildRunnerAvailability({ approvedImages: approved, executionEnvironments: null });
  assert.equal(availability.executionDeclared, false);
  assert.equal(runnerEnvironmentAvailability(availability, approved[0]).status, "approved");
  assert.equal(runnerEnvironmentDispatchDecision({
    executionEnvironments: null,
    environment: approved[0],
  }).allowed, true);
});

test("dispatch decisions fail closed for undeployed and disabled environments", () => {
  const executionEnvironments = [
    { leanToolchain: lean431, mathlibRevision: mathlib431, executionEnabled: false },
  ];
  assert.deepEqual(runnerEnvironmentDispatchDecision({
    executionEnvironments,
    environment: approved[0],
  }), { allowed: false, reason: "execution_disabled" });
  assert.deepEqual(runnerEnvironmentDispatchDecision({
    executionEnvironments,
    environment: approved[1],
  }), { allowed: false, reason: "not_deployed" });
  assert.deepEqual(runnerEnvironmentDispatchDecision({
    executionEnvironments: [
      { leanToolchain: lean431, mathlibRevision: mathlib431, executionEnabled: true },
    ],
    environment: approved[0],
  }), { allowed: true, reason: null });
});

test("availability parsing rejects malformed or unregistered execution declarations", () => {
  assert.throws(
    () => parseRunnerAvailability({
      approvedImagesJson: "{",
      executionEnvironmentsJson: null,
    }),
    /valid JSON/,
  );
  assert.throws(
    () => buildRunnerAvailability({
      approvedImages: approved,
      executionEnvironments: [
        { leanToolchain: "leanprover/lean4:v4.35.0", mathlibRevision: "missing", executionEnabled: true },
      ],
    }),
    /has no approved image/,
  );
  assert.throws(
    () => buildRunnerAvailability({
      approvedImages: approved,
      executionEnvironments: [
        { leanToolchain: lean431, mathlibRevision: mathlib431, executionEnabled: true },
        { leanToolchain: lean431, mathlibRevision: mathlib431, executionEnabled: false },
      ],
    }),
    /unique/,
  );
});
