import { pathToFileURL } from "node:url";

const DEFAULT_BASE_URL = "https://proofweave-research.yualex031821.chatgpt.site";
const EXPECTED_REFERENCE_CHECKS = 6;

export async function checkBuildWeekDemoRelease({
  baseUrl = process.env.PROOFWEAVE_DEMO_BASE_URL ?? DEFAULT_BASE_URL,
  fetchImpl = fetch,
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const startedAt = Date.now();

  const homepage = await getText(fetchImpl, `${normalizedBaseUrl}/`);
  requireText(homepage.body, "See a proof become", "homepage story");
  requireText(homepage.body, "public contribution.", "homepage story outcome");
  requireText(homepage.body, "proof-journey", "homepage proof-journey anchor");

  const demo = await getText(fetchImpl, `${normalizedBaseUrl}/demo`);
  requireText(demo.body, "Watch one Lean proof become", "demo introduction");
  requireText(demo.body, "verifiable evidence.", "demo introduction outcome");
  requireText(demo.body, "A real cloud replay reached a signed Receipt.", "live-network record");

  const reference = await getJson(fetchImpl, `${normalizedBaseUrl}/api/demo/verify`);
  if (reference.body?.status !== "verified") {
    throw new Error("Reference verifier did not return status=verified.");
  }
  const passedChecks = Array.isArray(reference.body?.checks)
    ? reference.body.checks.filter((check) => check?.passed === true).length
    : 0;
  if (passedChecks !== EXPECTED_REFERENCE_CHECKS) {
    throw new Error(`Reference verifier passed ${passedChecks}/${EXPECTED_REFERENCE_CHECKS} checks.`);
  }

  const tamper = await getJson(fetchImpl, `${normalizedBaseUrl}/api/demo/verify?tamper=artifact`);
  if (tamper.body?.status !== "failed" || tamper.body?.mode !== "tampered_copy") {
    throw new Error("Tamper test did not fail closed in tampered_copy mode.");
  }
  if (!tamper.body?.checks?.some((check) => check?.id === "objects" && check?.passed === false)) {
    throw new Error("Tamper test did not reject the modified artifact bytes.");
  }

  const receiptPath = extractReceiptPath(demo.body);
  const receipt = await getText(fetchImpl, `${normalizedBaseUrl}${receiptPath}`);
  requireText(receipt.body, "Public evidence record", "live Receipt page");
  requireText(receipt.body, "ProofweaveCloudSmoke.true_is_inhabited", "live Receipt target");

  return {
    schemaVersion: "pw-audit-v1",
    kind: "build_week_demo_release_checked",
    component: "build_week_demo",
    outcome: "passed",
    baseUrl: normalizedBaseUrl,
    referenceChecks: `${passedChecks}/${EXPECTED_REFERENCE_CHECKS}`,
    tamperRejected: true,
    receiptPath,
    checkedRoutes: ["/", "/demo", "/api/demo/verify", "/api/demo/verify?tamper=artifact", receiptPath],
    durationMs: Date.now() - startedAt,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkBuildWeekDemoRelease({ baseUrl: process.argv[2] }).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: "pw-audit-v1",
      kind: "build_week_demo_release_check_failed",
      component: "build_week_demo",
      outcome: "failed",
      errorCode: safeErrorCode(error),
      message: error instanceof Error ? error.message : "Build Week demo release check failed.",
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}

function normalizeBaseUrl(value) {
  const url = new URL(value ?? DEFAULT_BASE_URL);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("Demo release checks require HTTPS outside localhost.");
  }
  return url.toString().replace(/\/$/, "");
}

async function getText(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${new URL(url).pathname} returned HTTP ${response.status}.`);
  return { response, body: await response.text() };
}

async function getJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${new URL(url).pathname} returned HTTP ${response.status}.`);
  return { response, body: await response.json() };
}

function requireText(value, expected, label) {
  if (!value.includes(expected)) throw new Error(`${label} is missing.`);
}

function extractReceiptPath(html) {
  const match = html.match(/href=["'](\/receipt\/receipt%3A[0-9a-f]{64})["']/i);
  if (!match) throw new Error("The demo page does not expose a live Receipt link.");
  return match[1];
}

function safeErrorCode(error) {
  const value = typeof error?.name === "string" ? error.name : "demo_release_error";
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return /^[a-z][a-z0-9_]{2,63}$/.test(normalized) ? normalized : "demo_release_error";
}
