import {
  delegationPayloadHash,
  delegationSigningPayload,
  verifyDelegationSignature,
} from "../../packages/domain/delegation.mjs";
import {
  contributionReceiptHash,
  contributionReceiptRequiredClaimTypes,
  verifyContributionReceiptSignature,
} from "../../packages/protocol/contribution-receipt.mjs";
import { canonicalJson, canonicalUtf8, sha256Canonical } from "../../packages/protocol/canonical-json.mjs";
import {
  personKeyProofChallengePayloadHash,
  personKeyProofChallengeProtocolVersion,
  personKeyProofChallengeSigningPayload,
  verifyPersonKeyProofChallengeSignature,
} from "../../packages/protocol/person-key-proof.mjs";
import {
  normalizeLeanRunnerResult,
  verifyLeanRunnerResultSignature,
} from "../../packages/protocol/lean-runner.mjs";
import {
  verificationAttestationPayloadHash,
  verificationAttestationSigningPayload,
} from "../../packages/protocol/verification-attestation.mjs";
import { D1InlineArtifactStore } from "../artifacts/d1-inline-artifact-store.mjs";
import { D1RemoteMcpGatewayStore } from "../proofweave-mcp-gateway/d1-gateway-store.mjs";
import { D1ContributionReceiptCoordinator } from "../receipts/d1-contribution-receipt-coordinator.mjs";
import { D1ContributionReceiptStore } from "../receipts/d1-contribution-receipt-store.mjs";
import { D1VerificationMarketStore } from "../verification/d1-verification-market-store.mjs";

export const buildWeekLiveReviewers = Object.freeze([
  mockReviewerIdentity({ slug: "mocker-1st", ordinal: "1st" }),
  mockReviewerIdentity({ slug: "mocker-2nd", ordinal: "2nd" }),
]);

// Retain the old singular export for downstream imports while making its
// meaning explicit: this is the replay reviewer, not the only reviewer.
export const buildWeekLiveReviewer = buildWeekLiveReviewers[0];

export const buildWeekLiveClaimOwnership = Object.freeze({
  bundle_reproducible: buildWeekLiveReviewers[0].personId,
  kernel_accepted: buildWeekLiveReviewers[1].personId,
  project_accepted: buildWeekLiveReviewers[1].personId,
});

const poolProtocolVersion = "pw-credit-pool-event-v1";
const poolPolicyVersion = "pw-credit-market-v1";
const creditUnit = "non_transferable_research_credit";
const requiredClaimTypes = Object.freeze([...contributionReceiptRequiredClaimTypes]);

export class BuildWeekLiveClosureConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "BuildWeekLiveClosureConfigurationError";
  }
}

/**
 * Operator-only Build Week closure helper. Both reviewers are deliberately and
 * permanently labelled as mock accounts, but their Person possession proofs,
 * delegations, replay provenance, claim signatures, and Receipt are real
 * protocol records. It never turns same-owner Agents into independent
 * reviewers and never fabricates a Runner result.
 */
