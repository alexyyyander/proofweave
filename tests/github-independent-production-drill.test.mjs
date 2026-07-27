import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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

const revision = "a".repeat(40);
const bundleHash = sha("b");
const databaseFingerprint = "0123456789abcdef";
const siteOrigin = "https://proofweave.example";
const runnerOrigin = "https://runner.example";
const createdAt = "2026-07-27T00:00:00.000Z";
const wakeAt = "2026-07-27T00:00:05.000Z";
const installedPluginVersion = JSON.parse(
  await readFile(
    new URL("../plugins/proofweave-research/.codex-plugin/plugin.json", import.meta.url),
    "utf8",
  ),
).version;

test("default phase is a strictly read-only preflight over release, Turso, downloads, and Runner health", async () => {
  const fixture = makeDrillFixture();
  const directory = await mkdtemp(join(tmpdir(), "proofweave-drill-preflight-"));
  try {
    assert.deepEqual(await readdir(directory), []);
    const result = await fixture.drill.preflight({ environment: fixture.environment });
    assert.equal(result.outcome, "preflight_passed");
    assert.equal(result.productionEligible, false);
    assert.equal(result.release.gitSha, revision);
    assert.equal(result.release.databaseAuthority, "turso");
    assert.equal(result.release.databaseFingerprint, databaseFingerprint);
    assert.equal(result.release.migrationHead, "0042_current.sql");
    assert.equal(result.release.pluginDownloads.length, 3);
    assert.equal(result.runner.provider, "e2b");
    assert.equal(result.runner.lastWakeAt, null);
    assert.deepEqual(await readdir(directory), []);
    assert.equal(fixture.calls.database, 1);
    assert.deepEqual(
      fixture.calls.fetch.map((entry) => [entry.method, new URL(entry.url).pathname]),
      [
        ["GET", "/downloads/proofweave-research-marketplace.tar"],
        ["GET", "/downloads/proofweave-research-marketplace.tar.sha256"],
        ["GET", "/downloads/proofweave-research-marketplace.json"],
        ["GET", "/healthz"],
      ],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("preflight rejects a distribution manifest that drifts from the downloaded archive contract", async () => {
  const fixture = makeDrillFixture({
    mutateDistribution: (distribution) => ({
      ...distribution,
      archive: { ...distribution.archive, bytes: distribution.archive.bytes + 1 },
    }),
  });
  await assert.rejects(
    fixture.drill.preflight({ environment: fixture.environment }),
    (error) => error instanceof GithubIndependentDrillError
      && error.code === "PLUGIN_DISTRIBUTION_MANIFEST_MISMATCH",
  );
});

test("preflight fails closed unless GitHub recovery is explicitly disabled", async () => {
  const fixture = makeDrillFixture();
  await assert.rejects(
    fixture.drill.preflight({
      environment: { ...fixture.environment, PROOFWEAVE_GITHUB_RECOVERY_ENABLED: "true" },
    }),
    (error) => error instanceof GithubIndependentDrillError
      && error.code === "GITHUB_RECOVERY_NOT_DISABLED",
  );
  assert.equal(fixture.calls.database, 0);
  assert.equal(fixture.calls.fetch.length, 0);
});

test("begin requires the fixed confirmation, writes only an external secret-free local state file", async () => {
  const fixture = makeDrillFixture();
  const directory = await mkdtemp(join(tmpdir(), "proofweave-drill-begin-"));
  const statePath = join(directory, "state.json");
  try {
    await assert.rejects(
      fixture.drill.begin({
        environment: fixture.environment,
        statePath,
        confirmation: "yes",
        ...identity(),
      }),
      (error) => error.code === "CONFIRMATION_REQUIRED",
    );
    assert.deepEqual(await readdir(directory), []);

    const result = await fixture.drill.begin({
      environment: fixture.environment,
      statePath,
      confirmation: githubIndependentDrillConfirmations.begin,
      ...identity(),
    });
    assert.equal(result.outcome, "begun");
    const source = await readFile(statePath, "utf8");
    assert.equal(source.includes("database-secret-token"), false);
    assert.equal(source.includes("libsql://"), false);
    assert.equal(source.includes("PROOFWEAVE_RUNNER_WAKE_TOKEN"), false);
    const state = JSON.parse(source);
    assert.equal(state.phase, "begun");
    assert.equal(state.productionEligible, false);
    assert.equal(state.correlationId, identity().correlationId);
    assert.equal(state.baselineRunnerLastWakeAt, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("record requires an immutable release, a fresh wake, exact identity, and different-owner reviews", async () => {
  const fixture = makeDrillFixture();
  const directory = await mkdtemp(join(tmpdir(), "proofweave-drill-record-"));
  const statePath = join(directory, "state.json");
  try {
    await beginFixture(fixture, statePath);
    fixture.health.lastWakeAt = wakeAt;
    const sameOwner = evidenceFixture({
      reviews: reviews().map((review, index) => index === 0
        ? { ...review, reviewerPersonId: identity().personId }
        : review),
    });
    await assert.rejects(
      fixture.drill.record({
        environment: fixture.environment,
        statePath,
        confirmation: githubIndependentDrillConfirmations.record,
        evidence: sameOwner,
      }),
      (error) => error.code === "SAME_OWNER_REVIEW",
    );

    const result = await fixture.drill.record({
      environment: fixture.environment,
      statePath,
      confirmation: githubIndependentDrillConfirmations.record,
      evidence: evidenceFixture(),
    });
    assert.equal(result.outcome, "evidence_recorded");
    assert.equal(result.reviewCount, 3);
    assert.equal(JSON.parse(await readFile(statePath, "utf8")).observedRunnerLastWakeAt, wakeAt);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("portable Receipt verification binds Person, Agent, Bundle, Run, reviews, hashes, and can never production-pass with fixtures", async () => {
  const fixture = makeDrillFixture();
  const receiptFixture = await createPortableReceiptFixture();
  const directory = await mkdtemp(join(tmpdir(), "proofweave-drill-finalize-"));
  const statePath = join(directory, "state.json");
  try {
    await beginFixture(fixture, statePath);
    fixture.health.lastWakeAt = wakeAt;
    await fixture.drill.record({
      environment: fixture.environment,
      statePath,
      confirmation: githubIndependentDrillConfirmations.record,
      evidence: evidenceFixture({ receiptHash: receiptFixture.receiptHash }),
    });
    const result = await fixture.drill.finalize({
      environment: fixture.environment,
      statePath,
      confirmation: githubIndependentDrillConfirmations.finalize,
      correlationId: identity().correlationId,
      verificationBundle: receiptFixture.bundle,
      issuerKeyset: receiptFixture.keyset,
    });
    assert.equal(result.outcome, "fixture_verified");
    assert.notEqual(result.outcome, "production_passed");
    assert.equal(result.portableClosure.rootReceiptHash, receiptFixture.receiptHash);
    assert.equal(JSON.parse(await readFile(statePath, "utf8")).phase, "fixture_verified");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("finalize rejects correlation, release, Receipt hash, and Runner wake drift", async (context) => {
  await context.test("correlation drift", async () => {
    const setup = await recordedFixture();
    try {
      await assert.rejects(
        setup.fixture.drill.finalize({
          environment: setup.fixture.environment,
          statePath: setup.statePath,
          confirmation: githubIndependentDrillConfirmations.finalize,
          correlationId: "correlation:production-other",
          verificationBundle: setup.receipt.bundle,
          issuerKeyset: setup.receipt.keyset,
        }),
        (error) => error.code === "CORRELATION_ID_DRIFT",
      );
    } finally {
      await setup.cleanup();
    }
  });

  await context.test("release revision drift", async () => {
    const setup = await recordedFixture();
    try {
      setup.fixture.manifest.source.gitSha = "c".repeat(40);
      setup.fixture.manifest.source.originMainSha = "c".repeat(40);
      setup.fixture.manifest.sites.commitSha = "c".repeat(40);
      setup.fixture.manifest.gateway.revision = "c".repeat(40);
      setup.fixture.manifest.runner.revision = "c".repeat(40);
      setup.fixture.health.revision = "c".repeat(40);
      await assert.rejects(
        finalizeSetup(setup),
        (error) => error.code === "RELEASE_DRIFT",
      );
    } finally {
      await setup.cleanup();
    }
  });

  await context.test("Receipt hash drift", async () => {
    const setup = await recordedFixture({ recordedReceiptHash: sha("f") });
    try {
      await assert.rejects(
        finalizeSetup(setup),
        (error) => error.code === "PORTABLE_RECEIPT_BINDING_MISMATCH",
      );
    } finally {
      await setup.cleanup();
    }
  });

  await context.test("Runner wake drift", async () => {
    const setup = await recordedFixture();
    try {
      setup.fixture.health.lastWakeAt = "2026-07-27T00:00:06.000Z";
      await assert.rejects(
        finalizeSetup(setup),
        (error) => error.code === "RUNNER_WAKE_DRIFT",
      );
    } finally {
      await setup.cleanup();
    }
  });
});

test("mock, demo, smoke, and fixture identifiers are rejected before they can enter drill state", async () => {
  for (const marker of ["mock", "demo", "smoke", "fixture"]) {
    const fixture = makeDrillFixture();
    const directory = await mkdtemp(join(tmpdir(), "proofweave-drill-marker-"));
    try {
      await assert.rejects(
        fixture.drill.begin({
          environment: fixture.environment,
          statePath: join(directory, "state.json"),
          confirmation: githubIndependentDrillConfirmations.begin,
          ...identity(),
          correlationId: `correlation:${marker}-closure`,
        }),
        (error) => error.code === "FIXTURE_IDENTIFIER_FORBIDDEN",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

function makeDrillFixture({ mutateDistribution = (value) => value } = {}) {
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
  const manifestDownload = Buffer.from(`${JSON.stringify(distribution)}\n`);
  const health = {
    service: "proofweave-trusted-runner",
    state: "ready",
    provider: "e2b",
    revision,
    startedAt: "2026-07-26T00:00:00.000Z",
    lastWakeAt: null,
    runnerPolicy: {},
    executionBoundary: "isolated-sandbox-only",
  };
  const downloads = new Map([
    ["/downloads/proofweave-research-marketplace.tar", archive],
    ["/downloads/proofweave-research-marketplace.tar.sha256", checksum],
    ["/downloads/proofweave-research-marketplace.json", manifestDownload],
  ]);
  const calls = { fetch: [], database: 0 };
  const manifest = releaseManifest();
  const fetcher = async (url, init) => {
    calls.fetch.push({ url: url.toString(), method: init.method });
    const pathname = new URL(url).pathname;
    if (pathname === "/healthz") {
      return new Response(JSON.stringify(health), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const bytes = downloads.get(pathname);
    return bytes
      ? new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length) } })
      : new Response("not found", { status: 404 });
  };
  const databaseProbe = async () => {
    calls.database += 1;
    return {
      authority: "turso",
      fingerprint: databaseFingerprint,
      migrationHead: "0042_current.sql",
      migrationCount: 43,
    };
  };
  const environment = {
    PROOFWEAVE_GITHUB_RECOVERY_ENABLED: "false",
    PROOFWEAVE_DRILL_SITE_ORIGIN: siteOrigin,
    PROOFWEAVE_RUNNER_URL: runnerOrigin,
    PROOFWEAVE_DRILL_PLUGIN_DOWNLOADS_JSON: JSON.stringify([...downloads.keys()]),
    TURSO_DATABASE_URL: "libsql://database.example",
    TURSO_AUTH_TOKEN: "database-secret-token",
  };
  const drill = createGithubIndependentProductionDrill({
    root: process.cwd(),
    fetcher,
    manifestProvider: async () => ({ manifest, exitCode: 0 }),
    databaseProbe,
    now: () => new Date(createdAt),
  });
  return { drill, environment, health, manifest, calls };
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
      repositoryMigrationHead: "0042_current.sql",
      deployedMigrationHead: "0042_current.sql",
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
  return ["bundle_reproducible", "kernel_accepted", "project_accepted"].map((claimType, index) => ({
    claimType,
    verificationAttestationId: `attestation:production-review-${index + 1}`,
    verificationAttestationHash: sha(String(index + 3)),
    reviewerPersonId: `person:production-reviewer-${index + 1}`,
    reviewerAgentId: `agent:production-reviewer-${index + 1}`,
  }));
}

function evidenceFixture({ reviews: reviewValues = reviews(), receiptHash = sha("e") } = {}) {
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
    reviews: reviewValues.map((review) => ({
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

async function beginFixture(fixture, statePath) {
  return fixture.drill.begin({
    environment: fixture.environment,
    statePath,
    confirmation: githubIndependentDrillConfirmations.begin,
    ...identity(),
  });
}

async function createPortableReceiptFixture() {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const issuerPublicKey = Buffer.from(await crypto.subtle.exportKey("raw", keyPair.publicKey)).toString("base64url");
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
      issuedAt: "2026-07-27T00:00:10Z",
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

async function recordedFixture({ recordedReceiptHash } = {}) {
  const fixture = makeDrillFixture();
  const receipt = await createPortableReceiptFixture();
  const directory = await mkdtemp(join(tmpdir(), "proofweave-drill-recorded-"));
  const statePath = join(directory, "state.json");
  await beginFixture(fixture, statePath);
  fixture.health.lastWakeAt = wakeAt;
  await fixture.drill.record({
    environment: fixture.environment,
    statePath,
    confirmation: githubIndependentDrillConfirmations.record,
    evidence: evidenceFixture({ receiptHash: recordedReceiptHash ?? receipt.receiptHash }),
  });
  return {
    fixture,
    receipt,
    statePath,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

function finalizeSetup(setup) {
  return setup.fixture.drill.finalize({
    environment: setup.fixture.environment,
    statePath: setup.statePath,
    confirmation: githubIndependentDrillConfirmations.finalize,
    correlationId: identity().correlationId,
    verificationBundle: setup.receipt.bundle,
    issuerKeyset: setup.receipt.keyset,
  });
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}
