import { pathToFileURL } from "node:url";
import { createRemoteLibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import { D1InlineArtifactStore } from "../services/artifacts/d1-inline-artifact-store.mjs";
import { D1RunnerLeaseQueue } from "../services/lean-runner/d1-runner-lease-queue.mjs";
import { PinnedRunnerImageRegistry } from "../services/lean-runner/runner-image-policy.mjs";
import { D1RemoteMcpRunnerDispatcher } from "../services/proofweave-mcp-gateway/runner-dispatch.mjs";
import { D1BuildWeekLiveClosure } from "../services/demo/d1-build-week-live-closure.mjs";

const defaultRunnerLimits = Object.freeze({
  cpuSeconds: 60,
  wallSeconds: 120,
  memoryMiB: 2_048,
  diskMiB: 1_024,
  outputBytes: 1_000_000,
});

export async function runBuildWeekLiveClosure({ phase, artifactBundleHash, environment = process.env }) {
  if (phase !== "prepare" && phase !== "finalize") {
    throw new Error("Build Week live closure phase must be prepare or finalize.");
  }
  const database = createRemoteLibsqlD1Database({
    url: required(environment, "TURSO_DATABASE_URL"),
    authToken: required(environment, "TURSO_AUTH_TOKEN"),
  });
  try {
    const mockerKeys = {
      mocker1PersonPrivateKeyJwk: jsonSetting(environment, "DEMO_MOCKER_1_PERSON_PRIVATE_KEY_JWK"),
      mocker1AgentPrivateKeyJwk: jsonSetting(environment, "DEMO_MOCKER_1_AGENT_PRIVATE_KEY_JWK"),
      mocker2PersonPrivateKeyJwk: jsonSetting(environment, "DEMO_MOCKER_2_PERSON_PRIVATE_KEY_JWK"),
      mocker2AgentPrivateKeyJwk: jsonSetting(environment, "DEMO_MOCKER_2_AGENT_PRIVATE_KEY_JWK"),
    };
    if (phase === "prepare") {
      const runnerDispatcher = new D1RemoteMcpRunnerDispatcher({
        database,
        artifactStore: new D1InlineArtifactStore({ database }),
        runnerQueue: new D1RunnerLeaseQueue({ database }),
        approvedImages: new PinnedRunnerImageRegistry({
          images: jsonSetting(environment, "RUNNER_APPROVED_IMAGES_JSON"),
        }),
        controlPlaneKeyId: required(environment, "RUNNER_CONTROL_PLANE_KEY_ID"),
        controlPlanePrivateKeyJwk: jsonSetting(environment, "RUNNER_CONTROL_PLANE_PRIVATE_KEY_JWK"),
        defaultLimits: defaultRunnerLimits,
      });
      return await new D1BuildWeekLiveClosure({
        database,
        ...mockerKeys,
        runnerDispatcher,
      }).prepare({ artifactBundleHash });
    }

    const receiptIssuerPrivateKeyJwk = jsonSetting(environment, "RECEIPT_ISSUER_PRIVATE_KEY_JWK");
    return await new D1BuildWeekLiveClosure({
      database,
      ...mockerKeys,
      receiptIssuer: {
        keyId: required(environment, "RECEIPT_ISSUER_KEY_ID"),
        publicKey: receiptIssuerPrivateKeyJwk.x,
        privateKeyJwk: receiptIssuerPrivateKeyJwk,
        activatedAt: required(environment, "RECEIPT_ISSUER_ACTIVATED_AT"),
      },
    }).finalize({ artifactBundleHash });
  } finally {
    database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [phase, artifactBundleHash] = process.argv.slice(2);
  try {
    const result = await runBuildWeekLiveClosure({ phase, artifactBundleHash });
    process.stdout.write(`${JSON.stringify({
      schemaVersion: "pw-audit-v1",
      kind: `build_week_live_closure_${phase}`,
      component: "build_week_live_closure",
      outcome: result.state,
      artifactBundleHash: result.artifactBundleHash,
      reviewerMode: "multiple_mock_owners",
      reviewerCount: result.reviewers?.length ?? null,
      replayRunId: result.replay?.runId ?? null,
      receiptId: result.receiptId ?? null,
      receiptHash: result.receiptHash ?? null,
      receiptSignatureValid: result.receiptSignatureValid ?? null,
    })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: "pw-audit-v1",
      kind: `build_week_live_closure_${phase ?? "unknown"}_failed`,
      component: "build_week_live_closure",
      outcome: "failed",
      errorCode: privacySafeErrorCode(error),
    })}\n`);
    process.exitCode = 1;
  }
}

function required(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 16_384) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function jsonSetting(environment, name) {
  let value;
  try {
    value = JSON.parse(required(environment, name));
  } catch {
    throw new Error(`${name} must be valid JSON.`);
  }
  return value;
}

function privacySafeErrorCode(error) {
  const name = typeof error?.name === "string" ? error.name : "live_closure_error";
  const normalized = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 56);
  return /^[a-z][a-z0-9_]{2,63}$/.test(normalized) ? normalized : "live_closure_error";
}
