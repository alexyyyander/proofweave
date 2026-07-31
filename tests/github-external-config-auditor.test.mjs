import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  auditGithubExternalConfiguration,
  GithubExternalConfigAuditError,
  scanWorkflowActions,
} from "../scripts/lib/github-external-config-auditor.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseCommit = "6".repeat(40);
const githubToken = "github-token-that-must-never-be-evidence";
const expectedVariables = Object.freeze({
  PROOFWEAVE_E2B_RUNNER_IMAGE:
    "ghcr.io/alexyyyander/proofweave-lean-runner@sha256:ca896ab3945034079ab7f7cedfc7c5e665a601299c1745b51a72736420957393",
  PROOFWEAVE_E2B_TEMPLATE_BUILD_ID: "c07bbdf8-db5f-4464-911a-89ad0e564399",
  PROOFWEAVE_E2B_TEMPLATE_ID: "cbfjgbsrgtku0c7sliu5:root-dotfiles-20260727g",
  RUNNER_APPROVED_IMAGES_JSON:
    '[{"imageDigest":"ghcr.io/alexyyyander/proofweave-lean-runner@sha256:ca896ab3945034079ab7f7cedfc7c5e665a601299c1745b51a72736420957393","leanToolchain":"leanprover/lean4:v4.31.0","mathlibRevision":"9a9483a92959bc92bd6a60176dd1fe597298c1f8"}]',
});

test("a reviewed provider snapshot produces privacy-safe passing evidence", async () => {
  const evidence = await auditGithubExternalConfiguration({
    githubToken,
    releaseCommit,
    repoRoot: root,
    fetchImpl: githubFixture(),
    now: sequenceClock("2026-07-31T03:00:00.000Z", "2026-07-31T03:00:02.000Z"),
  });

  assert.equal(evidence.passed, true);
  assert.equal(evidence.releaseCommit, releaseCommit);
  assert.equal(evidence.environment.variables.length, 4);
  assert.ok(evidence.environment.variables.every((entry) => (
    entry.matches
    && entry.expectedValueHash.startsWith("sha256:")
    && entry.observedValueHash === entry.expectedValueHash
  )));
  assert.deepEqual(evidence.environment.secretNames, [
  ]);
  assert.equal(evidence.environment.productionProtectionRequired, false);
  assert.deepEqual(evidence.repositoryActions.productionSecretBearingWorkflows, [
  ]);
  assert.equal(evidence.repositoryActions.shaPinningRequired, true);
  assert.ok(evidence.repositoryActions.thirdPartyActions.length > 0);
  assert.ok(evidence.repositoryActions.thirdPartyActions.every((entry) => entry.pinned));
  assert.ok(evidence.recoveryWorkflows.every((entry) => (
    entry.state === "disabled_manually"
    && Object.values(entry.activeRuns).every((count) => count === 0)
  )));

  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, new RegExp(githubToken));
  for (const value of Object.values(expectedVariables)) {
    assert.equal(serialized.includes(value), false, "raw Environment variable values must not be evidence");
  }
  assert.equal(serialized.includes("?status="), false, "API query strings must not be evidence");
  assert.equal(serialized.includes("Authorization"), false);
});

test("configuration drift is classified and fails closed", async () => {
  const fetchImpl = githubFixture({
    environment: {
      can_admins_bypass: true,
      protection_rules: [],
      deployment_branch_policy: null,
    },
    branchPatterns: [],
    variables: {
      ...expectedVariables,
      PROOFWEAVE_E2B_TEMPLATE_ID: "stale-template",
    },
    secrets: [
      "DEMO_MOCKER_1_AGENT_PRIVATE_KEY_JWK",
      "E2B_API_KEY",
      "RUNNER_CONTROL_PLANE_PRIVATE_KEY_JWK",
      "RUNNER_RESULT_PRIVATE_KEY_JWK",
      "TURSO_AUTH_TOKEN",
      "TURSO_DATABASE_URL",
    ],
    shaPinningRequired: false,
    workflowState: "active",
    activeStatus: "queued",
  });

  const evidence = await auditGithubExternalConfiguration({
    githubToken,
    releaseCommit,
    repoRoot: root,
    fetchImpl,
    readFileImpl: secretBearingWorkflowSource,
    now: sequenceClock("2026-07-31T03:00:00.000Z", "2026-07-31T03:00:01.000Z"),
  });
  const codes = new Set(evidence.findings.map((entry) => entry.code));

  assert.equal(evidence.passed, false);
  for (const expectedCode of [
    "ADMIN_BYPASS_POLICY_MISMATCH",
    "SELF_REVIEW_POLICY_MISMATCH",
    "REQUIRED_REVIEWER_POLICY_MISSING",
    "REQUIRED_REVIEWER_POLICY_MISMATCH",
    "DEPLOYMENT_BRANCH_POLICY_MISSING",
    "DEPLOYMENT_BRANCH_POLICY_MISMATCH",
    "DEPLOYMENT_BRANCH_PATTERN_MISMATCH",
    "ENVIRONMENT_VARIABLE_VALUE_MISMATCH",
    "PRODUCTION_ENVIRONMENT_SECRET_PRESENT",
    "PRODUCTION_SECRET_BEARING_WORKFLOW_PRESENT",
    "NONPRODUCTION_SECRET_IN_PRODUCTION_ENVIRONMENT",
    "UNREVIEWED_PRODUCTION_SECRET",
    "ACTIONS_SHA_PINNING_NOT_ENFORCED",
    "RECOVERY_WORKFLOW_NOT_DISABLED",
    "RECOVERY_WORKFLOW_HAS_ACTIVE_RUN",
  ]) {
    assert.ok(codes.has(expectedCode), `missing finding ${expectedCode}`);
  }
  assert.deepEqual(
    evidence.environment.secretViolations.find(
      (entry) => entry.name === "DEMO_MOCKER_1_AGENT_PRIVATE_KEY_JWK",
    )?.classification,
    "forbidden-nonproduction-marker",
  );
  assert.ok(evidence.environment.secretViolations.every(
    (entry) => entry.classification !== "required-secret-missing",
  ));
  assert.equal(JSON.stringify(evidence).includes("stale-template"), false);
});

