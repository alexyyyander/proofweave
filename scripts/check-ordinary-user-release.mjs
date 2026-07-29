import { pathToFileURL } from "node:url";

const DEFAULT_TARGET = "erdos-865-k2";
const VALID_MODES = new Set(["read_only", "read_write"]);
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Read-only preflight for the public portion of the ordinary-user journey.
 *
 * This deliberately uses unauthenticated GET requests only. It does not create
 * a Person, connect an Agent, create an Attempt, stage evidence, enqueue Lean,
 * submit a review, or issue a Receipt.
 */
export async function checkOrdinaryUserRelease({
  baseUrl,
  expectMode,
  fetchImpl = fetch,
  target = DEFAULT_TARGET,
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const expectedMode = normalizeExpectedMode(expectMode);
  const startedAt = Date.now();
  const checkedRoutes = [];

  const homepage = await getText(fetchImpl, normalizedBaseUrl, "/", checkedRoutes);
  requireAnyText(homepage.body, [
    "Advance mathematics through your Agent",
    "Proofweave",
  ], "homepage identity");

  const explore = await getText(fetchImpl, normalizedBaseUrl, "/explore", checkedRoutes);
  requireAnyText(explore.body, [
    "Find where your Agent can make a useful contribution",
    "research opportunities",
  ], "public research catalog");

  const targetPath = `/explore/${encodeURIComponent(target)}`;
  const targetPage = await getText(fetchImpl, normalizedBaseUrl, targetPath, checkedRoutes);
  requireText(targetPage.body, target, "pinned target slug");
  requireAnyText(targetPage.body, [
    "Start with my Agent",
    "Research record",
    "Pinned source",
  ], "pinned target research context");

  const demo = await getText(fetchImpl, normalizedBaseUrl, "/demo", checkedRoutes);
  requireAnyText(demo.body, [
    "Watch one Lean proof become",
    "Re-verify signed evidence",
  ], "verified demo");

  const startPath = `/start?target=${encodeURIComponent(target)}`;
  const start = await request(fetchImpl, normalizedBaseUrl, startPath, {
    accept: "text/html",
    redirect: "manual",
  }, checkedRoutes);
  if (start.response.status < 300 || start.response.status >= 400) {
    throw diagnostic(startPath, `expected a redirect, received HTTP ${start.response.status}`);
  }
  const startLocation = start.response.headers.get("location");
  requireTargetInLocation(startLocation, target, startPath);
  const returnTo = `/workbench?target=${target}#research-launcher`;

  const signInPath = `/sign-in?return_to=${encodeURIComponent(returnTo)}`;
  const signIn = await getText(fetchImpl, normalizedBaseUrl, signInPath, checkedRoutes);
  const providers = inspectProviderState(signIn.body, signInPath);
  requireEncodedReturnPath(signIn.body, returnTo, signInPath);

  const integrationsPath = `/integrations?target=${encodeURIComponent(target)}&return_to=${encodeURIComponent(returnTo)}`;
  const integrations = await getText(fetchImpl, normalizedBaseUrl, integrationsPath, checkedRoutes);
  requireText(integrations.body, target, "selected target on Agent connection page");
  requireAnyText(integrations.body, [
    "Your target remains selected during connection.",
    `href="/explore/${target}"`,
  ], "selected target connection context");
  if (expectedMode === "read_only") {
    requireText(
      integrations.body,
      "Connections are temporarily paused for maintenance.",
      "read-only connection maintenance boundary",
    );
    requireText(
      integrations.body,
      "No Agent connection, research task, or evidence write can complete",
      "read-only write boundary",
    );
  } else if (/Connections are temporarily paused for maintenance\./i.test(integrations.body)) {
    throw diagnostic(integrationsPath, "reports maintenance while read_write was expected");
  }

  const capabilitiesPath = "/api/mcp/capabilities";
  const capabilities = await getJson(
    fetchImpl,
    normalizedBaseUrl,
    capabilitiesPath,
    checkedRoutes,
    [200, 503],
  );
  const operations = capabilities.body?.controlPlaneOperations;
  if (!operations || typeof operations !== "object") {
    throw diagnostic(capabilitiesPath, "is missing controlPlaneOperations");
  }
  if (operations.mode !== expectedMode) {
    throw diagnostic(
      capabilitiesPath,
      `reported mode=${JSON.stringify(operations.mode)}; expected ${expectedMode}`,
    );
  }
  const expectedWritesEnabled = expectedMode === "read_write";
  if (operations.writesEnabled !== expectedWritesEnabled) {
    throw diagnostic(
      capabilitiesPath,
      `reported writesEnabled=${JSON.stringify(operations.writesEnabled)}; expected ${expectedWritesEnabled}`,
    );
  }

  const verificationPath = "/api/demo/verify";
  const verification = await getJson(fetchImpl, normalizedBaseUrl, verificationPath, checkedRoutes);
  if (verification.body?.status !== "verified") {
    throw diagnostic(verificationPath, "did not return status=verified");
  }
  if (verification.body?.executionBoundary?.signedEvidenceReverified !== true) {
    throw diagnostic(verificationPath, "did not affirm signed-evidence re-verification");
  }
  if (verification.body?.executionBoundary?.leanReplay !== "not_run_by_this_request") {
    throw diagnostic(
      verificationPath,
      "did not state that fresh Lean replay is outside this request",
    );
  }

  return {
    schemaVersion: "pw-ordinary-user-release-preflight-v1",
    outcome: "passed",
    baseUrl: normalizedBaseUrl,
    expectedMode,
    writesEnabled: expectedWritesEnabled,
    target,
    providers,
    demoVerification: {
      signedEvidenceReverified: true,
      freshLeanReplay: false,
    },
    requestPolicy: "unauthenticated_get_only",
    checkedRoutes,
    durationMs: Date.now() - startedAt,
    residualGate: [
      "authenticated Person sign-in",
      "Agent connection",
      "Attempt create/resume/close",
      "checkpoint and Bundle publication",
      "isolated Runner execution",
      "different-owner review",
      "Contribution Receipt issuance",
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseCliArgs(process.argv.slice(2));
  checkOrdinaryUserRelease(options).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: "pw-ordinary-user-release-preflight-v1",
      outcome: "failed",
      errorCode: safeErrorCode(error),
      message: error instanceof Error ? error.message : "Ordinary-user release preflight failed.",
      boundary: "No write request was attempted. Authenticated and contribution-path checks remain separate.",
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}

function parseCliArgs(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const [name, inlineValue] = token.split("=", 2);
    const value = inlineValue ?? args[index + 1];
    if (!inlineValue) index += 1;
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    if (!["--base-url", "--expect-mode", "--target"].includes(name)) {
      throw new Error(`Unknown option: ${name}`);
    }
    values.set(name, value);
  }
  return {
    baseUrl: values.get("--base-url"),
    expectMode: values.get("--expect-mode"),
    target: values.get("--target") ?? DEFAULT_TARGET,
  };
}

function normalizeBaseUrl(value) {
  if (!value) {
    throw new Error("--base-url is required.");
  }
  const url = new URL(value);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("Release preflight requires HTTPS outside localhost.");
  }
  if (url.username || url.password) {
    throw new Error("Release preflight base URL must not contain credentials.");
  }
  return url.toString().replace(/\/$/, "");
}

function normalizeExpectedMode(value) {
  if (!VALID_MODES.has(value)) {
    throw new Error("--expect-mode must be read_only or read_write.");
  }
  return value;
}

async function getText(fetchImpl, baseUrl, path, checkedRoutes) {
  const result = await request(fetchImpl, baseUrl, path, {
    accept: "text/html",
    redirect: "follow",
  }, checkedRoutes);
  if (!result.response.ok) {
    throw diagnostic(path, `returned HTTP ${result.response.status}`);
  }
  return { ...result, body: await result.response.text() };
}

async function getJson(fetchImpl, baseUrl, path, checkedRoutes, acceptedStatuses = [200]) {
  const result = await request(fetchImpl, baseUrl, path, {
    accept: "application/json",
    redirect: "follow",
  }, checkedRoutes);
  if (!acceptedStatuses.includes(result.response.status)) {
    throw diagnostic(path, `returned HTTP ${result.response.status}`);
  }
  let body;
  try {
    body = await result.response.json();
  } catch {
    throw diagnostic(path, "did not return valid JSON");
  }
  return { ...result, body };
}

async function request(fetchImpl, baseUrl, path, { accept, redirect }, checkedRoutes) {
  const url = new URL(path, `${baseUrl}/`).toString();
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { accept },
      redirect,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw diagnostic(path, `request failed: ${error instanceof Error ? error.message : "unknown network error"}`);
  }
  checkedRoutes.push(path);
  return { response };
}

