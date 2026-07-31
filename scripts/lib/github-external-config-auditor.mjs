import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Canonical } from "../../packages/protocol/canonical-json.mjs";
import { runtimeRecoveryIsolationActiveStates } from "../../packages/protocol/runtime-recovery-isolation.mjs";

export const githubExternalConfigAuditSchemaVersion = "pw-github-external-config-audit-v1";
export const githubExternalConfigApiVersion = "2026-03-10";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultPolicyPath = path.join(repositoryRoot, "config", "github-external-config-policy.json");
const defaultRenderBlueprintPath = path.join(
  repositoryRoot,
  "deploy",
  "huggingface-runner",
  "render.yaml",
);
const fullCommitRevisionPattern = /^[a-f0-9]{40}$/;

export class GithubExternalConfigAuditError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GithubExternalConfigAuditError";
    this.code = code;
  }
}

/**
 * Observe GitHub's repository and Environment metadata without mutating it.
 *
 * The returned evidence contains variable-value hashes and secret names only.
 * GitHub tokens, secret values, response headers, and API URLs are never
 * included. Policy mismatches return passed=false; incomplete or malformed
 * provider observations throw a bounded, non-sensitive error.
 */
export async function auditGithubExternalConfiguration(options = {}) {
  requireOptions(options);
  const {
    githubToken,
    releaseCommit,
    fetchImpl = globalThis.fetch,
    repoRoot = repositoryRoot,
    policyPath = defaultPolicyPath,
    renderBlueprintPath = defaultRenderBlueprintPath,
    readFileImpl = readFile,
    readdirImpl = readdir,
    now = () => new Date(),
    apiBaseUrl = "https://api.github.com",
  } = options;
  requireSecret(githubToken);
  requireReleaseCommit(releaseCommit);
  if (
    typeof fetchImpl !== "function"
    || typeof readFileImpl !== "function"
    || typeof readdirImpl !== "function"
    || typeof now !== "function"
  ) {
    throw auditError("INVALID_DEPENDENCY", "External audit dependencies are invalid.");
  }

  const startedAt = normalizeInstant(now());
  const [policySource, renderSource] = await Promise.all([
    readBoundedUtf8(readFileImpl, policyPath, "POLICY_READ_FAILED"),
    readBoundedUtf8(readFileImpl, renderBlueprintPath, "RENDER_BLUEPRINT_READ_FAILED"),
  ]);
  const policy = normalizePolicy(parseJson(policySource, "POLICY_INVALID"));
  const expectedVariables = parseRenderBoundVariables(
    renderSource,
    policy.environment.renderBoundVariables,
  );
  const apiRoot = normalizeApiBase(apiBaseUrl);
  const repositoryPath = `/repos/${encodeRepository(policy.repository.fullName)}`;
  const environmentName = policy.environment.name;
  const environmentPath = `${repositoryPath}/environments/${encodeURIComponent(environmentName)}`;

  const [
    repository,
    environment,
    branchPolicies,
    environmentVariables,
    environmentSecrets,
    actionPermissions,
    workflowIndex,
    workflowSources,
  ] = await Promise.all([
    githubGetJson(fetchImpl, apiRoot, repositoryPath, githubToken, "REPOSITORY_OBSERVATION_FAILED"),
    githubGetJson(fetchImpl, apiRoot, environmentPath, githubToken, "ENVIRONMENT_OBSERVATION_FAILED"),
    githubGetJson(
      fetchImpl,
      apiRoot,
      `${environmentPath}/deployment-branch-policies?per_page=100`,
      githubToken,
      "BRANCH_POLICY_OBSERVATION_FAILED",
    ),
    githubGetJson(
      fetchImpl,
      apiRoot,
      `${environmentPath}/variables?per_page=100`,
      githubToken,
      "ENVIRONMENT_VARIABLE_OBSERVATION_FAILED",
    ),
    githubGetJson(
      fetchImpl,
      apiRoot,
      `${environmentPath}/secrets?per_page=100`,
      githubToken,
      "ENVIRONMENT_SECRET_OBSERVATION_FAILED",
    ),
    githubGetJson(
      fetchImpl,
      apiRoot,
      `${repositoryPath}/actions/permissions`,
      githubToken,
      "ACTIONS_PERMISSION_OBSERVATION_FAILED",
    ),
    githubGetJson(
      fetchImpl,
      apiRoot,
      `${repositoryPath}/actions/workflows?per_page=100`,
      githubToken,
      "WORKFLOW_OBSERVATION_FAILED",
    ),
    scanWorkflowActions({ repoRoot, readdirImpl, readFileImpl }),
  ]);

  const findings = [];
  const repositoryEvidence = inspectRepository(repository, policy, findings);
  const environmentEvidence = await inspectEnvironment({
    environment,
    branchPolicies,
    environmentVariables,
    environmentSecrets,
    expectedVariables,
    policy,
    findings,
  });
  const actionsEvidence = inspectActionsPermissions({
    actionPermissions,
    workflowSources,
    policy,
    findings,
  });
  const workflowsEvidence = await inspectRecoveryWorkflows({
    fetchImpl,
    apiRoot,
    repositoryPath,
    githubToken,
    workflowIndex,
    policy,
    findings,
  });
  const finishedAt = normalizeInstant(now());
  if (Date.parse(finishedAt) < Date.parse(startedAt)) {
    throw auditError("INVALID_TIME", "External audit completion precedes its start.");
  }

  findings.sort(compareFindings);
  return deepFreeze({
    schemaVersion: githubExternalConfigAuditSchemaVersion,
    passed: findings.length === 0,
    releaseCommit,
    observedAt: {
      startedAt,
      finishedAt,
    },
    policy: {
      schemaVersion: policy.schemaVersion,
      hash: await sha256Canonical(policy),
    },
    repository: repositoryEvidence,
    environment: environmentEvidence,
    repositoryActions: actionsEvidence,
    recoveryWorkflows: workflowsEvidence,
    findings,
  });
}

