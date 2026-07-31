import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  createReleaseManifest,
  stableManifestJson,
  validateReleaseManifest,
} from "../scripts/print-release-manifest.mjs";

const sourceRevision = "a".repeat(40);
const otherRevision = "b".repeat(40);
const mathlibRevision = "c".repeat(40);
const imageDigest = `ghcr.io/example/proofweave@sha256:${"d".repeat(64)}`;
const otherImageDigest = `ghcr.io/example/proofweave@sha256:${"e".repeat(64)}`;
const templateId = "template:memory-8g";
const templateBuildId = "62127604-a4bc-47ed-ba53-1f5313583f82";
const migrationHead = "0042_add_jacobian_counterexample_audit.sql";
const databaseFingerprint = "0123456789abcdef";
const otherDatabaseFingerprint = "fedcba9876543210";
const sitesProjectId = `appgprj_${"f".repeat(32)}`;

test("release manifest emits one complete stable non-secret revision set", async () => {
  await withFixture(async (root) => {
    const options = completeOptions(root);
    const first = createReleaseManifest(options);
    const second = createReleaseManifest(options);

    assert.equal(first.exitCode, 0);
    assert.equal(first.manifest.schemaVersion, "pw-release-manifest-v3");
    assert.equal(first.manifest.validation.mode, "release");
    assert.equal(first.manifest.validation.state, "valid");
    assert.deepEqual(first.manifest.validation.issues, []);
    assert.equal(first.manifest.source.gitSha, sourceRevision);
    assert.equal(first.manifest.source.branch, "main");
    assert.equal(first.manifest.source.clean, true);
    assert.equal(first.manifest.sites.projectId, sitesProjectId);
    assert.equal(first.manifest.sites.version, "version-136");
    assert.equal(first.manifest.gateway.revision, sourceRevision);
    assert.equal(first.manifest.runner.e2b.configuredTemplateId, templateId);
    assert.equal(first.manifest.runner.e2b.deployedTemplateBuildId, templateBuildId);
    assert.equal(first.manifest.runner.image.configuredDigest, imageDigest);
    assert.equal(first.manifest.runner.image.leanToolchain, "leanprover/lean4:v4.31.0");
    assert.equal(first.manifest.runner.image.mathlibRevision, mathlibRevision);
    assert.equal(first.manifest.database.authority, "turso");
    assert.equal(first.manifest.database.gatewayFingerprint, databaseFingerprint);
    assert.equal(first.manifest.database.runnerFingerprint, databaseFingerprint);
    assert.equal(first.manifest.database.repositoryMigrationHead, migrationHead);
    assert.equal(first.manifest.database.deployedMigrationHead, migrationHead);
    assert.deepEqual(first.manifest.operationModes, {
      global: "read_only",
      participant: "read_only",
      mcp: "read_only",
    });
    assert.equal(
      first.manifest.productionDrill.policy.githubRepository.fullName,
      "example/proofweave",
    );
    assert.match(first.manifest.productionDrill.policyHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(
      first.manifest.productionDrill.gitOriginRepositoryFullName,
      "example/proofweave",
    );
    assert.equal(stableManifestJson(first.manifest), stableManifestJson(second.manifest));
    assert.equal("generatedAt" in first.manifest, false);
  });
});

test("release manifest fails closed when the reviewed policy and git origin diverge", async () => {
  await withFixture(async (root) => {
    execFileSync(
      "git",
      ["remote", "set-url", "origin", "https://github.com/attacker/proofweave.git"],
      { cwd: root },
    );
    const result = createReleaseManifest(completeOptions(root));
    assert.equal(result.exitCode, 1);
    assert.equal(issueCodes(result).has("PRODUCTION_DRILL_POLICY_MISSING"), true);
    assert.equal(issueCodes(result).has("PRODUCTION_DRILL_POLICY_HASH_MISSING"), true);
  });
});

test("strict validation recomputes and rejects a stale production policy hash", async () => {
  await withFixture(async (root) => {
    const result = createReleaseManifest(completeOptions(root));
    const tampered = structuredClone(result.manifest);
    tampered.productionDrill.policy.policyVersion += 1;
    const validation = validateReleaseManifest(tampered, { mode: "release" });
    assert.equal(
      validation.issues.some((issue) => (
        issue.code === "PRODUCTION_DRILL_POLICY_HASH_MISMATCH"
      )),
      true,
    );
  });
});

test("release strict mode fails closed when deployment fields are missing", async () => {
  await withFixture(async (root) => {
    const result = createReleaseManifest({
      root,
      mode: "release",
      environment: {},
      source: cleanSource(),
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.manifest.validation.state, "invalid");
    const codes = issueCodes(result);
    assert.equal(codes.has("SITES_VERSION_MISSING"), true);
    assert.equal(codes.has("SITES_COMMIT_MISSING"), true);
    assert.equal(codes.has("GATEWAY_REVISION_MISSING"), true);
    assert.equal(codes.has("RUNNER_REVISION_MISSING"), true);
    assert.equal(codes.has("E2B_DEPLOYED_TEMPLATE_MISSING"), true);
    assert.equal(codes.has("RUNNER_DEPLOYED_IMAGE_MISSING"), true);
    assert.equal(codes.has("DATABASE_AUTHORITY_MISSING"), true);
    assert.equal(codes.has("GATEWAY_DATABASE_FINGERPRINT_MISSING"), true);
    assert.equal(codes.has("RUNNER_DATABASE_FINGERPRINT_MISSING"), true);
    assert.equal(codes.has("DEPLOYED_MIGRATION_HEAD_MISSING"), true);
    assert.equal(codes.has("GLOBAL_OPERATION_MODE_MISSING"), true);
    assert.equal(codes.has("PARTICIPANT_OPERATION_MODE_MISSING"), true);
    assert.equal(codes.has("MCP_OPERATION_MODE_MISSING"), true);
  });
});

test("release strict mode rejects revision, template, image, and migration drift", async () => {
  await withFixture(async (root) => {
    const environment = completeEnvironment();
    environment.PROOFWEAVE_RELEASE_SITES_COMMIT_SHA = otherRevision;
    environment.PROOFWEAVE_RELEASE_GATEWAY_REVISION = otherRevision;
    environment.PROOFWEAVE_RELEASE_RUNNER_REVISION = otherRevision;
    environment.PROOFWEAVE_RELEASE_E2B_TEMPLATE_ID = "template:stale";
    environment.PROOFWEAVE_RELEASE_E2B_TEMPLATE_BUILD_ID = "stale-build";
    environment.PROOFWEAVE_RELEASE_RUNNER_IMAGE_DIGEST = otherImageDigest;
    environment.PROOFWEAVE_RELEASE_MIGRATION_HEAD = "0041_allow_content_hash_aliases.sql";

    const result = createReleaseManifest({
      root,
      mode: "release",
      environment,
      source: cleanSource(),
    });

    assert.equal(result.exitCode, 1);
    const codes = issueCodes(result);
    assert.equal(codes.has("SITES_REVISION_MISMATCH"), true);
    assert.equal(codes.has("GATEWAY_REVISION_MISMATCH"), true);
    assert.equal(codes.has("RUNNER_REVISION_MISMATCH"), true);
    assert.equal(codes.has("E2B_TEMPLATE_MISMATCH"), true);
    assert.equal(codes.has("E2B_TEMPLATE_BUILD_MISMATCH"), true);
    assert.equal(codes.has("RUNNER_IMAGE_DEPLOYMENT_MISMATCH"), true);
    assert.equal(codes.has("MIGRATION_HEAD_MISMATCH"), true);
  });
});

test("release strict mode accepts only an explicit Turso database authority", async () => {
  await withFixture(async (root) => {
    const unknownEnvironment = completeEnvironment();
    unknownEnvironment.PROOFWEAVE_RELEASE_DATABASE_AUTHORITY = "unknown";
    const unknown = createReleaseManifest({
      root,
      mode: "release",
      environment: unknownEnvironment,
      source: cleanSource(),
    });
    assert.equal(unknown.exitCode, 1);
    assert.equal(unknown.manifest.database.authority, null);
    assert.equal(issueCodes(unknown).has("DATABASE_AUTHORITY_MISSING"), true);

    const sitesEnvironment = completeEnvironment();
    sitesEnvironment.PROOFWEAVE_RELEASE_DATABASE_AUTHORITY = "sites_d1";
    const sites = createReleaseManifest({
      root,
      mode: "release",
      environment: sitesEnvironment,
      source: cleanSource(),
    });
    assert.equal(sites.exitCode, 1);
    assert.equal(sites.manifest.database.authority, "sites_d1");
    assert.equal(issueCodes(sites).has("DATABASE_AUTHORITY_NOT_TURSO"), true);
  });
});

test("release strict mode requires matching lowercase database fingerprints", async () => {
  await withFixture(async (root) => {
    const mismatchEnvironment = completeEnvironment();
    mismatchEnvironment.PROOFWEAVE_RELEASE_RUNNER_FINGERPRINT = otherDatabaseFingerprint;
    const mismatch = createReleaseManifest({
      root,
      mode: "release",
      environment: mismatchEnvironment,
      source: cleanSource(),
    });
    assert.equal(mismatch.exitCode, 1);
    assert.equal(issueCodes(mismatch).has("DATABASE_FINGERPRINT_MISMATCH"), true);

    const malformedEnvironment = completeEnvironment();
    malformedEnvironment.PROOFWEAVE_RELEASE_GATEWAY_FINGERPRINT = databaseFingerprint.toUpperCase();
    const malformed = createReleaseManifest({
      root,
      mode: "release",
      environment: malformedEnvironment,
      source: cleanSource(),
    });
    assert.equal(malformed.exitCode, 1);
    assert.equal(malformed.manifest.database.gatewayFingerprint, null);
    assert.equal(issueCodes(malformed).has("GATEWAY_DATABASE_FINGERPRINT_MISSING"), true);
  });
});

test("release manifest never projects unrelated credential environment values", async () => {
  await withFixture(async (root) => {
    const sentinel = "do-not-project-this-secret";
    const environment = {
      ...completeEnvironment(),
      TURSO_AUTH_TOKEN: sentinel,
      TURSO_DATABASE_URL: `libsql://user:${sentinel}@example.invalid`,
      E2B_API_KEY: sentinel,
      RUNNER_RESULT_PRIVATE_KEY_JWK: `{"d":"${sentinel}"}`,
      PROOFWEAVE_RUNNER_WAKE_TOKEN: sentinel,
      OPENAI_API_KEY: sentinel,
    };
    const result = createReleaseManifest({
      root,
      mode: "release",
      environment,
      source: cleanSource(),
    });
    const rendered = stableManifestJson(result.manifest);

    assert.equal(result.exitCode, 0);
    assert.equal(rendered.includes(sentinel), false);
    assert.equal(rendered.includes("TURSO_AUTH_TOKEN"), false);
    assert.equal(rendered.includes("TURSO_DATABASE_URL"), false);
    assert.equal(rendered.includes("PRIVATE_KEY"), false);
    assert.equal(rendered.includes("API_KEY"), false);
  });
});

test("release manifest fails closed when any write-surface mode is invalid or implicit", async () => {
  await withFixture(async (root) => {
    const environment = completeEnvironment();
    delete environment.PROOFWEAVE_PARTICIPANT_CONTROL_PLANE_MODE;
    environment.PROOFWEAVE_MCP_CONTROL_PLANE_MODE = "enabled";

    const result = createReleaseManifest({
      root,
      mode: "release",
      environment,
      source: cleanSource(),
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.manifest.operationModes.participant, null);
    assert.equal(result.manifest.operationModes.mcp, null);
    const codes = issueCodes(result);
    assert.equal(codes.has("PARTICIPANT_OPERATION_MODE_MISSING"), true);
    assert.equal(codes.has("MCP_OPERATION_MODE_MISSING"), true);
  });
});

test("release manifest chooses the latest numbered SQL migration head", async () => {
  await withFixture(async (root) => {
    await writeFile(join(root, "drizzle", "0043_future_change.sql"), "-- future\n");
    await writeFile(join(root, "drizzle", "README.md"), "not a migration\n");
    const environment = completeEnvironment();
    environment.PROOFWEAVE_RELEASE_MIGRATION_HEAD = "0043_future_change.sql";

    const result = createReleaseManifest({
      root,
      mode: "release",
      environment,
      source: cleanSource(),
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.manifest.database.repositoryMigrationHead, "0043_future_change.sql");
    assert.equal(result.manifest.database.deployedMigrationHead, "0043_future_change.sql");
  });
});

test("inspection mode reports incomplete state without failing", async () => {
  await withFixture(async (root) => {
    const result = createReleaseManifest({
      root,
      mode: "inspection",
      environment: {},
      source: { ...cleanSource(), clean: false },
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.manifest.validation.mode, "inspection");
    assert.equal(result.manifest.validation.state, "incomplete");
    assert.equal(issueCodes(result).has("SOURCE_DIRTY"), true);
  });
});

function completeOptions(root) {
  return {
    root,
    mode: "release",
    environment: completeEnvironment(),
    source: cleanSource(),
  };
}

function completeEnvironment() {
  return {
    PROOFWEAVE_RELEASE_SITES_VERSION: "version-136",
    PROOFWEAVE_RELEASE_SITES_COMMIT_SHA: sourceRevision,
    PROOFWEAVE_RELEASE_GATEWAY_REVISION: sourceRevision,
    PROOFWEAVE_RELEASE_RUNNER_REVISION: sourceRevision,
    PROOFWEAVE_RELEASE_E2B_TEMPLATE_ID: templateId,
    PROOFWEAVE_RELEASE_E2B_TEMPLATE_BUILD_ID: templateBuildId,
    PROOFWEAVE_RELEASE_RUNNER_IMAGE_DIGEST: imageDigest,
    PROOFWEAVE_RELEASE_MIGRATION_HEAD: migrationHead,
    PROOFWEAVE_RELEASE_DATABASE_AUTHORITY: "turso",
    PROOFWEAVE_RELEASE_GATEWAY_FINGERPRINT: databaseFingerprint,
    PROOFWEAVE_RELEASE_RUNNER_FINGERPRINT: databaseFingerprint,
    PROOFWEAVE_CONTROL_PLANE_MODE: "read_only",
    PROOFWEAVE_PARTICIPANT_CONTROL_PLANE_MODE: "read_only",
    PROOFWEAVE_MCP_CONTROL_PLANE_MODE: "read_only",
  };
}

function cleanSource() {
  return {
    gitSha: sourceRevision,
    originMainSha: sourceRevision,
    branch: "main",
    clean: true,
  };
}

function issueCodes(result) {
  return new Set(result.manifest.validation.issues.map((issue) => issue.code));
}

async function withFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "proofweave-release-manifest-"));
  try {
    await Promise.all([
      mkdir(join(root, ".openai"), { recursive: true }),
      mkdir(join(root, "config"), { recursive: true }),
      mkdir(join(root, "deploy", "huggingface-runner"), { recursive: true }),
      mkdir(join(root, "drizzle"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(root, ".openai", "hosting.json"),
        `${JSON.stringify({ project_id: sitesProjectId, d1: "DB" }, null, 2)}\n`,
      ),
      writeFile(
        join(root, "config", "production-drill-policy.json"),
        `${JSON.stringify({
          schemaVersion: "pw-production-drill-policy-v2",
          policyVersion: 2,
          githubRepository: { fullName: "example/proofweave", id: 123456 },
          productionAuthorities: {
            site: {
              origin: "https://proofweave.example",
              projectId: sitesProjectId,
            },
            runner: { origin: "https://runner.example" },
            turso: { databaseFingerprint },
          },
          recoveryOperatorKeys: [],
        }, null, 2)}\n`,
      ),
      writeFile(join(root, "deploy", "huggingface-runner", "render.yaml"), renderFixture()),
      writeFile(join(root, "drizzle", "0041_allow_content_hash_aliases.sql"), "-- migration\n"),
      writeFile(join(root, "drizzle", migrationHead), "-- migration\n"),
    ]);
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync(
      "git",
      ["remote", "add", "origin", "https://github.com/example/proofweave.git"],
      { cwd: root },
    );
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function renderFixture() {
  return [
    "services:",
    "  - type: web",
    "    envVars:",
    `      - key: RUNNER_APPROVED_IMAGES_JSON`,
    `        value: '[{"imageDigest":"${imageDigest}","leanToolchain":"leanprover/lean4:v4.31.0","mathlibRevision":"${mathlibRevision}"}]'`,
    "      - key: PROOFWEAVE_E2B_TEMPLATE_ID",
    `        value: ${templateId}`,
    "      - key: PROOFWEAVE_E2B_TEMPLATE_BUILD_ID",
    `        value: ${templateBuildId}`,
    "      - key: PROOFWEAVE_E2B_RUNNER_IMAGE",
    `        value: ${imageDigest}`,
    "      - key: E2B_API_KEY",
    "        sync: false",
    "",
  ].join("\n");
}