test("any production Environment secret fails even without executable recovery", async () => {
  const evidence = await auditGithubExternalConfiguration({
    githubToken,
    releaseCommit,
    repoRoot: root,
    fetchImpl: githubFixture({
      secrets: ["E2B_API_KEY"],
    }),
    now: sequenceClock("2026-07-31T03:00:00.000Z", "2026-07-31T03:00:01.000Z"),
  });

  assert.equal(evidence.passed, false);
  assert.equal(evidence.environment.productionProtectionRequired, false);
  assert.ok(evidence.findings.some(
    (entry) => entry.code === "PRODUCTION_ENVIRONMENT_SECRET_PRESENT",
  ));
  assert.ok(!evidence.findings.some(
    (entry) => entry.code === "REQUIRED_REVIEWER_POLICY_MISSING",
  ));
});

test("mapped or dynamic Environment authority activates production protection checks", async (context) => {
  for (const [label, environmentDeclaration] of [
    ["mapped", "    environment:\n      name: proofweave-runner-alpha"],
    ["dynamic", "    environment: ${{ inputs.environment_name }}"],
  ]) {
    await context.test(label, async () => {
      const readFileImpl = async (filePath, encoding) => {
        const source = await readFile(filePath, encoding);
        if (!String(filePath).endsWith(".github/workflows/e2b-lean-runner.yml")) return source;
        return source.replace(
          "    runs-on: ubuntu-latest",
          [
            "    runs-on: ubuntu-latest",
            environmentDeclaration,
            "    env:",
            "      E2B_API_KEY: ${{ secrets['E2B_API_KEY'] }}",
          ].join("\n"),
        );
      };
      const evidence = await auditGithubExternalConfiguration({
        githubToken,
        releaseCommit,
        repoRoot: root,
        fetchImpl: githubFixture(),
        readFileImpl,
        now: sequenceClock("2026-07-31T03:00:00.000Z", "2026-07-31T03:00:01.000Z"),
      });

      assert.equal(evidence.passed, false);
      assert.equal(evidence.environment.productionProtectionRequired, true);
      assert.ok(evidence.findings.some(
        (entry) => entry.code === "PRODUCTION_SECRET_BEARING_WORKFLOW_PRESENT",
      ));
      assert.ok(evidence.findings.some(
        (entry) => entry.code === "REQUIRED_REVIEWER_POLICY_MISSING",
      ));
    });
  }
});

test("an unpinned checked-in action is reported without executing it", async () => {
  const readFileImpl = async (filePath, encoding) => {
    const source = await readFile(filePath, encoding);
    if (String(filePath).endsWith(".github/workflows/ci.yml")) {
      return source.replace(
        "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
        "actions/checkout@v4",
      );
    }
    return source;
  };
  const evidence = await auditGithubExternalConfiguration({
    githubToken,
    releaseCommit,
    repoRoot: root,
    fetchImpl: githubFixture(),
    readFileImpl,
    now: sequenceClock("2026-07-31T03:00:00.000Z", "2026-07-31T03:00:01.000Z"),
  });

  assert.equal(evidence.passed, false);
  assert.ok(evidence.findings.some((entry) => (
    entry.code === "WORKFLOW_ACTION_NOT_PINNED"
    && entry.resource.includes("actions/checkout")
  )));
  assert.ok(evidence.repositoryActions.thirdPartyActions.some((entry) => (
    entry.action === "actions/checkout" && entry.revision === "v4" && !entry.pinned
  )));
});