async function inspectEnvironment({
  environment,
  branchPolicies,
  environmentVariables,
  environmentSecrets,
  expectedVariables,
  policy,
  findings,
}) {
  const expected = policy.environment;
  if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
    throw auditError("MALFORMED_GITHUB_RESPONSE", "GitHub Environment metadata is malformed.");
  }
  if (environment.name !== expected.name) {
    addFinding(findings, "ENVIRONMENT_IDENTITY_MISMATCH", "environment", expected.name);
  }
  if (environment.can_admins_bypass !== expected.canAdminsBypass) {
    addFinding(findings, "ADMIN_BYPASS_POLICY_MISMATCH", "environment", expected.name);
  }
  if (!Array.isArray(environment.protection_rules)) {
    throw auditError("MALFORMED_GITHUB_RESPONSE", "GitHub Environment protection rules are malformed.");
  }

  const requiredReviewerRules = environment.protection_rules.filter(
    (rule) => rule?.type === "required_reviewers",
  );
  if (requiredReviewerRules.length !== 1 || !Array.isArray(requiredReviewerRules[0]?.reviewers)) {
    addFinding(findings, "REQUIRED_REVIEWER_POLICY_MISSING", "environment", expected.name);
  }
  const preventSelfReview = requiredReviewerRules.length === 1
    && typeof requiredReviewerRules[0].prevent_self_review === "boolean"
    ? requiredReviewerRules[0].prevent_self_review
    : null;
  if (preventSelfReview !== expected.preventSelfReview) {
    addFinding(findings, "SELF_REVIEW_POLICY_MISMATCH", "environment", expected.name);
  }
  const reviewers = normalizeObservedReviewers(requiredReviewerRules[0]?.reviewers ?? []);
  if (!sameJson(reviewers, expected.requiredReviewers)) {
    addFinding(findings, "REQUIRED_REVIEWER_POLICY_MISMATCH", "environment", expected.name);
  }

  const deploymentPolicy = environment.deployment_branch_policy;
  if (
    !deploymentPolicy
    || typeof deploymentPolicy !== "object"
    || Array.isArray(deploymentPolicy)
  ) {
    addFinding(findings, "DEPLOYMENT_BRANCH_POLICY_MISSING", "environment", expected.name);
  }
  const observedDeploymentPolicy = {
    protectedBranches: deploymentPolicy?.protected_branches,
    customBranchPolicies: deploymentPolicy?.custom_branch_policies,
  };
  if (
    observedDeploymentPolicy.protectedBranches !== expected.deploymentBranches.protectedBranches
    || observedDeploymentPolicy.customBranchPolicies
      !== expected.deploymentBranches.customBranchPolicies
  ) {
    addFinding(findings, "DEPLOYMENT_BRANCH_POLICY_MISMATCH", "environment", expected.name);
  }

  const branchPolicyList = requireCompleteList(
    branchPolicies,
    "branch_policies",
    "BRANCH_POLICY_OBSERVATION_INCOMPLETE",
  );
  const branchPatterns = branchPolicyList.map((entry) => {
    if (!entry || typeof entry.name !== "string" || !validBoundedName(entry.name)) {
      throw auditError("MALFORMED_GITHUB_RESPONSE", "GitHub deployment branch policy is malformed.");
    }
    return entry.name;
  }).sort(compareStrings);
  if (!sameStrings(branchPatterns, expected.deploymentBranches.patterns)) {
    addFinding(findings, "DEPLOYMENT_BRANCH_PATTERN_MISMATCH", "environment", expected.name);
  }

  const variableList = requireCompleteList(
    environmentVariables,
    "variables",
    "ENVIRONMENT_VARIABLE_OBSERVATION_INCOMPLETE",
  );
  const variablesByName = uniqueNamedEntries(variableList, {
    valueRequired: true,
    code: "MALFORMED_GITHUB_RESPONSE",
    label: "GitHub Environment variable",
  });
  const variableEvidence = [];
  for (const [name, expectedValue] of Object.entries(expectedVariables).sort(compareEntries)) {
    const observed = variablesByName.get(name);
    const expectedValueHash = await sha256Text(expectedValue);
    const observedValueHash = observed ? await sha256Text(observed.value) : null;
    const matches = observedValueHash === expectedValueHash;
    if (!matches) {
      addFinding(
        findings,
        observed ? "ENVIRONMENT_VARIABLE_VALUE_MISMATCH" : "ENVIRONMENT_VARIABLE_MISSING",
        "environment-variable",
        name,
      );
    }
    variableEvidence.push({
      name,
      expectedValueHash,
      observedValueHash,
      matches,
    });
  }

  const secretList = requireCompleteList(
    environmentSecrets,
    "secrets",
    "ENVIRONMENT_SECRET_OBSERVATION_INCOMPLETE",
  );
  const secretNames = [...uniqueNamedEntries(secretList, {
    valueRequired: false,
    code: "MALFORMED_GITHUB_RESPONSE",
    label: "GitHub Environment secret",
  }).keys()].sort(compareStrings);
  const allowedSecretNames = new Set(expected.allowedSecretNames);
  const secretViolations = [];
  for (const name of secretNames) {
    const matchedMarkers = expected.forbiddenSecretNameMarkers.filter((marker) =>
      name.toUpperCase().includes(marker)
    );
    if (matchedMarkers.length > 0) {
      secretViolations.push({
        name,
        classification: "forbidden-nonproduction-marker",
        markers: matchedMarkers,
      });
      addFinding(findings, "NONPRODUCTION_SECRET_IN_PRODUCTION_ENVIRONMENT", "environment-secret", name);
    } else if (!allowedSecretNames.has(name)) {
      secretViolations.push({
        name,
        classification: "not-allowlisted",
        markers: [],
      });
      addFinding(findings, "UNREVIEWED_PRODUCTION_SECRET", "environment-secret", name);
    }
  }
  for (const name of expected.allowedSecretNames) {
    if (!secretNames.includes(name)) {
      secretViolations.push({
        name,
        classification: "required-secret-missing",
        markers: [],
      });
      addFinding(findings, "REQUIRED_PRODUCTION_SECRET_MISSING", "environment-secret", name);
    }
  }
  secretViolations.sort((left, right) => compareStrings(left.name, right.name));

  return {
    name: typeof environment.name === "string" ? environment.name : null,
    canAdminsBypass: booleanOrNull(environment.can_admins_bypass),
    preventSelfReview,
    requiredReviewers: reviewers,
    deploymentBranches: {
      ...observedDeploymentPolicy,
      patterns: branchPatterns,
    },
    variables: variableEvidence,
    secretNames,
    secretViolations,
  };
}

