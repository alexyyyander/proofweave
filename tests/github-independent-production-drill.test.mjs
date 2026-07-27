import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createGithubIndependentProductionDrill,
  GithubIndependentDrillError,
  githubIndependentDrillConfirmations,
} from "../scripts/run-github-independent-production-drill.mjs";
import {
  contributionReceiptHash,
  createContributionReceipt,
} from "../packages/protocol/contribution-receipt.mjs";
import { sha256Canonical } from "../packages/protocol/canonical-json.mjs";
import {
  runtimeRecoveryIsolationKeyFingerprint,
  signRuntimeRecoveryIsolationEvidence,
} from "../packages/protocol/runtime-recovery-isolation.mjs";

const revision = "a".repeat(40);
const bundleHash = sha("b");
const databaseFingerprint = "0123456789abcdef";
const siteOrigin = "https://proofweave.example";
const runnerOrigin = "https://runner.example";
const expectedConsumerId = "consumer:render-hosted-production";
const createdAt = "2026-07-27T00:00:00.000Z";
const recoveryRepositoryFullName = "proofweave/research";
const recoveryRepositoryId = 4242;
const recoveryOperatorKeyId = "release-operator:production-01";
const recoveryOperatorKeyPair = await crypto.subtle.generateKey(
  { name: "Ed25519" },
  true,
  ["sign", "verify"],
);
const recoveryOperatorPrivateKeyJwk = await crypto.subtle.exportKey(
  "jwk",
  recoveryOperatorKeyPair.privateKey,
);
const recoveryOperatorPublicKey = Buffer.from(
  await crypto.subtle.exportKey("raw", recoveryOperatorKeyPair.publicKey),
).toString("base64url");
const recoveryOperatorKeyFingerprint = await runtimeRecoveryIsolationKeyFingerprint(
  recoveryOperatorPublicKey,
);
const recoveryTrustedKeyset = Object.freeze({
  schemaVersion: "pw-runtime-recovery-operator-keyset-v1",
  keys: [{
    keyId: recoveryOperatorKeyId,
    publicKey: recoveryOperatorPublicKey,
    keyFingerprint: recoveryOperatorKeyFingerprint,
  }],
});
const installedPluginVersion = JSON.parse(
  await readFile(
    new URL("../plugins/proofweave-research/.codex-plugin/plugin.json", import.meta.url),
    "utf8",
  ),
).version;