function inspectProviderState(body, path) {
  const chatGPTAvailable = /href="\/signin-with-chatgpt\?return_to=/i.test(body)
    && /Continue with ChatGPT/i.test(body);
  if (!chatGPTAvailable) {
    throw diagnostic(path, "does not advertise the available ChatGPT sign-in route");
  }

  const googleAvailable = /href="\/auth\/google\/start\?return_to=/i.test(body);
  const googleUnavailable = /Continue with Google[\s\S]{0,500}(not available yet|finishes Google OAuth setup|Soon)/i.test(body);
  if (googleAvailable === googleUnavailable) {
    throw diagnostic(path, "does not expose one unambiguous Google provider state");
  }

  return {
    chatGPT: "available",
    google: googleAvailable ? "available" : "unavailable",
  };
}

function requireEncodedReturnPath(body, returnTo, path) {
  const encoded = encodeURIComponent(returnTo);
  if (!body.includes(encoded)) {
    throw diagnostic(path, `does not preserve return_to=${returnTo}`);
  }
}

function requireTargetInLocation(location, target, path) {
  if (!location) throw diagnostic(path, "redirect is missing a Location header");
  const decoded = decodeURIComponent(location);
  if (!decoded.includes(`/workbench?target=${target}`)) {
    throw diagnostic(path, `redirect lost target=${target}: ${location}`);
  }
}

function requireText(value, expected, label) {
  if (!value.includes(expected)) throw new Error(`${label} is missing.`);
}

function requireAnyText(value, expectedValues, label) {
  if (!expectedValues.some((expected) => value.includes(expected))) {
    throw new Error(`${label} is missing.`);
  }
}

function diagnostic(path, message) {
  return new Error(`${path}: ${message}.`);
}

function safeErrorCode(error) {
  const value = typeof error?.name === "string" ? error.name : "ordinary_user_release_error";
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return /^[a-z][a-z0-9_]{2,63}$/.test(normalized)
    ? normalized
    : "ordinary_user_release_error";
}