function inspectRepository(repository, policy, findings) {
  if (
    !repository
    || !Number.isSafeInteger(repository.id)
    || repository.id <= 0
    || typeof repository.full_name !== "string"
  ) {
    throw auditError("MALFORMED_GITHUB_RESPONSE", "GitHub repository identity is malformed.");
  }
  if (
    repository.id !== policy.repository.id
    || repository.full_name !== policy.repository.fullName
  ) {
    addFinding(findings, "REPOSITORY_IDENTITY_MISMATCH", "repository", policy.repository.fullName);
  }
  return {
    id: repository.id,
    fullName: repository.full_name,
  };
}

function inspectActionsPermissions({
  actionPermissions,
  workflowSources,
  policy,
  findings,
}) {
  if (
    !actionPermissions
    || typeof actionPermissions !== "object"
    || typeof actionPermissions.enabled !== "boolean"
    || typeof actionPermissions.allowed_actions !== "string"
    || typeof actionPermissions.sha_pinning_required !== "boolean"
  ) {
    throw auditError("MALFORMED_GITHUB_RESPONSE", "GitHub Actions permission metadata is malformed.");
  }
  if (actionPermissions.enabled !== policy.repositoryActions.enabled) {
    addFinding(findings, "ACTIONS_ENABLED_POLICY_MISMATCH", "repository-actions", "enabled");
  }
  if (
    actionPermissions.sha_pinning_required
    !== policy.repositoryActions.shaPinningRequired
  ) {
    addFinding(findings, "ACTIONS_SHA_PINNING_NOT_ENFORCED", "repository-actions", "sha-pinning");
  }
  for (const action of workflowSources.actions) {
    if (!action.pinned) {
      addFinding(
        findings,
        "WORKFLOW_ACTION_NOT_PINNED",
        "workflow-action",
        `${action.workflowPath}:${action.action}`,
      );
    }
  }
  return {
    enabled: actionPermissions.enabled,
    allowedActions: actionPermissions.allowed_actions,
    shaPinningRequired: actionPermissions.sha_pinning_required,
    workflowInventory: workflowSources.workflows,
    thirdPartyActions: workflowSources.actions,
  };
}