test("incomplete provider pagination aborts instead of passing", async () => {
  const fetchImpl = githubFixture({ incompleteSecrets: true });
  await assert.rejects(
    () => auditGithubExternalConfiguration({
      githubToken,
      releaseCommit,
      repoRoot: root,
      fetchImpl,
      now: sequenceClock("2026-07-31T03:00:00.000Z", "2026-07-31T03:00:01.000Z"),
    }),
    (error) => (
      error instanceof GithubExternalConfigAuditError
      && error.code === "ENVIRONMENT_SECRET_OBSERVATION_INCOMPLETE"
      && !error.message.includes(githubToken)
    ),
  );
});

test("network failures expose only a bounded error, not credentials or URLs", async () => {
  await assert.rejects(
    () => auditGithubExternalConfiguration({
      githubToken,
      releaseCommit,
      repoRoot: root,
      fetchImpl: async () => {
        throw new Error(`request failed with ${githubToken}?access_token=leak`);
      },
      now: sequenceClock("2026-07-31T03:00:00.000Z", "2026-07-31T03:00:01.000Z"),
    }),
    (error) => (
      error instanceof GithubExternalConfigAuditError
      && error.code.endsWith("_OBSERVATION_FAILED")
      && !error.message.includes(githubToken)
      && !error.message.includes("?")
    ),
  );
});

test("the repository workflow inventory is completely SHA pinned", async () => {
  const inventory = await scanWorkflowActions({ repoRoot: root });
  assert.ok(inventory.workflows.length >= 5);
  assert.ok(inventory.actions.length >= 10);
  assert.ok(inventory.actions.every((entry) => entry.pinned));
});

function githubFixture(options = {}) {
  const reviewerRule = {
    type: "required_reviewers",
    prevent_self_review: options.preventSelfReview ?? false,
    reviewers: [
      {
        type: "User",
        reviewer: {
          id: 87079793,
          login: "alexyyyander",
        },
      },
    ],
  };
  const environment = {
    name: "proofweave-runner-alpha",
    can_admins_bypass: true,
    prevent_self_review: false,
    protection_rules: [],
    deployment_branch_policy: {
      protected_branches: false,
      custom_branch_policies: true,
    },
    ...(options.environment ?? {}),
  };
  const variables = options.variables ?? expectedVariables;
  if (options.withReviewerRule) environment.protection_rules = [reviewerRule];
  const secrets = options.secrets ?? [];
  const workflows = [
    {
      id: 101,
      path: ".github/workflows/build-week-live-receipt.yml",
      state: options.workflowState ?? "disabled_manually",
    },
    {
      id: 102,
      path: ".github/workflows/e2b-lean-runner.yml",
      state: options.workflowState ?? "disabled_manually",
    },
  ];

  return async (input, init) => {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, `Bearer ${githubToken}`);
    const url = new URL(input);
    assert.equal(url.origin, "https://api.github.com");
    const base = "/repos/alexyyyander/proofweave";
    let body;

    if (url.pathname === base && url.search === "") {
      body = { id: 1298911069, full_name: "alexyyyander/proofweave" };
    } else if (url.pathname === `${base}/environments/proofweave-runner-alpha` && url.search === "") {
      body = environment;
    } else if (url.pathname.endsWith("/deployment-branch-policies")) {
      const entries = (options.branchPatterns ?? ["main", "release/*"]).map((name, index) => ({
        id: index + 1,
        name,
      }));
      body = { total_count: entries.length, branch_policies: entries };
    } else if (url.pathname.endsWith("/variables")) {
      const entries = Object.entries(variables).map(([name, value]) => ({ name, value }));
      body = { total_count: entries.length, variables: entries };
    } else if (url.pathname.endsWith("/secrets")) {
      body = {
        total_count: secrets.length + (options.incompleteSecrets ? 1 : 0),
        secrets: secrets.map((name) => ({ name })),
      };
    } else if (url.pathname === `${base}/actions/permissions`) {
      body = {
        enabled: true,
        allowed_actions: "all",
        sha_pinning_required: options.shaPinningRequired ?? true,
      };
    } else if (url.pathname === `${base}/actions/workflows`) {
      body = { total_count: workflows.length, workflows };
    } else {
      const runMatch = url.pathname.match(new RegExp(`^${base}/actions/workflows/(101|102)/runs$`));
      assert.ok(runMatch, `unexpected GitHub fixture path ${url.pathname}`);
      const status = url.searchParams.get("status");
      const active = status === options.activeStatus;
      body = { total_count: active ? 1 : 0, workflow_runs: active ? [{ id: 1 }] : [] };
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

async function secretBearingWorkflowSource(filePath, encoding) {
  const source = await readFile(filePath, encoding);
  if (!String(filePath).endsWith(".github/workflows/e2b-lean-runner.yml")) return source;
  return source.replace(
    "    runs-on: ubuntu-latest",
    [
      "    runs-on: ubuntu-latest",
      "    environment: proofweave-runner-alpha",
      "    env:",
      "      E2B_API_KEY: ${{ secrets.E2B_API_KEY }}",
    ].join("\n"),
  );
}

function sequenceClock(...values) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}