export class D1BuildWeekLiveClosure {
  constructor({
    database,
    mocker1PersonPrivateKeyJwk,
    mocker1AgentPrivateKeyJwk,
    mocker2PersonPrivateKeyJwk,
    mocker2AgentPrivateKeyJwk,
    runnerDispatcher = null,
    receiptIssuer = null,
    now = () => new Date(),
  } = {}) {
    if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function") {
      throw new BuildWeekLiveClosureConfigurationError("Build Week live closure requires a D1-compatible database.");
    }
    if (typeof now !== "function") {
      throw new BuildWeekLiveClosureConfigurationError("Build Week live closure requires a clock function.");
    }
    this.database = database;
    this.reviewerCredentials = Object.freeze([
      reviewerCredential({
        identity: buildWeekLiveReviewers[0],
        personPrivateKeyJwk: mocker1PersonPrivateKeyJwk,
        agentPrivateKeyJwk: mocker1AgentPrivateKeyJwk,
      }),
      reviewerCredential({
        identity: buildWeekLiveReviewers[1],
        personPrivateKeyJwk: mocker2PersonPrivateKeyJwk,
        agentPrivateKeyJwk: mocker2AgentPrivateKeyJwk,
      }),
    ]);
    const reviewerPublicKeys = this.reviewerCredentials.flatMap((credential) => [
      credential.personPrivateKeyJwk.x,
      credential.agentPrivateKeyJwk.x,
    ]);
    if (new Set(reviewerPublicKeys).size !== reviewerPublicKeys.length) {
      throw new BuildWeekLiveClosureConfigurationError("Every mock reviewer Person and Agent key must be distinct.");
    }
    this.runnerDispatcher = runnerDispatcher;
    this.receiptIssuer = receiptIssuer ? normalizeReceiptIssuer(receiptIssuer) : null;
    this.now = now;
  }

  async prime({ artifactBundleHash }) {
    requireSha256(artifactBundleHash, "artifactBundleHash");
    if (!this.runnerDispatcher) {
      throw new BuildWeekLiveClosureConfigurationError("Priming the live closure requires the trusted Runner dispatcher.");
    }
    const bundle = await this.requireEligibleBundle(artifactBundleHash);
    const existing = await this.findAcceptedPrimaryRun(artifactBundleHash);
    if (existing) {
      return Object.freeze({
        state: "primary_run_succeeded",
        artifactBundleHash,
        attemptId: bundle.attemptId,
        ownerPersonId: bundle.attemptOwnerPersonId,
        runId: existing.id,
        runCreated: false,
      });
    }
    const queued = await this.runnerDispatcher.queueBundle({
      attempt: { id: bundle.attemptId, problemRevisionId: bundle.problemRevisionId },
      artifactBundleHash,
      idempotencyKey: primaryRunIdempotencyKey(artifactBundleHash),
    });
    return Object.freeze({
      state: queued.run.state === "succeeded" ? "primary_run_succeeded" : "primary_run_queued",
      artifactBundleHash,
      attemptId: bundle.attemptId,
      ownerPersonId: bundle.attemptOwnerPersonId,
      runId: queued.run.id,
      runCreated: queued.runCreated,
    });
  }

  async prepare({ artifactBundleHash }) {
    requireSha256(artifactBundleHash, "artifactBundleHash");
    if (!this.runnerDispatcher) {
      throw new BuildWeekLiveClosureConfigurationError("Preparing the live closure requires the trusted Runner dispatcher.");
    }
    const reviewers = await this.ensureMockReviewers();
    const bundle = await this.requireEligibleBundle(artifactBundleHash);
    if (reviewers.some((reviewer) => bundle.attemptOwnerPersonId === reviewer.personId)) {
      throw new BuildWeekLiveClosureConfigurationError("A mock reviewer cannot own the Attempt it reviews.");
    }

    const market = new D1VerificationMarketStore(this.database);
    const pool = await this.ensureActiveDemoPool(bundle.problemRevisionId, artifactBundleHash);
    const published = await market.publishJobsForBundle(artifactBundleHash, isoInstant(this.now()));
    if (!published.published) {
      throw new BuildWeekLiveClosureConfigurationError(`The live review jobs could not open: ${published.reason}.`);
    }

    const assignments = [];
    for (const claimType of requiredClaimTypes) {
      const job = published.jobs.find((candidate) => candidate.claimType === claimType);
      if (!job) throw new BuildWeekLiveClosureConfigurationError(`The live review market omitted ${claimType}.`);
      const reviewer = reviewerForClaim(reviewers, claimType);
      const claimed = await market.claimJob(job.id, reviewer.personId, isoInstant(this.now()));
      assignments.push(Object.freeze({ ...claimed.assignment, reviewer }));
    }

    const reproducibility = assignments.find((assignment) => assignment.claimType === "bundle_reproducible");
    if (!reproducibility) throw new BuildWeekLiveClosureConfigurationError("The reproducibility assignment was not created.");
    const gateway = new D1RemoteMcpGatewayStore({
      database: this.database,
      runnerDispatcher: this.runnerDispatcher,
    });
    const replay = await gateway.requestVerificationReplay(reproducibility.reviewer.principal, {
      assignmentId: reproducibility.id,
      idempotencyKey: replayIdempotencyKey(artifactBundleHash),
    });

    return Object.freeze({
      state: replay.replayEvidence ? "replay_evidence_recorded" : "replay_queued",
      artifactBundleHash,
      attemptId: bundle.attemptId,
      ownerPersonId: bundle.attemptOwnerPersonId,
      reviewers: Object.freeze(reviewers.map(publicReviewerProjection)),
      poolId: pool.id,
      assignments: Object.freeze(assignments.map((assignment) => Object.freeze({
        id: assignment.id,
        claimType: assignment.claimType,
        status: assignment.status,
        reviewerPersonId: assignment.reviewer.personId,
      }))),
      replay: Object.freeze({
        id: replay.replay.id,
        runId: replay.run.id,
        runState: replay.run.state,
        evidenceHash: replay.replayEvidence?.evidenceHash ?? null,
      }),
    });
  }

  async finalize({ artifactBundleHash }) {
    requireSha256(artifactBundleHash, "artifactBundleHash");
    if (!this.receiptIssuer) {
      throw new BuildWeekLiveClosureConfigurationError("Finalizing the live closure requires the Receipt issuer.");
    }
    const reviewers = await this.ensureMockReviewers();
    const bundle = await this.requireEligibleBundle(artifactBundleHash);
    if (reviewers.some((reviewer) => bundle.attemptOwnerPersonId === reviewer.personId)) {
      throw new BuildWeekLiveClosureConfigurationError("A mock reviewer cannot own the Attempt it reviews.");
    }
    const replayReviewer = reviewerForClaim(reviewers, "bundle_reproducible");
    const evidence = await this.requireTerminalReplayEvidence(artifactBundleHash, replayReviewer);
    const assignments = await this.requireReceiptGateAssignments(artifactBundleHash, reviewers);
    const artifacts = new D1InlineArtifactStore({ database: this.database });

    const kernelEvidence = await artifacts.putObject({
      bytes: canonicalJson({
        protocolVersion: "pw-build-week-review-evidence-v1",
        evidenceType: "kernel_acceptance_review",
        reviewerMode: "multiple_mock_owners",
        artifactBundleHash,
        target: bundle.target,
        primaryRun: evidence.primaryRun,
        freshReplay: evidence.freshReplay,
        checksRequired: ["network", "noSorry", "allowedAxioms", "leanBuild"],
        conclusion: "Both immutable signed Runner results succeeded with kernel acceptance and all four policy checks passed.",
      }),
      filename: "build-week-kernel-review.json",
      contentType: "application/json",
    });
    const projectEvidence = await artifacts.putObject({
      bytes: canonicalJson({
        protocolVersion: "pw-build-week-review-evidence-v1",
        evidenceType: "project_acceptance_review",
        reviewerMode: "multiple_mock_owners",
        artifactBundleHash,
        target: bundle.target,
        freshReplayEvidenceHash: evidence.replayEvidenceHash,
        acceptanceBoundary: "Build Week live protocol demonstration for the pinned Proofweave Lean fixture; no mathematical novelty claim is made.",
        conclusion: "The exact checked Bundle satisfies the pinned demo project's acceptance boundary.",
      }),
      filename: "build-week-project-review.json",
      contentType: "application/json",
    });

    const evidenceByClaim = new Map([
      ["bundle_reproducible", evidence.replayEvidenceHash],
      ["kernel_accepted", kernelEvidence.contentHash],
      ["project_accepted", projectEvidence.contentHash],
    ]);
    const receiptCoordinator = new D1ContributionReceiptCoordinator({
      database: this.database,
      issuer: this.receiptIssuer,
    });
    const gateway = new D1RemoteMcpGatewayStore({
      database: this.database,
      receiptCoordinator,
    });
    const closures = [];
    for (const claimType of requiredClaimTypes) {
      const reviewer = reviewerForClaim(reviewers, claimType);
      const assignment = assignments.find((candidate) => (
        candidate.claimType === claimType && candidate.verifierPersonId === reviewer.personId
      ));
      if (!assignment) throw new BuildWeekLiveClosureConfigurationError(`The ${claimType} assignment is missing.`);
      const attestation = await this.signedAttestation({
        assignment,
        reviewer,
        artifactBundleHash,
        evidenceHash: evidenceByClaim.get(claimType),
        attestedAt: deterministicAttestedAt(evidence.finishedAt, requiredClaimTypes.indexOf(claimType) + 1),
      });
      const recorded = await gateway.submitVerificationAttestation(reviewer.principal, attestation);
      closures.push(recorded.closure);
    }

    const closure = closures.at(-1);
    if (!closure || closure.state !== "receipt_issued" || !closure.receiptId || !closure.receiptHash) {
      throw new BuildWeekLiveClosureConfigurationError(`The live review completed without a Receipt: ${closure?.state ?? "unknown"}.`);
    }
    const receipt = await new D1ContributionReceiptStore(this.database).require(closure.receiptId);
    const actualReceiptHash = await contributionReceiptHash(receipt);
    if (actualReceiptHash !== closure.receiptHash || !await verifyContributionReceiptSignature(receipt)) {
      throw new BuildWeekLiveClosureConfigurationError("The issued live Receipt failed its public hash or signature verification.");
    }

    return Object.freeze({
      state: "receipt_issued",
      artifactBundleHash,
      ownerPersonId: bundle.attemptOwnerPersonId,
      reviewers: Object.freeze(reviewers.map(publicReviewerProjection)),
      reviewerMode: "multiple_mock_owners",
      replay: Object.freeze({
        id: evidence.replayId,
        runId: evidence.freshReplay.id,
        resultHash: evidence.freshReplay.resultHash,
        evidenceHash: evidence.replayEvidenceHash,
      }),
      attestationCount: requiredClaimTypes.length,
      receiptId: closure.receiptId,
      receiptHash: closure.receiptHash,
      receiptSignatureValid: true,
    });
  }

  async ensureMockReviewers() {
    return Object.freeze(await Promise.all(
      this.reviewerCredentials.map((credential) => this.ensureMockReviewer(credential)),
    ));
  }

  async ensureMockReviewer(credential = this.reviewerCredentials[0]) {
    if (!this.reviewerCredentials.includes(credential)) {
      throw new BuildWeekLiveClosureConfigurationError("Unknown mock reviewer credential.");
    }
    const ids = credential.identity;
    const now = isoInstant(this.now());
    const personPublicKey = credential.personPrivateKeyJwk.x;
    const agentPublicKey = credential.agentPrivateKeyJwk.x;
    const personFingerprint = await keyFingerprint(personPublicKey);
    const agentFingerprint = await keyFingerprint(agentPublicKey);

    await this.database.prepare(
      `INSERT OR IGNORE INTO persons (
         id, identity_provider, provider_subject, display_name, updated_at
       ) VALUES (?, ?, ?, ?, ?)`,
    ).bind(ids.personId, "proofweave-demo", ids.providerSubject, ids.displayName, now).run();
    await assertRow(this.database, "persons", ids.personId, {
      identity_provider: "proofweave-demo",
      provider_subject: ids.providerSubject,
      display_name: ids.displayName,
    });

    await this.database.prepare(
      "INSERT OR IGNORE INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)",
    ).bind(ids.personKeyId, ids.personId, personPublicKey, personFingerprint).run();
    await assertRow(this.database, "person_keys", ids.personKeyId, {
      person_id: ids.personId,
      public_key: personPublicKey,
      fingerprint: personFingerprint,
    });
    await this.ensurePersonPossessionProof({ credential, now, personPublicKey });

    await this.database.prepare(
      "INSERT OR IGNORE INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)",
    ).bind(ids.agentId, ids.personId, ids.agentLabel, agentPublicKey, agentFingerprint).run();
    await assertRow(this.database, "agents", ids.agentId, {
      owner_person_id: ids.personId,
      label: ids.agentLabel,
      public_key: agentPublicKey,
      key_fingerprint: agentFingerprint,
      status: "active",
    });
    await this.ensureReviewDelegation({ credential, personPublicKey, agentPublicKey });

    await this.database.prepare(
      `INSERT OR IGNORE INTO oauth_clients (
         id, client_name, redirect_uris_json, token_endpoint_auth_method
       ) VALUES (?, ?, ?, ?)`,
    ).bind(ids.clientId, `Proofweave Build Week ${ids.ordinal} mock reviewer`, "[]", "none").run();
    await assertRow(this.database, "oauth_clients", ids.clientId, {
      client_name: `Proofweave Build Week ${ids.ordinal} mock reviewer`,
      redirect_uris_json: "[]",
      token_endpoint_auth_method: "none",
    });

    await this.database.prepare(
      `INSERT OR IGNORE INTO agent_installations (
         id, person_id, agent_id, delegation_certificate_id, client_id, label
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      ids.installationId,
      ids.personId,
      ids.agentId,
      ids.delegationId,
      ids.clientId,
      `Build Week ${ids.ordinal} mock review connection`,
    ).run();
    await assertRow(this.database, "agent_installations", ids.installationId, {
      person_id: ids.personId,
      agent_id: ids.agentId,
      delegation_certificate_id: ids.delegationId,
      client_id: ids.clientId,
      status: "active",
    });

    return Object.freeze({
      personId: ids.personId,
      agentId: ids.agentId,
      delegationId: ids.delegationId,
      installationId: ids.installationId,
      ordinal: ids.ordinal,
      displayName: ids.displayName,
      agentPublicKey,
      principal: Object.freeze({
        clientId: ids.clientId,
        personId: ids.personId,
        agentInstallationId: ids.installationId,
        scopes: Object.freeze(["verification:replay", "verification:write"]),
      }),
    });
  }

  async ensurePersonPossessionProof({ credential, now, personPublicKey }) {
    const ids = credential.identity;
    const existing = await this.database.prepare(
      "SELECT id FROM person_key_proof_events WHERE person_key_id = ? ORDER BY verified_at DESC LIMIT 1",
    ).bind(ids.personKeyId).first();
    if (existing) return;

    const issuedAt = now;
    const expiresAt = new Date(Date.parse(now) + 5 * 60 * 1_000).toISOString();
    const challenge = {
      protocolVersion: personKeyProofChallengeProtocolVersion,
      id: ids.personProofChallengeId,
      personId: ids.personId,
      personKeyId: ids.personKeyId,
      personPublicKey,
      nonce: base64Url(crypto.getRandomValues(new Uint8Array(32))),
      issuedAt,
      expiresAt,
    };
    const canonicalPayload = canonicalJson(personKeyProofChallengeSigningPayload(challenge));
    const payloadHash = await personKeyProofChallengePayloadHash(challenge);
    const personSignature = base64Url(await crypto.subtle.sign(
      "Ed25519",
      await this.personPrivateKey(credential),
      canonicalUtf8(personKeyProofChallengeSigningPayload(challenge)),
    ));
    if (!await verifyPersonKeyProofChallengeSignature({ challenge, personPublicKey, personSignature })) {
      throw new BuildWeekLiveClosureConfigurationError("The mock reviewer Person possession proof did not verify.");
    }
    await this.database.batch([
      this.database.prepare(
        `INSERT OR IGNORE INTO person_key_proof_challenges (
           id, person_id, person_key_id, nonce, issued_at, expires_at,
           canonical_payload, payload_hash
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        challenge.id,
        challenge.personId,
        challenge.personKeyId,
        challenge.nonce,
        challenge.issuedAt,
        challenge.expiresAt,
        canonicalPayload,
        payloadHash,
      ),
      this.database.prepare(
        `INSERT OR IGNORE INTO person_key_proof_events (
           id, challenge_id, person_id, person_key_id, protocol_version,
           canonical_payload, payload_hash, person_signature, verified_at
         ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM person_key_proof_challenges WHERE id = ?)`,
      ).bind(
        ids.personProofId,
        challenge.id,
        challenge.personId,
        challenge.personKeyId,
        personKeyProofChallengeProtocolVersion,
        canonicalPayload,
        payloadHash,
        personSignature,
        now,
        challenge.id,
      ),
    ]);
    await assertRow(this.database, "person_key_proof_events", ids.personProofId, {
      challenge_id: challenge.id,
      person_id: challenge.personId,
      person_key_id: challenge.personKeyId,
      payload_hash: payloadHash,
      person_signature: personSignature,
    });
  }

  async ensureReviewDelegation({ credential, personPublicKey, agentPublicKey }) {
    const ids = credential.identity;
    const certificate = {
      id: ids.delegationId,
      ownerPersonId: ids.personId,
      agentId: ids.agentId,
      agentPublicKey,
      scopes: ["review"],
      validFrom: ids.validFrom,
      validUntil: ids.validUntil,
      attributionPolicy: {
        beneficiaryPersonId: ids.personId,
        mode: "agent_delegated",
      },
    };
    const canonicalPayload = canonicalJson(delegationSigningPayload(certificate));
    const payloadHash = await delegationPayloadHash(certificate);
    const personSignature = base64Url(await crypto.subtle.sign(
      "Ed25519",
      await this.personPrivateKey(credential),
      canonicalUtf8(delegationSigningPayload(certificate)),
    ));
    if (!await verifyDelegationSignature({ certificate, personPublicKey, personSignature })) {
      throw new BuildWeekLiveClosureConfigurationError("The mock reviewer delegation signature did not verify.");
    }
    await this.database.prepare(
      `INSERT OR IGNORE INTO delegation_certificates (
         id, owner_person_id, agent_id, person_key_id, agent_public_key,
         scopes_json, valid_from, valid_until, beneficiary_person_id,
         protocol_version, payload_hash, canonical_payload, person_signature
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      certificate.id,
      certificate.ownerPersonId,
      certificate.agentId,
      ids.personKeyId,
      certificate.agentPublicKey,
      JSON.stringify(certificate.scopes),
      certificate.validFrom,
      certificate.validUntil,
      certificate.attributionPolicy.beneficiaryPersonId,
      "pw-delegation-v1",
      payloadHash,
      canonicalPayload,
      personSignature,
    ).run();
    await assertRow(this.database, "delegation_certificates", ids.delegationId, {
      owner_person_id: ids.personId,
      agent_id: ids.agentId,
      person_key_id: ids.personKeyId,
      agent_public_key: agentPublicKey,
      scopes_json: '["review"]',
      payload_hash: payloadHash,
      canonical_payload: canonicalPayload,
      person_signature: personSignature,
    });
  }

  async ensureActiveDemoPool(problemRevisionId, artifactBundleHash) {
    const market = new D1VerificationMarketStore(this.database);
    let pool = await this.database.prepare(
      "SELECT * FROM problem_credit_pools WHERE problem_revision_id = ?",
    ).bind(problemRevisionId).first();
    const occurredAt = isoInstant(this.now());
    if (!pool) {
      const id = `pool:build-week-live:${artifactBundleHash.slice("sha256:".length, "sha256:".length + 16)}:v1`;
      await this.database.prepare(
        `INSERT OR IGNORE INTO problem_credit_pools (
           id, problem_revision_id, policy_version, unit,
           total_credits, sponsor_label, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        problemRevisionId,
        poolPolicyVersion,
        creditUnit,
        1_000,
        "Proofweave Build Week demo (non-financial)",
        occurredAt,
      ).run();
      pool = await this.database.prepare("SELECT * FROM problem_credit_pools WHERE id = ?").bind(id).first();
      if (!pool) throw new BuildWeekLiveClosureConfigurationError("The Build Week demo credit pool was not created.");
    }
    if (pool.policy_version !== poolPolicyVersion || pool.unit !== creditUnit) {
      throw new BuildWeekLiveClosureConfigurationError("The existing target pool is not compatible with the non-financial review market.");
    }

    const existingEvents = await this.database.prepare(
      "SELECT sequence, event_type FROM problem_credit_pool_events WHERE pool_id = ? ORDER BY sequence ASC",
    ).bind(pool.id).all();
    if ((existingEvents.results ?? []).length === 0) {
      await this.insertPoolEvent({
        pool,
        sequence: 1,
        eventType: "created",
        occurredAt,
        extra: {
          problemRevisionId,
          policyVersion: poolPolicyVersion,
          unit: creditUnit,
          totalCredits: Number(pool.total_credits),
          sponsorLabel: pool.sponsor_label,
        },
      });
    }
    const state = await market.requirePoolState(pool.id);
    if (state === "draft") {
      await this.insertPoolEvent({
        pool,
        sequence: 2,
        eventType: "activated",
        occurredAt: new Date(Date.parse(occurredAt) + 1).toISOString(),
        extra: {},
      });
    }
    const activeState = await market.requirePoolState(pool.id);
    if (activeState !== "active") {
      throw new BuildWeekLiveClosureConfigurationError(`The Build Week demo pool is ${activeState}, not active.`);
    }
    return Object.freeze({ id: pool.id, state: activeState });
  }

  async insertPoolEvent({ pool, sequence, eventType, occurredAt, extra }) {
    const payload = {
      protocolVersion: poolProtocolVersion,
      poolId: pool.id,
      sequence,
      eventType,
      occurredAt,
      ...extra,
    };
    const payloadHash = await sha256Canonical(payload);
    await this.database.prepare(
      `INSERT OR IGNORE INTO problem_credit_pool_events (
         id, pool_id, sequence, event_type, payload_hash,
         canonical_payload, occurred_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      `pool-event:${pool.id}:${sequence}`,
      pool.id,
      sequence,
      eventType,
      payloadHash,
      canonicalJson(payload),
      occurredAt,
      occurredAt,
    ).run();
  }

  async requireEligibleBundle(artifactBundleHash) {
    const row = await this.database.prepare(
      `SELECT bundle.attempt_id, bundle.problem_revision_id, bundle.canonical_manifest,
              attempt.person_id AS attempt_owner_person_id,
              attempt.agent_id AS attempt_agent_id,
              attempt.delegation_certificate_id
       FROM artifact_bundles AS bundle
       INNER JOIN agent_attempts AS attempt ON attempt.id = bundle.attempt_id
       WHERE bundle.manifest_hash = ?`,
    ).bind(artifactBundleHash).first();
    if (!row) throw new BuildWeekLiveClosureConfigurationError("The live closure Bundle was not found.");
    if (!row.attempt_agent_id || !row.delegation_certificate_id) {
      throw new BuildWeekLiveClosureConfigurationError("The live closure Bundle lacks delegated Agent attribution.");
    }
    let manifest;
    try {
      manifest = JSON.parse(row.canonical_manifest);
    } catch {
      throw new BuildWeekLiveClosureConfigurationError("The live closure Bundle manifest is malformed.");
    }
    return Object.freeze({
      attemptId: row.attempt_id,
      problemRevisionId: row.problem_revision_id,
      attemptOwnerPersonId: row.attempt_owner_person_id,
      target: Object.freeze({ ...manifest.target }),
    });
  }

  async findAcceptedPrimaryRun(artifactBundleHash) {
    const rows = await this.database.prepare(
      `SELECT run.id, run.state, run.runner_result_hash,
              result.result_hash, result.canonical_result
       FROM runs AS run
       INNER JOIN run_results AS result ON result.run_id = run.id
       WHERE run.artifact_bundle_hash = ?
         AND NOT EXISTS (
           SELECT 1 FROM verification_replays AS replay WHERE replay.run_id = run.id
         )
       ORDER BY run.finished_at DESC, run.id ASC`,
    ).bind(artifactBundleHash).all();
    for (const row of rows.results ?? []) {
      try {
        const result = normalizeLeanRunnerResult(JSON.parse(row.canonical_result));
        if (
          row.state === "succeeded"
          && result.status === "succeeded"
          && result.kernelStatus === "accepted"
          && row.runner_result_hash === row.result_hash
        ) return Object.freeze({ id: row.id });
      } catch {
        // Historical malformed or non-accepted results remain ineligible.
      }
    }
    return null;
  }

  async requireReceiptGateAssignments(artifactBundleHash, reviewers) {
    const rows = await this.database.prepare(
      `SELECT id, claim_type, verifier_person_id, status
       FROM verification_assignments
       WHERE artifact_bundle_manifest_hash = ?
         AND claim_type IN ('bundle_reproducible','kernel_accepted','project_accepted')
       ORDER BY claim_type ASC`,
    ).bind(artifactBundleHash).all();
    const assignments = (rows.results ?? []).map((row) => Object.freeze({
      id: row.id,
      claimType: row.claim_type,
      verifierPersonId: row.verifier_person_id,
      status: row.status,
    }));
    for (const claimType of requiredClaimTypes) {
      const expectedReviewer = reviewerForClaim(reviewers, claimType);
      const assignment = assignments.find((candidate) => (
        candidate.claimType === claimType && candidate.verifierPersonId === expectedReviewer.personId
      ));
      if (
        !assignment ||
        !["accepted", "completed"].includes(assignment.status)
      ) {
        throw new BuildWeekLiveClosureConfigurationError(
          `The ${claimType} assignment is not accepted for ${expectedReviewer.displayName}.`,
        );
      }
    }
    return Object.freeze(assignments);
  }

  async requireTerminalReplayEvidence(artifactBundleHash, reviewer) {
    const replay = await this.database.prepare(
      `SELECT replay.id AS replay_id, replay.run_id, evidence.evidence_hash,
              evidence.runner_result_hash, evidence.recorded_at,
              run.state, result.result_hash, result.canonical_result
       FROM verification_replays AS replay
       INNER JOIN verification_assignments AS assignment ON assignment.id = replay.assignment_id
       LEFT JOIN verification_replay_evidence AS evidence ON evidence.replay_id = replay.id
       LEFT JOIN runs AS run ON run.id = replay.run_id
       LEFT JOIN run_results AS result ON result.run_id = replay.run_id
       WHERE assignment.artifact_bundle_manifest_hash = ?
         AND assignment.claim_type = 'bundle_reproducible'
         AND replay.requester_person_id = ?
         AND replay.requester_agent_id = ?
         AND replay.delegation_certificate_id = ?
       ORDER BY replay.requested_at DESC LIMIT 1`,
    ).bind(
      artifactBundleHash,
      reviewer.personId,
      reviewer.agentId,
      reviewer.delegationId,
    ).first();
    if (!replay || !replay.evidence_hash || !replay.canonical_result) {
      throw new BuildWeekLiveClosureConfigurationError("The mock reviewer fresh replay has no terminal evidence yet.");
    }
    const freshReplay = await normalizeStoredRunnerResult(
      this.database,
      replay,
      artifactBundleHash,
      "fresh replay",
    );

    const primary = await this.database.prepare(
      `SELECT run.id AS run_id, run.state, run.runner_result_hash,
              result.result_hash, result.canonical_result
       FROM runs AS run
       INNER JOIN run_results AS result ON result.run_id = run.id
       WHERE run.artifact_bundle_hash = ?
         AND NOT EXISTS (SELECT 1 FROM verification_replays AS replay WHERE replay.run_id = run.id)
       ORDER BY run.finished_at DESC, run.id ASC`,
    ).bind(artifactBundleHash).all();
    let primaryRun = null;
    for (const row of primary.results ?? []) {
      try {
        primaryRun = await normalizeStoredRunnerResult(
          this.database,
          row,
          artifactBundleHash,
          "primary Run",
        );
        break;
      } catch {
        // Retain failed historical attempts while selecting only exact accepted evidence.
      }
    }
    if (!primaryRun) throw new BuildWeekLiveClosureConfigurationError("No succeeded kernel-accepted primary Run is stored for this Bundle.");
    return Object.freeze({
      replayId: replay.replay_id,
      replayEvidenceHash: replay.evidence_hash,
      primaryRun,
      freshReplay,
      finishedAt: laterInstant(primaryRun.finishedAt, freshReplay.finishedAt),
    });
  }

  async signedAttestation({ assignment, reviewer, artifactBundleHash, evidenceHash, attestedAt }) {
    const credential = this.reviewerCredential(reviewer.personId);
    const attestation = {
      protocolVersion: "pw-verification-attestation-v1",
      id: `attestation:build-week-live:${artifactBundleHash.slice("sha256:".length, "sha256:".length + 16)}:${assignment.claimType}:v2`,
      assignmentId: assignment.id,
      artifactBundleHash,
      claimType: assignment.claimType,
      verifierPersonId: reviewer.personId,
      verifierAgentId: reviewer.agentId,
      delegationCertificateId: reviewer.delegationId,
      verifierAgentPublicKey: credential.agentPrivateKeyJwk.x,
      decision: "attested",
      evidenceHash,
      attestedAt,
      payloadHash: `sha256:${"0".repeat(64)}`,
      signature: base64Url(new Uint8Array(64)),
    };
    attestation.payloadHash = await verificationAttestationPayloadHash(attestation);
    attestation.signature = base64Url(await crypto.subtle.sign(
      "Ed25519",
      await this.agentPrivateKey(credential),
      canonicalUtf8(verificationAttestationSigningPayload(attestation)),
    ));
    return Object.freeze(attestation);
  }

  reviewerCredential(personId) {
    const credential = this.reviewerCredentials.find((candidate) => candidate.identity.personId === personId);
    if (!credential) throw new BuildWeekLiveClosureConfigurationError("Unknown mock reviewer Person.");
    return credential;
  }

  personPrivateKey(credential) {
    credential.personPrivateKeyPromise ??= importPrivateEd25519Key(
      credential.personPrivateKeyJwk,
      `${credential.identity.displayName} Person key`,
    );
    return credential.personPrivateKeyPromise;
  }

  agentPrivateKey(credential) {
    credential.agentPrivateKeyPromise ??= importPrivateEd25519Key(
      credential.agentPrivateKeyJwk,
      `${credential.identity.displayName} Agent key`,
    );
    return credential.agentPrivateKeyPromise;
  }
}

async function normalizeStoredRunnerResult(database, row, artifactBundleHash, label) {
  let result;
  try {
    result = normalizeLeanRunnerResult(JSON.parse(row.canonical_result));
  } catch {
    throw new BuildWeekLiveClosureConfigurationError(`The stored ${label} result is malformed.`);
  }
  const storedResultHash = row.result_hash;
  const runnerKey = await database.prepare(
    `SELECT public_key, fingerprint
     FROM runner_keys
     WHERE id = ? AND status = 'active' AND revoked_at IS NULL`,
  ).bind(result.runnerKeyId).first();
  const canonicalResultHash = await sha256Canonical(result);
  if (
    row.state !== "succeeded" || result.status !== "succeeded" || result.kernelStatus !== "accepted" ||
    result.jobId !== row.run_id || result.artifacts.manifestHash !== artifactBundleHash ||
    canonicalJson(result) !== row.canonical_result || canonicalResultHash !== storedResultHash ||
    row.runner_result_hash !== storedResultHash || !runnerKey ||
    await keyFingerprint(runnerKey.public_key) !== runnerKey.fingerprint ||
    !await verifyLeanRunnerResultSignature({ result, runnerPublicKey: runnerKey.public_key }) ||
    Object.values(result.checks).some((value) => value !== "passed")
  ) {
    throw new BuildWeekLiveClosureConfigurationError(`The stored ${label} does not satisfy the accepted Runner boundary.`);
  }
  return Object.freeze({
    id: row.run_id ?? result.jobId,
    resultHash: storedResultHash,
    finishedAt: result.finishedAt,
    kernelStatus: result.kernelStatus,
    checks: Object.freeze({ ...result.checks }),
  });
}

function mockReviewerIdentity({ slug, ordinal }) {
  const versionedSlug = `build-week-${slug}-v2`;
  return Object.freeze({
    slug,
    ordinal,
    personId: `person:${versionedSlug}`,
    personKeyId: `person-key:${versionedSlug}`,
    personProofChallengeId: `person-key-proof-challenge:${versionedSlug}`,
    personProofId: `person-key-proof:${versionedSlug}`,
    agentId: `agent:${versionedSlug}`,
    delegationId: `delegation:${versionedSlug}`,
    clientId: `client:${versionedSlug}`,
    installationId: `installation:${versionedSlug}`,
    providerSubject: versionedSlug,
    displayName: `Build Week Mocker ${ordinal} (demo)`,
    agentLabel: `Build Week Mocker ${ordinal} Review Agent`,
    validFrom: "2026-07-18T00:00:00.000Z",
    validUntil: "2027-07-18T00:00:00.000Z",
  });
}

function reviewerCredential({ identity, personPrivateKeyJwk, agentPrivateKeyJwk }) {
  return {
    identity,
    personPrivateKeyJwk: normalizePrivateEd25519Jwk(
      personPrivateKeyJwk,
      `${identity.displayName} Person key`,
    ),
    agentPrivateKeyJwk: normalizePrivateEd25519Jwk(
      agentPrivateKeyJwk,
      `${identity.displayName} Agent key`,
    ),
    personPrivateKeyPromise: null,
    agentPrivateKeyPromise: null,
  };
}

function reviewerForClaim(reviewers, claimType) {
  const expectedPersonId = buildWeekLiveClaimOwnership[claimType];
  const reviewer = reviewers.find((candidate) => candidate.personId === expectedPersonId);
  if (!reviewer) {
    throw new BuildWeekLiveClosureConfigurationError(`No mock reviewer is assigned to ${claimType}.`);
  }
  return reviewer;
}

function publicReviewerProjection(reviewer) {
  return Object.freeze({
    personId: reviewer.personId,
    agentId: reviewer.agentId,
    ordinal: reviewer.ordinal,
    displayName: reviewer.displayName,
  });
}

function normalizePrivateEd25519Jwk(value, label) {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    value.kty !== "OKP" || value.crv !== "Ed25519" ||
    !base64UrlKeyMaterial(value.x) || !base64UrlKeyMaterial(value.d)
  ) {
    throw new BuildWeekLiveClosureConfigurationError(`${label} must be an Ed25519 private JWK.`);
  }
  return Object.freeze({ ...value });
}

function normalizeReceiptIssuer(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BuildWeekLiveClosureConfigurationError("Receipt issuer configuration is required.");
  }
  requireIdentifier(value.keyId, "Receipt issuer keyId");
  requireUtcInstant(value.activatedAt, "Receipt issuer activatedAt");
  const privateKeyJwk = normalizePrivateEd25519Jwk(value.privateKeyJwk, "Receipt issuer key");
  if (value.publicKey !== privateKeyJwk.x) {
    throw new BuildWeekLiveClosureConfigurationError("Receipt issuer public key does not match its private JWK.");
  }
  return Object.freeze({
    keyId: value.keyId,
    publicKey: value.publicKey,
    privateKeyJwk,
    activatedAt: value.activatedAt,
  });
}

async function importPrivateEd25519Key(jwk, label) {
  try {
    return await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
  } catch {
    throw new BuildWeekLiveClosureConfigurationError(`${label} could not be imported.`);
  }
}

async function keyFingerprint(publicKey) {
  const bytes = fromBase64Url(publicKey);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function assertRow(database, table, id, expected) {
  if (![
    "persons",
    "person_keys",
    "person_key_proof_events",
    "agents",
    "delegation_certificates",
    "oauth_clients",
    "agent_installations",
  ].includes(table)) {
    throw new BuildWeekLiveClosureConfigurationError("Unsupported exact-row check.");
  }
  const row = await database.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
  if (!row) throw new BuildWeekLiveClosureConfigurationError(`Expected ${table} record was not created.`);
  for (const [key, value] of Object.entries(expected)) {
    if (row[key] !== value) {
      throw new BuildWeekLiveClosureConfigurationError(`Existing ${table} record conflicts with the live demo identity.`);
    }
  }
}

function deterministicAttestedAt(finishedAt, offsetSeconds) {
  return new Date(Date.parse(finishedAt) + offsetSeconds * 1_000).toISOString();
}

function replayIdempotencyKey(artifactBundleHash) {
  return `build-week-live-replay-v1:${artifactBundleHash.slice("sha256:".length, "sha256:".length + 32)}`;
}

function primaryRunIdempotencyKey(artifactBundleHash) {
  return `build-week-live-primary-v1:${artifactBundleHash.slice("sha256:".length, "sha256:".length + 32)}`;
}

function laterInstant(left, right) {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function isoInstant(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new BuildWeekLiveClosureConfigurationError("The live closure clock returned an invalid instant.");
  }
  return date.toISOString();
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 240 || /[\0\r\n]/.test(value)) {
    throw new BuildWeekLiveClosureConfigurationError(`${label} must be a bounded identifier.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new BuildWeekLiveClosureConfigurationError(`${label} must be sha256:<hex>.`);
  }
}

function requireUtcInstant(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new BuildWeekLiveClosureConfigurationError(`${label} must be a UTC instant.`);
  }
}

function base64UrlKeyMaterial(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function base64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