async function inspectRecoveryWorkflows({
  fetchImpl,
  apiRoot,
  repositoryPath,
  githubToken,
  workflowIndex,
  policy,
  findings,
}) {
  const workflows = requireCompleteList(
    workflowIndex,
    "workflows",
    "WORKFLOW_OBSERVATION_INCOMPLETE",
  );
  const evidence = [];
  for (const expectedPath of policy.recoveryWorkflows) {
    const matches = workflows.filter((entry) => entry?.path === expectedPath);
    if (matches.length !== 1) {
      addFinding(findings, "RECOVERY_WORKFLOW_IDENTITY_MISMATCH", "workflow", expectedPath);
      evidence.push({
        path: expectedPath,
        workflowId: null,
        state: null,
        activeRuns: null,
      });
      continue;
    }
    const workflow = matches[0];
    if (
      !Number.isSafeInteger(workflow.id)
      || workflow.id <= 0
      || typeof workflow.state !== "string"
    ) {
      throw auditError("MALFORMED_GITHUB_RESPONSE", "GitHub workflow identity is malformed.");
    }
    if (workflow.state !== "disabled_manually") {
      addFinding(findings, "RECOVERY_WORKFLOW_NOT_DISABLED", "workflow", expectedPath);
    }
    const activeRuns = {};
    for (const status of runtimeRecoveryIsolationActiveStates) {
      const runs = await githubGetJson(
        fetchImpl,
        apiRoot,
        `${repositoryPath}/actions/workflows/${workflow.id}/runs?status=${encodeURIComponent(status)}&per_page=1`,
        githubToken,
        "WORKFLOW_RUN_OBSERVATION_FAILED",
      );
      if (
        !Number.isSafeInteger(runs?.total_count)
        || runs.total_count < 0
        || !Array.isArray(runs.workflow_runs)
      ) {
        throw auditError("MALFORMED_GITHUB_RESPONSE", "GitHub workflow run inventory is malformed.");
      }
      activeRuns[status] = runs.total_count;
      if (runs.total_count !== 0) {
        addFinding(findings, "RECOVERY_WORKFLOW_HAS_ACTIVE_RUN", "workflow-run", `${expectedPath}:${status}`);
      }
    }
    evidence.push({
      path: expectedPath,
      workflowId: workflow.id,
      state: workflow.state,
      activeRuns,
    });
  }
  return evidence.sort((left, right) => compareStrings(left.path, right.path));
}