test("preflight binds the release to one explicit hosted consumer and remains read-only", async () => {
  const fixture = makeDrillFixture();
  const directory = await mkdtemp(join(tmpdir(), "proofweave-drill-preflight-"));
  try {
    const result = await fixture.drill.preflight({ environment: fixture.environment });
    assert.equal(result.outcome, "preflight_passed");
    assert.equal(result.productionEligible, false);
    assert.equal(result.release.siteOrigin, siteOrigin);
    assert.equal(result.release.expectedRunnerConsumerId, expectedConsumerId);
    assert.equal(result.release.githubRepositoryFullName, recoveryRepositoryFullName);
    assert.equal(result.release.githubRepositoryId, recoveryRepositoryId);
    assert.equal(
      result.release.recoveryIsolationProtocolVersion,
      "pw-runtime-recovery-isolation-v1",
    );
    assert.equal(result.release.migrationHead, "0043_add_runner_queue_event_sequence.sql");
    assert.deepEqual(result.release.siteReleaseDiagnostics, readyReleaseDiagnostics());
    assert.deepEqual(result.release.runnerReleaseDiagnostics, readyReleaseDiagnostics());
    assert.equal(result.release.runnerExecutionEnabled, true);
    assert.equal(result.release.runnerExecutionBoundary, "isolated-sandbox-only");
    assert.deepEqual(result.release.runnerPolicy, readyRunnerPolicy());
    assert.equal(result.runner.executionEnabled, true);
    assert.deepEqual(await readdir(directory), []);
    assert.equal(fixture.calls.database, 1);
    assert.equal(fixture.calls.live, 0);
    assert.deepEqual(
      fixture.calls.fetch.map((entry) => new URL(entry.url).pathname),
      [
        "/api/mcp/capabilities",
        "/downloads/proofweave-research-marketplace.tar",
        "/downloads/proofweave-research-marketplace.tar.sha256",
        "/downloads/proofweave-research-marketplace.json",
        "/healthz",
      ],
    );

    await assert.rejects(
      fixture.drill.preflight({
        environment: {
          ...fixture.environment,
          PROOFWEAVE_DRILL_EXPECTED_RUNNER_CONSUMER_ID: "",
        },
      }),
      (error) => error.code === "EXPECTED_RUNNER_CONSUMER_ID_MISSING",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("preflight rejects recovery and published plugin drift before live evidence is read", async () => {
  const recovery = makeDrillFixture();
  await assert.rejects(
    recovery.drill.preflight({
      environment: { ...recovery.environment, PROOFWEAVE_GITHUB_RECOVERY_ENABLED: "true" },
    }),
    (error) => error instanceof GithubIndependentDrillError
      && error.code === "GITHUB_RECOVERY_NOT_DISABLED",
  );
  assert.equal(recovery.calls.live, 0);

  const distribution = makeDrillFixture({
    mutateDistribution: (value) => ({
      ...value,
      archive: { ...value.archive, bytes: value.archive.bytes + 1 },
    }),
  });
  await assert.rejects(
    distribution.drill.preflight({ environment: distribution.environment }),
    (error) => error.code === "PLUGIN_DISTRIBUTION_MANIFEST_MISMATCH",
  );
});

test("preflight fails closed on invalid or unbound Site release diagnostics", async (context) => {
  async function rejected(mutator, expectedCode) {
    const fixture = makeDrillFixture();
    mutator(fixture.siteCapabilities);
    await assert.rejects(
      fixture.drill.preflight({ environment: fixture.environment }),
      (error) => error.code === expectedCode,
    );
  }

  await context.test("503", () => rejected(
    (site) => { site.status = 503; },
    "SITE_CAPABILITIES_STATUS_INVALID",
  ));
  await context.test("redirect", () => rejected(
    (site) => {
      site.redirected = true;
      site.url = "https://other.example/api/mcp/capabilities";
    },
    "SITE_CAPABILITIES_REDIRECTED",
  ));
  await context.test("non JSON", () => rejected(
    (site) => { site.contentType = "text/plain"; },
    "SITE_CAPABILITIES_CONTENT_TYPE_INVALID",
  ));
  await context.test("oversized", () => rejected(
    (site) => { site.declaredLength = 65_537; },
    "SITE_CAPABILITIES_TOO_LARGE",
  ));
  await context.test("missing field", () => rejected(
    (site) => { delete site.body.releaseDiagnostics.ledgerHead; },
    "SITE_RELEASE_DIAGNOSTICS_INVALID",
  ));
  await context.test("extra field", () => rejected(
    (site) => { site.body.releaseDiagnostics.databaseUrl = "libsql://secret.example"; },
    "SITE_RELEASE_DIAGNOSTICS_INVALID",
  ));
  await context.test("degraded", () => rejected(
    (site) => {
      site.body.releaseDiagnostics.state = "degraded";
      site.body.releaseDiagnostics.ledgerHead = null;
      site.body.releaseDiagnostics.failureCode = "control_plane_verification_failed";
    },
    "SITE_RELEASE_DIAGNOSTICS_INVALID",
  ));
  await context.test("database fingerprint mismatch", () => rejected(
    (site) => { site.body.releaseDiagnostics.databaseFingerprint = "fedcba9876543210"; },
    "LIVE_RELEASE_AUTHORITY_MISMATCH",
  ));
  await context.test("ledger head mismatch", () => rejected(
    (site) => {
      site.body.releaseDiagnostics.ledgerHead = "0042_add_jacobian_counterexample_audit.sql";
    },
    "LIVE_RELEASE_AUTHORITY_MISMATCH",
  ));
});

test("preflight fails closed on invalid or drifting Runner release policy", async (context) => {
  async function rejected(mutator, expectedCode) {
    const fixture = makeDrillFixture();
    mutator(fixture.health);
    await assert.rejects(
      fixture.drill.preflight({ environment: fixture.environment }),
      (error) => error.code === expectedCode,
    );
  }

  await context.test("missing diagnostics", () => rejected(
    (health) => { delete health.releaseDiagnostics; },
    "RUNNER_RELEASE_DIAGNOSTICS_INVALID",
  ));
  await context.test("degraded diagnostics", () => rejected(
    (health) => {
      health.releaseDiagnostics.state = "degraded";
      health.releaseDiagnostics.ledgerHead = null;
      health.releaseDiagnostics.failureCode = "control_plane_verification_failed";
    },
    "RUNNER_RELEASE_DIAGNOSTICS_INVALID",
  ));
  await context.test("execution disabled", () => rejected(
    (health) => { health.executionEnabled = false; },
    "RUNNER_HEALTH_MISMATCH",
  ));
  await context.test("template drift", () => rejected(
    (health) => { health.runnerPolicy.templateId = "template-other"; },
    "RUNNER_POLICY_MISMATCH",
  ));
  await context.test("template build drift", () => rejected(
    (health) => { health.runnerPolicy.templateBuildId = "build-other"; },
    "RUNNER_POLICY_MISMATCH",
  ));
  await context.test("image drift", () => rejected(
    (health) => {
      health.runnerPolicy.sandboxImageDigest =
        `registry.example/proofweave@sha256:${"3".repeat(64)}`;
    },
    "RUNNER_POLICY_MISMATCH",
  ));
  await context.test("image approval false", () => rejected(
    (health) => { health.runnerPolicy.sandboxImageApproved = false; },
    "RUNNER_POLICY_MISMATCH",
  ));
  await context.test("database fingerprint drift", () => rejected(
    (health) => {
      health.releaseDiagnostics.databaseFingerprint = "fedcba9876543210";
    },
    "LIVE_RELEASE_AUTHORITY_MISMATCH",
  ));
  await context.test("ledger head drift", () => rejected(
    (health) => {
      health.releaseDiagnostics.ledgerHead = "0042_add_jacobian_counterexample_audit.sql";
    },
    "LIVE_RELEASE_AUTHORITY_MISMATCH",
  ));
});

test("record and finalize bind live diagnostics and Runner policy into the release fingerprint", async (context) => {
  const additionalApprovedImage = {
    imageDigest: `registry.example/proofweave@sha256:${"4".repeat(64)}`,
    leanToolchain: "v4.30.1",
    mathlibRevision: "5".repeat(40),
  };

  await context.test("record", async () => {
    const fixture = makeDrillFixture();
    const directory = await mkdtemp(join(tmpdir(), "proofweave-drill-release-drift-record-"));
    const statePath = join(directory, "state.json");
    try {
      await beginFixture(fixture, statePath);
      fixture.health.runnerPolicy.approvedImages.push(additionalApprovedImage);
      await assert.rejects(
        recordFixture(fixture, statePath),
        (error) => error.code === "RELEASE_DRIFT",
      );
      assert.equal(fixture.calls.live, 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  await context.test("finalize", async () => {
    const setup = await recordedPortableFixture();
    try {
      setup.fixture.health.runnerPolicy.approvedImages.push(additionalApprovedImage);
      await assert.rejects(
        finalizeFixture(setup),
        (error) => error.code === "RELEASE_DRIFT",
      );
      assert.equal(setup.fixture.calls.live, 1);
    } finally {
      await setup.cleanup();
    }
  });
});

test("begin writes a signed secret-free v3 recovery snapshot for the exact Bundle", async () => {
  const fixture = makeDrillFixture();
  const directory = await mkdtemp(join(tmpdir(), "proofweave-drill-begin-"));
  const statePath = join(directory, "state.json");
  try {
    await beginFixture(fixture, statePath);
    const source = await readFile(statePath, "utf8");
    const state = JSON.parse(source);
    assert.equal(state.schemaVersion, "pw-github-independent-production-drill-v3");
    assert.equal(state.artifactBundleHash, bundleHash);
    assert.equal(state.release.expectedRunnerConsumerId, expectedConsumerId);
    assert.equal(state.createdAt, state.recoveryIsolation.evidence.drill.observedAt);
    assert.equal(
      state.recoveryIsolation.evidence.githubObservation.repositoryId,
      recoveryRepositoryId,
    );
    assert.equal(
      state.recoveryIsolation.evidenceHash,
      await sha256Canonical(state.recoveryIsolation.evidence),
    );
    assert.equal(Object.hasOwn(state, "baselineRunnerLastWakeAt"), false);
    assert.equal(source.includes("database-secret-token"), false);
    assert.equal(source.includes("libsql://"), false);
    assert.equal(source.includes("github-recovery-read-token"), false);
    assert.equal(source.includes(recoveryOperatorPrivateKeyJwk.d), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("record hard-fails recovery bypass attempts before live or Receipt work", async (context) => {
  async function rejected(mutator, expectedCode) {
    const fixture = makeDrillFixture({ includeReceiptVerifierProbe: true });
    const directory = await mkdtemp(join(tmpdir(), "proofweave-drill-recovery-reject-"));
    const statePath = join(directory, "state.json");
    try {
      await beginFixture(fixture, statePath);
      await rewriteState(statePath, mutator);
      await assert.rejects(
        recordFixture(fixture, statePath),
        (error) => error.code === expectedCode,
      );
      assert.equal(fixture.calls.live, 0);
      assert.equal(fixture.calls.receiptVerifier, 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  await context.test("old v2 state", () => rejected(
    (state) => { state.schemaVersion = "pw-github-independent-production-drill-v2"; },
    "STATE_INVALID",
  ));
  await context.test("missing recovery state", () => rejected(
    (state) => { delete state.recoveryIsolation; },
    "RECOVERY_ISOLATION_STATE_INVALID",
  ));
  await context.test("signed observedAt chronology drift", () => rejected(
    (state) => { state.createdAt = "2026-07-26T23:59:59.999Z"; },
    "RECOVERY_ISOLATION_STATE_BINDING_MISMATCH",
  ));
  await context.test("fixture eligibility edited true", () => rejected(
    (state) => { state.productionEligible = true; },
    "PRODUCTION_ELIGIBILITY_DRIFT",
  ));
  await context.test("evidence tampered and full hash recomputed", () => rejected(
    async (state) => {
      state.recoveryIsolation.evidence.surfaceManifest.workflows[0].role =
        "tampered_queue_consumer";
      state.recoveryIsolation.evidence.surfaceManifest.hash = await sha256Canonical({
        workflows: state.recoveryIsolation.evidence.surfaceManifest.workflows,
      });
      state.recoveryIsolation.evidenceHash = await sha256Canonical(
        state.recoveryIsolation.evidence,
      );
    },
    "RECOVERY_ISOLATION_PAYLOAD_HASH_MISMATCH",
  ));
});

test("record rejects expired and untrusted recovery evidence before live work", async (context) => {
  await context.test("expired at record", async () => {
    const fixture = makeDrillFixture({ includeReceiptVerifierProbe: true });
    const directory = await mkdtemp(join(tmpdir(), "proofweave-drill-recovery-expired-"));
    const statePath = join(directory, "state.json");
    try {
      await beginFixture(fixture, statePath);
      fixture.clock.value = "2026-07-27T02:00:00.001Z";
      await assert.rejects(
        recordFixture(fixture, statePath),
        (error) => error.code === "RECOVERY_ISOLATION_EVIDENCE_EXPIRED",
      );
      assert.equal(fixture.calls.live, 0);
      assert.equal(fixture.calls.receiptVerifier, 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  await context.test("trusted keyset drift", async () => {
    const fixture = makeDrillFixture({ includeReceiptVerifierProbe: true });
    const directory = await mkdtemp(join(tmpdir(), "proofweave-drill-recovery-untrusted-"));
    const statePath = join(directory, "state.json");
    try {
      await beginFixture(fixture, statePath);
      fixture.environment.PROOFWEAVE_DRILL_RECOVERY_TRUSTED_KEYS_JSON = JSON.stringify({
        ...recoveryTrustedKeyset,
        keys: [{
          ...recoveryTrustedKeyset.keys[0],
          keyId: "release-operator:production-replacement",
        }],
      });
      await assert.rejects(
        recordFixture(fixture, statePath),
        (error) => error.code === "RECOVERY_ISOLATION_OPERATOR_UNTRUSTED",
      );
      assert.equal(fixture.calls.live, 0);
      assert.equal(fixture.calls.receiptVerifier, 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

test("record binds one fresh exact Run, queue lease/consumer, Receipt, and independent reviews", async () => {
  const fixture = makeDrillFixture();
  const directory = await mkdtemp(join(tmpdir(), "proofweave-drill-record-"));
  const statePath = join(directory, "state.json");
  try {
    await beginFixture(fixture, statePath);
    const result = await recordFixture(fixture, statePath);
    assert.equal(result.outcome, "evidence_recorded");
    assert.equal(result.runId, evidenceFixture().run.id);
    assert.equal(result.reviewCount, 3);
    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(state.liveEvidence.queue.consumerId, expectedConsumerId);
    assert.equal(state.liveEvidence.queue.deliveryState, "acknowledged");
    assert.deepEqual(
      state.liveEvidence.queue.events.map((event) => event.sequence),
      [1, 2, 3],
    );
    assert.equal(fixture.calls.live, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an unrelated global wake cannot substitute for exact fresh live evidence", async () => {
  const fixture = makeDrillFixture();
  const directory = await mkdtemp(join(tmpdir(), "proofweave-drill-unrelated-wake-"));
  const statePath = join(directory, "state.json");
  try {
    await beginFixture(fixture, statePath);
    fixture.health.lastWakeAt = "2026-07-27T00:10:00.000Z";
    fixture.live.value.run.queuedAt = "2026-07-26T23:59:00.000Z";
    await assert.rejects(
      recordFixture(fixture, statePath),
      (error) => error.code === "LIVE_RUN_NOT_FRESH",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("record rejects different Run, wrong consumer, non-consecutive queue, and same-owner review", async (context) => {
  async function rejected(mutator, expectedCode) {
    const fixture = makeDrillFixture();
    const directory = await mkdtemp(join(tmpdir(), "proofweave-drill-reject-"));
    const statePath = join(directory, "state.json");
    try {
      await beginFixture(fixture, statePath);
      mutator(fixture.live.value);
      await assert.rejects(
        recordFixture(fixture, statePath),
        (error) => error.code === expectedCode,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  await context.test("different Run", () => rejected(
    (live) => {
      live.run.id = "run:production-closure-other";
      live.queue.runId = live.run.id;
      live.receipt.runId = live.run.id;
    },
    "LIVE_EVIDENCE_BINDING_MISMATCH",
  ));
  await context.test("wrong hosted consumer", () => rejected(
    (live) => { live.queue.consumerId = "consumer:github-recovery"; },
    "LIVE_EVIDENCE_BINDING_MISMATCH",
  ));
  await context.test("non-consecutive 0043 events", () => rejected(
    (live) => { live.queue.events[1].sequence = 4; },
    "LIVE_QUEUE_SEQUENCE_INVALID",
  ));
  await context.test("same owner review", () => rejected(
    (live) => { live.reviews[0].reviewerPersonId = identity().personId; },
    "LIVE_REVIEW_BINDING_MISMATCH",
  ));
  await context.test("unacknowledged terminal", () => rejected(
    (live) => {
      live.queue.deliveryState = "leased";
      live.queue.events.at(-1).eventType = "lease_renewed";
      live.queue.events.at(-1).deliveryState = "leased";
    },
    "LIVE_QUEUE_NOT_ACKNOWLEDGED",
  ));
});

test("finalize re-probes exact evidence, fetches the current same-Site keyset, and fixtures cannot production-pass", async () => {
  const setup = await recordedPortableFixture();
  try {
    const result = await setup.fixture.drill.finalize({
      environment: setup.fixture.environment,
      statePath: setup.statePath,
      confirmation: githubIndependentDrillConfirmations.finalize,
      correlationId: identity().correlationId,
      verificationBundle: setup.receipt.bundle,
    });
    assert.equal(result.outcome, "fixture_verified");
    assert.notEqual(result.outcome, "production_passed");
    assert.equal(result.portableClosure.rootReceiptHash, setup.receipt.receiptHash);
    const keysetCall = setup.fixture.calls.fetch.at(-1);
    assert.equal(new URL(keysetCall.url).origin, siteOrigin);
    assert.equal(new URL(keysetCall.url).pathname, "/api/receipts/issuer-keys");
    assert.equal(keysetCall.redirect, "error");
    assert.equal(setup.fixture.calls.live, 2);
  } finally {
    await setup.cleanup();
  }
});

test("finalize rejects recovery expiry before live re-probe or Receipt verification", async () => {
  const setup = await recordedPortableFixture({
    fixtureOptions: { includeReceiptVerifierProbe: true },
  });
  try {
    assert.equal(setup.fixture.calls.live, 1);
    setup.fixture.clock.value = "2026-07-27T02:00:00.001Z";
    await assert.rejects(
      finalizeFixture(setup),
      (error) => error.code === "RECOVERY_ISOLATION_EVIDENCE_EXPIRED",
    );
    assert.equal(setup.fixture.calls.live, 1);
    assert.equal(setup.fixture.calls.receiptVerifier, 0);
  } finally {
    await setup.cleanup();
  }
});

test("finalize fails closed on live drift, old portable Receipt, old keyset, and cross-source keyset", async (context) => {
  await context.test("live evidence changed after record", async () => {
    const setup = await recordedPortableFixture();
    try {
      setup.fixture.live.value.reviews[0].attestedAt = "2026-07-27T00:00:06.500Z";
      await assert.rejects(
        finalizeFixture(setup),
        (error) => error.code === "LIVE_EVIDENCE_DRIFT",
      );
    } finally {
      await setup.cleanup();
    }
  });

  await context.test("portable Receipt predates begin", async () => {
    const oldReceipt = await createPortableReceiptFixture({
      issuedAt: "2026-07-26T23:59:59Z",
    });
    const setup = await recordedPortableFixture({ receipt: oldReceipt });
    try {
      setup.fixture.live.value.receipt.issuedAt = "2026-07-27T00:00:10.000Z";
      await assert.rejects(
        finalizeFixture(setup),
        (error) => error.code === "PORTABLE_RECEIPT_BINDING_MISMATCH",
      );
    } finally {
      await setup.cleanup();
    }
  });

  await context.test("current keyset no longer preserves issuer key", async () => {
    const setup = await recordedPortableFixture();
    try {
      setup.fixture.keyset.source = JSON.stringify({
        issuerKeys: [{
          ...setup.receipt.keyset.issuerKeys[0],
          id: "issuer:previous-production-receipts",
        }],
      });
      await assert.rejects(
        finalizeFixture(setup),
        (error) => error.code === "PORTABLE_RECEIPT_VERIFY_FAILED",
      );
    } finally {
      await setup.cleanup();
    }
  });

  await context.test("keyset response crosses the fixed Site origin", async () => {
    const setup = await recordedPortableFixture();
    try {
      setup.fixture.keyset.url = "https://other.example/api/receipts/issuer-keys";
      await assert.rejects(
        finalizeFixture(setup),
        (error) => error.code === "ISSUER_KEYSET_ORIGIN_INVALID",
      );
    } finally {
      await setup.cleanup();
    }
  });
});

test("production CLI rejects the retired --issuer-keyset input before any network access", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/run-github-independent-production-drill.mjs",
      "finalize",
      "--issuer-keyset",
      "/private/tmp/operator-keyset.json",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).errorCode, "ARGUMENTS_INVALID");
});

function makeDrillFixture({
  mutateDistribution = (value) => value,
  includeReceiptVerifierProbe = false,
} = {}) {
  const archive = Buffer.from("portable marketplace archive");
  const digest = createHash("sha256").update(archive).digest("hex");
  const checksum = Buffer.from(`${digest}  proofweave-research-marketplace.tar\n`);
  const distribution = mutateDistribution({
    schemaVersion: "pw-codex-plugin-distribution-v1",
    marketplaceName: "proofweave-private-beta",
    pluginName: "proofweave-research",
    pluginVersion: installedPluginVersion,
    archive: {
      path: "/downloads/proofweave-research-marketplace.tar",
      filename: "proofweave-research-marketplace.tar",
      sha256: digest,
      bytes: archive.byteLength,
    },
    compatibility: {
      protocolVersion: "pw-local-connector-v1",
      connectorApiVersion: 1,
      toolSchemaVersion: 1,
    },
  });
  const siteCapabilities = {
    body: {
      protocolVersion: "pw-local-connector-v1",
      capabilities: ["signed_research_checkpoints"],
      releaseDiagnostics: readyReleaseDiagnostics(),
    },
    status: 200,
    redirected: false,
    url: `${siteOrigin}/api/mcp/capabilities`,
    contentType: "application/json; charset=utf-8",
    declaredLength: null,
    source: null,
  };
  const health = {
    service: "proofweave-trusted-runner",
    state: "ready",
    provider: "e2b",
    revision,
    lastWakeAt: null,
    executionEnabled: true,
    releaseDiagnostics: readyReleaseDiagnostics(),
    runnerPolicy: readyRunnerPolicy(),
    executionBoundary: "isolated-sandbox-only",
  };
  const downloads = new Map([
    ["/downloads/proofweave-research-marketplace.tar", archive],
    ["/downloads/proofweave-research-marketplace.tar.sha256", checksum],
    ["/downloads/proofweave-research-marketplace.json", Buffer.from(`${JSON.stringify(distribution)}\n`)],
  ]);
  const calls = {
    fetch: [],
    database: 0,
    live: 0,
    recoveryIsolation: 0,
    operatorPrivateKey: 0,
    receiptVerifier: 0,
  };
  const clock = { value: createdAt };
  const manifest = releaseManifest();
  const live = { value: liveEvidenceFixture() };
  const keyset = {
    source: JSON.stringify({ issuerKeys: [] }),
    url: `${siteOrigin}/api/receipts/issuer-keys`,
    redirected: false,
    contentType: "application/json; charset=utf-8",
  };
  const fetcher = async (url, init) => {
    calls.fetch.push({
      url: url.toString(),
      method: init.method,
      redirect: init.redirect,
    });
    const pathname = new URL(url).pathname;
    if (pathname === "/api/mcp/capabilities") {
      const source = siteCapabilities.source ?? JSON.stringify(siteCapabilities.body);
      const headers = new Headers({
        "content-type": siteCapabilities.contentType,
        ...(siteCapabilities.declaredLength === null
          ? { "content-length": String(Buffer.byteLength(source)) }
          : { "content-length": String(siteCapabilities.declaredLength) }),
      });
      return {
        ok: siteCapabilities.status >= 200 && siteCapabilities.status < 300,
        status: siteCapabilities.status,
        redirected: siteCapabilities.redirected,
        url: siteCapabilities.url,
        headers,
        text: async () => source,
      };
    }
    if (pathname === "/healthz") {
      return new Response(JSON.stringify(health), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (pathname === "/api/receipts/issuer-keys") {
      return {
        ok: true,
        redirected: keyset.redirected,
        url: keyset.url,
        headers: new Headers({
          "content-type": keyset.contentType,
          "content-length": String(Buffer.byteLength(keyset.source)),
        }),
        text: async () => keyset.source,
      };
    }
    const bytes = downloads.get(pathname);
    return bytes
      ? new Response(bytes, {
        status: 200,
        headers: { "content-length": String(bytes.length) },
      })
      : new Response("not found", { status: 404 });
  };
  const databaseProbe = async () => {
    calls.database += 1;
    return {
      authority: "turso",
      fingerprint: databaseFingerprint,
      migrationHead: "0043_add_runner_queue_event_sequence.sql",
      migrationCount: 44,
    };
  };
  const liveEvidenceProbe = async () => {
    calls.live += 1;
    return structuredClone(live.value);
  };
  const recoveryIsolationInspector = async (input) => {
    calls.recoveryIsolation += 1;
    assert.equal(Object.hasOwn(input, "maximumTtlMilliseconds"), false);
    assert.equal(Object.hasOwn(input, "now"), false);
    assert.equal(input.repositoryFullName, recoveryRepositoryFullName);
    return createRecoveryIsolationEvidence({
      ...input,
      observedAt: clock.value,
      productionEligible: false,
    });
  };
  const operatorPrivateKeyProvider = async () => {
    calls.operatorPrivateKey += 1;
    return recoveryOperatorPrivateKeyJwk;
  };
  const environment = {
    PROOFWEAVE_GITHUB_RECOVERY_ENABLED: "false",
    PROOFWEAVE_DRILL_GITHUB_REPOSITORY: recoveryRepositoryFullName,
    PROOFWEAVE_DRILL_GITHUB_REPOSITORY_ID: String(recoveryRepositoryId),
    PROOFWEAVE_DRILL_RECOVERY_TRUSTED_KEYS_JSON: JSON.stringify(recoveryTrustedKeyset),
    PROOFWEAVE_DRILL_GITHUB_TOKEN: "github-recovery-read-token",
    PROOFWEAVE_DRILL_RECOVERY_OPERATOR_KEY_ID: recoveryOperatorKeyId,
    PROOFWEAVE_DRILL_SITE_ORIGIN: siteOrigin,
    PROOFWEAVE_DRILL_EXPECTED_RUNNER_CONSUMER_ID: expectedConsumerId,
    PROOFWEAVE_RUNNER_URL: runnerOrigin,
    PROOFWEAVE_DRILL_PLUGIN_DOWNLOADS_JSON: JSON.stringify([...downloads.keys()]),
    TURSO_DATABASE_URL: "libsql://database.example",
    TURSO_AUTH_TOKEN: "database-secret-token",
  };
  const drillOptions = {
    root: process.cwd(),
    fetcher,
    manifestProvider: async () => ({ manifest, exitCode: 0 }),
    databaseProbe,
    liveEvidenceProbe,
    recoveryIsolationInspector,
    operatorPrivateKeyProvider,
    now: () => new Date(clock.value),
  };
  if (includeReceiptVerifierProbe) {
    drillOptions.receiptVerifier = async () => {
      calls.receiptVerifier += 1;
      throw new Error("receipt verifier must not run after recovery failure");
    };
  }
  const drill = createGithubIndependentProductionDrill(drillOptions);
  return {
    drill,
    environment,
    health,
    manifest,
    calls,
    live,
    keyset,
    clock,
    siteCapabilities,
  };
}

function readyReleaseDiagnostics() {
  return {
    schemaVersion: "pw-live-release-diagnostics-v1",
    state: "ready",
    authority: "turso",
    databaseFingerprint,
    ledgerHead: "0043_add_runner_queue_event_sequence.sql",
    failureCode: null,
  };
}

function readyRunnerPolicy() {
  return {
    state: "configured",
    sandboxImageDigest: `registry.example/proofweave@sha256:${"1".repeat(64)}`,
    templateId: "template-production",
    templateBuildId: "build-production",
    approvedImages: [{
      imageDigest: `registry.example/proofweave@sha256:${"1".repeat(64)}`,
      leanToolchain: "v4.30.0",
      mathlibRevision: "2".repeat(40),
    }],
    sandboxImageApproved: true,
  };
}

function releaseManifest() {
  return {
    schemaVersion: "pw-release-manifest-v1",
    source: {
      gitSha: revision,
      originMainSha: revision,
      branch: "main",
      clean: true,
    },
    sites: {
      projectId: "proofweave",
      version: "release-140",
      commitSha: revision,
    },
    gateway: { revision },
    runner: {
      revision,
      e2b: {
        configuredTemplateId: "template-production",
        configuredTemplateBuildId: "build-production",
        deployedTemplateId: "template-production",
        deployedTemplateBuildId: "build-production",
      },
      image: {
        configuredDigest: `registry.example/proofweave@sha256:${"1".repeat(64)}`,
        approvedDigest: `registry.example/proofweave@sha256:${"1".repeat(64)}`,
        deployedDigest: `registry.example/proofweave@sha256:${"1".repeat(64)}`,
        leanToolchain: "v4.30.0",
        mathlibRevision: "2".repeat(40),
      },
    },
    database: {
      authority: "turso",
      gatewayFingerprint: databaseFingerprint,
      runnerFingerprint: databaseFingerprint,
      repositoryMigrationHead: "0043_add_runner_queue_event_sequence.sql",
      deployedMigrationHead: "0043_add_runner_queue_event_sequence.sql",
    },
    validation: { mode: "release", state: "valid", issues: [] },
  };
}

function identity() {
  return {
    correlationId: "correlation:production-20260727-001",
    personId: "person:production-owner",
    agentId: "agent:production-prover",
    artifactBundleHash: bundleHash,
  };
}

function reviews() {
  return ["bundle_reproducible", "kernel_accepted", "project_accepted"].map(
    (claimType, index) => ({
      claimType,
      verificationAttestationId: `attestation:production-review-${index + 1}`,
      verificationAttestationHash: sha(String(index + 3)),
      reviewerPersonId: `person:production-reviewer-${index + 1}`,
      reviewerAgentId: `agent:production-reviewer-${index + 1}`,
    }),
  );
}

function evidenceFixture({ receiptHash = sha("e") } = {}) {
  return {
    correlationId: identity().correlationId,
    revision,
    personId: identity().personId,
    agentId: identity().agentId,
    artifactBundleHash: bundleHash,
    run: {
      id: "run:production-closure-001",
      resultHash: sha("d"),
    },
    reviews: reviews().map((review) => ({
      verificationAttestationId: review.verificationAttestationId,
      verificationAttestationHash: review.verificationAttestationHash,
      reviewerPersonId: review.reviewerPersonId,
      reviewerAgentId: review.reviewerAgentId,
    })),
    receipt: {
      id: "receipt:production-closure-001",
      hash: receiptHash,
    },
  };
}

function liveEvidenceFixture({ receiptHash = sha("e") } = {}) {
  return {
    run: {
      id: "run:production-closure-001",
      attemptId: "attempt:production-closure-001",
      personId: identity().personId,
      agentId: identity().agentId,
      artifactBundleHash: bundleHash,
      requestHash: sha("a"),
      resultHash: sha("d"),
      status: "succeeded",
      queuedAt: "2026-07-27T00:00:01.000Z",
      startedAt: "2026-07-27T00:00:02.000Z",
      finishedAt: "2026-07-27T00:00:03.000Z",
      resultReceivedAt: "2026-07-27T00:00:04.000Z",
    },
    queue: {
      runId: "run:production-closure-001",
      attemptId: "attempt:production-closure-001",
      consumerId: expectedConsumerId,
      leaseId: "lease:production-closure-001",
      deliveryAttempts: 1,
      deliveryState: "acknowledged",
      enqueuedAt: "2026-07-27T00:00:01.000Z",
      acknowledgedAt: "2026-07-27T00:00:04.000Z",
      events: [
        {
          id: "queue-event:production-enqueued",
          sequence: 1,
          eventType: "enqueued",
          deliveryState: "queued",
          leaseId: null,
          deliveryAttempt: 0,
          occurredAt: "2026-07-27T00:00:01.000Z",
        },
        {
          id: "queue-event:production-claimed",
          sequence: 2,
          eventType: "lease_claimed",
          deliveryState: "leased",
          leaseId: "lease:production-closure-001",
          deliveryAttempt: 1,
          occurredAt: "2026-07-27T00:00:02.000Z",
        },
        {
          id: "queue-event:production-acknowledged",
          sequence: 3,
          eventType: "acknowledged",
          deliveryState: "acknowledged",
          leaseId: "lease:production-closure-001",
          deliveryAttempt: 1,
          occurredAt: "2026-07-27T00:00:04.000Z",
        },
      ],
    },
    receipt: {
      id: "receipt:production-closure-001",
      hash: receiptHash,
      attemptId: "attempt:production-closure-001",
      runId: "run:production-closure-001",
      artifactBundleHash: bundleHash,
      beneficiaryPersonId: identity().personId,
      beneficiaryAgentId: identity().agentId,
      issuedAt: "2026-07-27T00:00:10.000Z",
    },
    reviews: reviews().map((review, index) => ({
      verificationAttestationId: review.verificationAttestationId,
      verificationAttestationHash: review.verificationAttestationHash,
      reviewerPersonId: review.reviewerPersonId,
      reviewerAgentId: review.reviewerAgentId,
      artifactBundleHash: bundleHash,
      attestedAt: `2026-07-27T00:00:0${index + 6}.000Z`,
    })),
  };
}

async function createRecoveryIsolationEvidence({
  releaseSha,
  releaseFingerprint,
  correlationId,
  operatorPrivateKeyJwk,
  operatorKeyId,
  observedAt,
  productionEligible,
}) {
  const workflows = [
    {
      path: ".github/workflows/build-week-live-receipt.yml",
      role: "manual_queue_consumer",
      sourceSha256: sha("7"),
    },
    {
      path: ".github/workflows/e2b-lean-runner.yml",
      role: "recovery_queue_consumer",
      sourceSha256: sha("8"),
    },
  ];
  const zeroActiveRuns = {
    in_progress: 0,
    pending: 0,
    queued: 0,
    requested: 0,
    waiting: 0,
  };
  return signRuntimeRecoveryIsolationEvidence({
    protocolVersion: "pw-runtime-recovery-isolation-v1",
    evidenceId: "recovery-isolation:production-20260727-001",
    productionEligible,
    release: {
      gitSha: releaseSha,
      fingerprint: releaseFingerprint,
    },
    drill: {
      correlationId,
      observedAt,
      validUntil: new Date(Date.parse(observedAt) + 2 * 60 * 60 * 1_000).toISOString(),
    },
    surfaceManifest: {
      hash: await sha256Canonical({ workflows }),
      workflows,
    },
    githubObservation: {
      repositoryId: recoveryRepositoryId,
      repositoryFullName: recoveryRepositoryFullName,
      apiVersion: "2022-11-28",
      releaseSha,
      workflows: workflows.map((workflow, index) => ({
        workflowId: 700 + index,
        path: workflow.path,
        sourceBlobSha: String(index + 1).repeat(40),
        state: "disabled_manually",
        activeRuns: zeroActiveRuns,
      })),
    },
  }, {
    operatorPrivateKeyJwk,
    operatorKeyId,
    signedAt: observedAt,
  });
}

async function beginFixture(fixture, statePath) {
  return fixture.drill.begin({
    environment: fixture.environment,
    statePath,
    confirmation: githubIndependentDrillConfirmations.begin,
    ...identity(),
  });
}

function recordFixture(fixture, statePath, receiptHash = fixture.live.value.receipt.hash) {
  return fixture.drill.record({
    environment: fixture.environment,
    statePath,
    confirmation: githubIndependentDrillConfirmations.record,
    evidence: evidenceFixture({ receiptHash }),
  });
}

async function createPortableReceiptFixture({ issuedAt = "2026-07-27T00:00:10Z" } = {}) {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const issuerPublicKey = Buffer.from(
    await crypto.subtle.exportKey("raw", keyPair.publicKey),
  ).toString("base64url");
  const receipt = await createContributionReceipt({
    receipt: {
      protocolVersion: "pw-contribution-receipt-v1",
      id: "receipt:production-closure-001",
      kind: "proof_patch",
      beneficiary: {
        personId: identity().personId,
        agentId: identity().agentId,
        delegationCertificateId: "delegation:production-prover",
      },
      attempt: {
        id: "attempt:production-closure-001",
        personId: identity().personId,
        agentId: identity().agentId,
        delegationCertificateId: "delegation:production-prover",
        problemRevisionId: "revision:production-target",
      },
      target: {
        declaration: "Proofweave.Production.closure",
        statementHash: sha("c"),
      },
      artifactBundleHash: bundleHash,
      bundle: { manifestHash: bundleHash, dependencyReceipts: [] },
      run: {
        id: "run:production-closure-001",
        requestHash: sha("a"),
        resultHash: sha("d"),
        status: "succeeded",
        kernelStatus: "accepted",
      },
      claims: reviews().map((review) => ({
        claimType: review.claimType,
        verificationAttestationId: review.verificationAttestationId,
        verificationAttestationHash: review.verificationAttestationHash,
        artifactBundleHash: bundleHash,
        reviewerPersonId: review.reviewerPersonId,
        reviewerAgentId: review.reviewerAgentId,
        reviewerDelegationCertificateId: `delegation:${review.reviewerAgentId}`,
        decision: "attested",
      })),
      issuedAt,
      policyVersion: "pw-receipt-policy-v1",
      issuerKeyId: "issuer:production-receipts",
      issuerPublicKey,
    },
    issuerPrivateKey: keyPair.privateKey,
  });
  const receiptHash = await contributionReceiptHash(receipt);
  const key = {
    id: "issuer:production-receipts",
    publicKey: issuerPublicKey,
    status: "active",
    validFrom: "2026-07-26T00:00:00Z",
    retiredAt: null,
    revokedAt: null,
  };
  return {
    receipt,
    receiptHash,
    bundle: {
      protocolVersion: "pw-contribution-receipt-verification-bundle-v1",
      rootReceiptId: receipt.id,
      receipts: [{ receipt, receiptHash, lifecycle: [] }],
      issuerKeys: [key],
    },
    keyset: { issuerKeys: [key] },
  };
}

async function recordedPortableFixture({ receipt = null, fixtureOptions = {} } = {}) {
  const portable = receipt ?? await createPortableReceiptFixture();
  const fixture = makeDrillFixture(fixtureOptions);
  fixture.live.value.receipt.hash = portable.receiptHash;
  fixture.keyset.source = JSON.stringify(portable.keyset);
  const directory = await mkdtemp(join(tmpdir(), "proofweave-drill-recorded-"));
  const statePath = join(directory, "state.json");
  await beginFixture(fixture, statePath);
  await recordFixture(fixture, statePath, portable.receiptHash);
  return {
    fixture,
    receipt: portable,
    statePath,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

function finalizeFixture(setup) {
  return setup.fixture.drill.finalize({
    environment: setup.fixture.environment,
    statePath: setup.statePath,
    confirmation: githubIndependentDrillConfirmations.finalize,
    correlationId: identity().correlationId,
    verificationBundle: setup.receipt.bundle,
  });
}

async function rewriteState(statePath, mutator) {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  await mutator(state);
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}