export async function scanWorkflowActions({
  repoRoot = repositoryRoot,
  readdirImpl = readdir,
  readFileImpl = readFile,
} = {}) {
  const workflowDirectory = path.join(repoRoot, ".github", "workflows");
  let names;
  try {
    names = await readdirImpl(workflowDirectory);
  } catch {
    throw auditError("WORKFLOW_SCAN_FAILED", "Checked-in workflows could not be enumerated.");
  }
  if (!Array.isArray(names)) {
    throw auditError("WORKFLOW_SCAN_FAILED", "Checked-in workflow inventory is malformed.");
  }
  const workflows = names
    .filter((name) => typeof name === "string" && /\.ya?ml$/.test(name))
    .sort(compareStrings)
    .map((name) => `.github/workflows/${name}`);
  if (workflows.length === 0) {
    throw auditError("WORKFLOW_SCAN_FAILED", "No checked-in workflows were found.");
  }

  const actions = [];
  for (const workflowPath of workflows) {
    const source = await readBoundedUtf8(
      readFileImpl,
      path.join(repoRoot, workflowPath),
      "WORKFLOW_SCAN_FAILED",
    );
    for (const rawLine of source.split("\n")) {
      const match = rawLine.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)\s*(?:#.*)?$/);
      if (!match) continue;
      const reference = stripYamlQuotes(match[1]);
      const parsed = parseActionReference(reference);
      actions.push({
        workflowPath,
        action: parsed.action,
        revision: parsed.revision,
        pinned: parsed.pinned,
      });
    }
  }
  actions.sort((left, right) => (
    compareStrings(left.workflowPath, right.workflowPath)
    || compareStrings(left.action, right.action)
    || compareStrings(left.revision ?? "", right.revision ?? "")
  ));
  return deepFreeze({ workflows, actions });
}

function parseActionReference(reference) {
  if (reference.startsWith("./") || reference.startsWith("../") || reference.startsWith("docker://")) {
    return {
      action: reference,
      revision: null,
      pinned: false,
    };
  }
  const at = reference.lastIndexOf("@");
  if (at <= 0 || at === reference.length - 1) {
    return {
      action: reference,
      revision: null,
      pinned: false,
    };
  }
  const action = reference.slice(0, at);
  const revision = reference.slice(at + 1);
  return {
    action,
    revision,
    pinned: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?$/.test(action)
      && fullCommitRevisionPattern.test(revision),
  };
}

function parseRenderBoundVariables(source, names) {
  const values = new Map();
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const keyMatch = lines[index].match(/^\s+- key:\s*([A-Z][A-Z0-9_]*)\s*$/);
    if (!keyMatch) continue;
    const key = keyMatch[1];
    let value;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^\s+- key:/.test(lines[cursor])) break;
      const valueMatch = lines[cursor].match(/^\s+value:\s*(.*?)\s*$/);
      if (valueMatch) {
        value = parseYamlScalar(valueMatch[1]);
        break;
      }
    }
    if (value !== undefined) {
      if (values.has(key)) {
        throw auditError("RENDER_BLUEPRINT_INVALID", "Render Blueprint contains a duplicate variable.");
      }
      values.set(key, value);
    }
  }
  const output = {};
  for (const name of names) {
    if (!values.has(name)) {
      throw auditError("RENDER_VARIABLE_MISSING", "A policy-bound Render variable has no literal value.");
    }
    output[name] = values.get(name);
  }
  return output;
}

function parseYamlScalar(value) {
  if (value.length === 0 || /[\0\r\n]/.test(value)) {
    throw auditError("RENDER_BLUEPRINT_INVALID", "Render Blueprint variable value is invalid.");
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      throw auditError("RENDER_BLUEPRINT_INVALID", "Render Blueprint single-quoted value is invalid.");
    }
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== "string") throw new Error("not string");
      return parsed;
    } catch {
      throw auditError("RENDER_BLUEPRINT_INVALID", "Render Blueprint double-quoted value is invalid.");
    }
  }
  if (/\s+#/.test(value)) {
    throw auditError("RENDER_BLUEPRINT_INVALID", "Inline comments are not allowed on bound Render variables.");
  }
  return value;
}

function normalizePolicy(value) {
  if (
    !value
    || value.schemaVersion !== "pw-github-external-config-policy-v1"
    || !value.repository
    || !Number.isSafeInteger(value.repository.id)
    || value.repository.id <= 0
    || !validRepository(value.repository.fullName)
    || !value.environment
    || !validBoundedName(value.environment.name)
    || typeof value.environment.canAdminsBypass !== "boolean"
    || typeof value.environment.preventSelfReview !== "boolean"
    || !Array.isArray(value.environment.requiredReviewers)
    || value.environment.requiredReviewers.length === 0
    || !value.environment.deploymentBranches
    || typeof value.environment.deploymentBranches.protectedBranches !== "boolean"
    || typeof value.environment.deploymentBranches.customBranchPolicies !== "boolean"
    || !uniqueBoundedStrings(value.environment.deploymentBranches.patterns)
    || !uniqueEnvironmentNames(value.environment.renderBoundVariables)
    || !uniqueEnvironmentNames(value.environment.allowedSecretNames)
    || !uniqueEnvironmentNames(value.environment.forbiddenSecretNameMarkers)
    || !uniqueBoundedStrings(value.recoveryWorkflows)
    || value.recoveryWorkflows.length === 0
    || !value.repositoryActions
    || typeof value.repositoryActions.enabled !== "boolean"
    || typeof value.repositoryActions.shaPinningRequired !== "boolean"
  ) {
    throw auditError("POLICY_INVALID", "GitHub external configuration policy is invalid.");
  }
  const requiredReviewers = value.environment.requiredReviewers.map((entry) => {
    if (
      !entry
      || !["User", "Team"].includes(entry.type)
      || !validBoundedName(entry.login)
      || !Number.isSafeInteger(entry.id)
      || entry.id <= 0
    ) {
      throw auditError("POLICY_INVALID", "GitHub required reviewer policy is invalid.");
    }
    return { type: entry.type, login: entry.login, id: entry.id };
  }).sort(compareReviewers);
  if (new Set(requiredReviewers.map((entry) => `${entry.type}:${entry.id}`)).size !== requiredReviewers.length) {
    throw auditError("POLICY_INVALID", "GitHub required reviewer policy contains duplicates.");
  }
  return deepFreeze({
    schemaVersion: value.schemaVersion,
    repository: {
      fullName: value.repository.fullName,
      id: value.repository.id,
    },
    environment: {
      name: value.environment.name,
      canAdminsBypass: value.environment.canAdminsBypass,
      preventSelfReview: value.environment.preventSelfReview,
      requiredReviewers,
      deploymentBranches: {
        protectedBranches: value.environment.deploymentBranches.protectedBranches,
        customBranchPolicies: value.environment.deploymentBranches.customBranchPolicies,
        patterns: [...value.environment.deploymentBranches.patterns].sort(compareStrings),
      },
      renderBoundVariables: [...value.environment.renderBoundVariables].sort(compareStrings),
      allowedSecretNames: [...value.environment.allowedSecretNames].sort(compareStrings),
      forbiddenSecretNameMarkers: value.environment.forbiddenSecretNameMarkers
        .map((entry) => entry.toUpperCase())
        .sort(compareStrings),
    },
    recoveryWorkflows: [...value.recoveryWorkflows].sort(compareStrings),
    repositoryActions: {
      enabled: value.repositoryActions.enabled,
      shaPinningRequired: value.repositoryActions.shaPinningRequired,
    },
  });
}

function normalizeObservedReviewers(reviewers) {
  return reviewers.map((entry) => {
    if (
      !entry
      || !["User", "Team"].includes(entry.type)
      || !entry.reviewer
      || !Number.isSafeInteger(entry.reviewer.id)
      || entry.reviewer.id <= 0
      || !validBoundedName(entry.reviewer.login)
    ) {
      throw auditError("MALFORMED_GITHUB_RESPONSE", "GitHub required reviewer metadata is malformed.");
    }
    return {
      type: entry.type,
      login: entry.reviewer.login,
      id: entry.reviewer.id,
    };
  }).sort(compareReviewers);
}

async function githubGetJson(fetchImpl, apiRoot, resourcePath, token, failureCode) {
  let response;
  try {
    response = await fetchImpl(`${apiRoot}${resourcePath}`, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": githubExternalConfigApiVersion,
      },
      redirect: "error",
    });
  } catch {
    throw auditError(failureCode, "GitHub API observation failed.");
  }
  if (!response || typeof response.status !== "number" || typeof response.text !== "function") {
    throw auditError("MALFORMED_GITHUB_RESPONSE", "GitHub API returned an invalid response.");
  }
  if (response.status === 401 || response.status === 403) {
    throw auditError("GITHUB_ACCESS_DENIED", "GitHub denied the external configuration audit.");
  }
  if (response.status < 200 || response.status >= 300) {
    throw auditError(failureCode, "GitHub API observation failed.");
  }
  let body;
  try {
    body = await response.text();
  } catch {
    throw auditError("MALFORMED_GITHUB_RESPONSE", "GitHub API response could not be read.");
  }
  if (typeof body !== "string" || body.length === 0 || body.length > 2_000_000) {
    throw auditError("MALFORMED_GITHUB_RESPONSE", "GitHub API response size is invalid.");
  }
  return parseJson(body, "MALFORMED_GITHUB_RESPONSE");
}

async function readBoundedUtf8(readFileImpl, filePath, failureCode) {
  let source;
  try {
    source = await readFileImpl(filePath, "utf8");
  } catch {
    throw auditError(failureCode, "A required audit input could not be read.");
  }
  if (typeof source !== "string" || source.length === 0 || source.length > 2_000_000) {
    throw auditError(failureCode, "A required audit input has an invalid size.");
  }
  return source;
}

function requireCompleteList(response, key, failureCode) {
  if (
    !response
    || !Number.isSafeInteger(response.total_count)
    || response.total_count < 0
    || !Array.isArray(response[key])
    || response.total_count !== response[key].length
  ) {
    throw auditError(failureCode, "GitHub returned an incomplete paginated inventory.");
  }
  return response[key];
}

function uniqueNamedEntries(entries, { valueRequired, code, label }) {
  const result = new Map();
  for (const entry of entries) {
    if (
      !entry
      || !validEnvironmentName(entry.name)
      || (valueRequired && typeof entry.value !== "string")
      || result.has(entry.name)
    ) {
      throw auditError(code, `${label} inventory is malformed.`);
    }
    result.set(entry.name, entry);
  }
  return result;
}

function addFinding(findings, code, category, resource) {
  findings.push({ code, category, resource });
}

function requireOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw auditError("INVALID_OPTIONS", "External audit options are invalid.");
  }
}

function requireSecret(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 4_096 || /[\0\r\n]/.test(value)) {
    throw auditError("INVALID_GITHUB_TOKEN", "A bounded GitHub token is required.");
  }
}

function requireReleaseCommit(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) {
    throw auditError("INVALID_RELEASE_COMMIT", "Release commit must be a full Git SHA.");
  }
}

function normalizeApiBase(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw auditError("INVALID_API_BASE", "GitHub API base is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw auditError("INVALID_API_BASE", "GitHub API base is invalid.");
  }
  return url.href.replace(/\/+$/, "");
}

function normalizeInstant(value) {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw auditError("INVALID_TIME", "External audit time is invalid.");
  }
  return new Date(milliseconds).toISOString();
}

function parseJson(source, code) {
  try {
    return JSON.parse(source);
  } catch {
    throw auditError(code, "A required JSON document is malformed.");
  }
}

async function sha256Text(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function stripYamlQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function uniqueEnvironmentNames(values) {
  return Array.isArray(values)
    && values.length > 0
    && values.every(validEnvironmentName)
    && new Set(values).size === values.length;
}

function uniqueBoundedStrings(values) {
  return Array.isArray(values)
    && values.length > 0
    && values.every(validBoundedName)
    && new Set(values).size === values.length;
}

function validRepository(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
}

function encodeRepository(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function validEnvironmentName(value) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,127}$/.test(value);
}

function validBoundedName(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 240
    && value.trim() === value
    && !/[\0\r\n]/.test(value);
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareEntries([left], [right]) {
  return compareStrings(left, right);
}

function compareReviewers(left, right) {
  return compareStrings(`${left.type}:${left.id}:${left.login}`, `${right.type}:${right.id}:${right.login}`);
}

function compareFindings(left, right) {
  return compareStrings(
    `${left.code}:${left.category}:${left.resource}`,
    `${right.code}:${right.category}:${right.resource}`,
  );
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function auditError(code, message) {
  return new GithubExternalConfigAuditError(code, message);
}
