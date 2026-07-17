import { closedAlphaReviewLimits } from "../../packages/domain/attempt-policy.mjs";
import { canonicalJson, sha256Canonical } from "../../packages/protocol/canonical-json.mjs";
import { projectCreditPoolState } from "../../packages/protocol/credit-market.mjs";
import { normalizeLeanRunnerResult } from "../../packages/protocol/lean-runner.mjs";
import {
  verificationClaimPolicy,
  verificationMarketClaims,
  verificationMarketPolicyVersion,
} from "../../packages/protocol/verification-market.mjs";

export class VerificationMarketConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "VerificationMarketConflictError";
  }
}

export class VerificationMarketNotFoundError extends Error {
  constructor() {
    super("Verification market job was not found.");
    this.name = "VerificationMarketNotFoundError";
  }
}

export class VerificationMarketValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "VerificationMarketValidationError";
  }
}

export class D1VerificationMarketStore {
  constructor(database) {
    if (!database || typeof database.prepare !== "function") {
      throw new TypeError("D1VerificationMarketStore requires a D1 database binding.");
    }
    this.database = database;
  }

  async publishJobsForBundle(artifactBundleManifestHash, publishedAt = new Date().toISOString()) {
    requireSha256(artifactBundleManifestHash, "artifactBundleManifestHash");
    requireUtcInstant(publishedAt, "publishedAt");
    const bundle = await this.database.prepare(
      `SELECT bundle.manifest_hash, bundle.problem_revision_id,
              attempt.person_id AS attempt_owner_person_id,
              pool.id AS pool_id
       FROM artifact_bundles AS bundle
       INNER JOIN agent_attempts AS attempt ON attempt.id = bundle.attempt_id
       LEFT JOIN problem_credit_pools AS pool
         ON pool.problem_revision_id = bundle.problem_revision_id
       WHERE bundle.manifest_hash = ?`,
    ).bind(artifactBundleManifestHash).first();
    if (!bundle) throw new VerificationMarketValidationError("Verification jobs require an existing staged Artifact Bundle.");
    if (!bundle.pool_id) return Object.freeze({ published: false, reason: "no_pool", jobs: Object.freeze([]) });
    const poolState = await this.requirePoolState(bundle.pool_id);
    if (poolState !== "active") {
      return Object.freeze({ published: false, reason: `pool_${poolState}`, jobs: Object.freeze([]) });
    }
    if (!await this.hasAcceptedLeanResult(bundle)) {
      return Object.freeze({ published: false, reason: "lean_not_accepted", jobs: Object.freeze([]) });
    }

    for (const policy of verificationMarketClaims) {
      const jobHash = await sha256Canonical({
        protocolVersion: verificationMarketPolicyVersion,
        poolId: bundle.pool_id,
        artifactBundleManifestHash,
        claimType: policy.claimType,
      });
      const jobId = `verification-job:${jobHash.slice("sha256:".length)}`;
      const event = await jobEvent({
        jobId,
        sequence: 1,
        eventType: "published",
        occurredAt: publishedAt,
        payload: {
          poolId: bundle.pool_id,
          artifactBundleManifestHash,
          claimType: policy.claimType,
          rewardWeight: policy.rewardWeight,
        },
      });
      await this.database.batch([
        this.database.prepare(
          `INSERT OR IGNORE INTO verification_market_jobs (
             id, problem_revision_id, pool_id, artifact_bundle_manifest_hash,
             claim_type, attempt_owner_person_id, reward_weight,
             policy_version, published_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          jobId,
          bundle.problem_revision_id,
          bundle.pool_id,
          artifactBundleManifestHash,
          policy.claimType,
          bundle.attempt_owner_person_id,
          policy.rewardWeight,
          verificationMarketPolicyVersion,
          publishedAt,
        ),
        insertJobEvent(this.database, event, true),
      ]);
      await this.assertStoredJob({
        id: jobId,
        problemRevisionId: bundle.problem_revision_id,
        poolId: bundle.pool_id,
        artifactBundleManifestHash,
        claimType: policy.claimType,
        attemptOwnerPersonId: bundle.attempt_owner_person_id,
        rewardWeight: policy.rewardWeight,
      });
    }

    return Object.freeze({
      published: true,
      reason: null,
      jobs: Object.freeze(await this.listBundleJobs(artifactBundleManifestHash)),
    });
  }

  async listOpenJobs(limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new VerificationMarketValidationError("Open verification job limit must be between 1 and 100.");
    }
    const rows = await this.database.prepare(
      `SELECT job.id, job.problem_revision_id, job.pool_id,
              job.artifact_bundle_manifest_hash, job.claim_type,
              job.reward_weight, job.policy_version, job.published_at,
              revision.slug AS problem_slug, revision.title AS problem_title,
              project.slug AS project_slug, attempt.agent_label,
              pool.total_credits, pool.sponsor_label
       FROM verification_market_jobs AS job
       INNER JOIN artifact_bundles AS bundle
         ON bundle.manifest_hash = job.artifact_bundle_manifest_hash
       INNER JOIN agent_attempts AS attempt ON attempt.id = bundle.attempt_id
       INNER JOIN problem_revisions AS revision ON revision.id = job.problem_revision_id
       INNER JOIN projects AS project ON project.id = revision.project_id
       INNER JOIN problem_credit_pools AS pool ON pool.id = job.pool_id
       LEFT JOIN verification_market_job_claims AS claim ON claim.job_id = job.id
       WHERE claim.id IS NULL
       ORDER BY job.published_at ASC, job.id ASC
       LIMIT ?`,
    ).bind(limit).all();
    const projected = [];
    const poolStates = new Map();
    for (const row of rows.results ?? []) {
      let state = poolStates.get(row.pool_id);
      if (!state) {
        state = await this.requirePoolState(row.pool_id);
        poolStates.set(row.pool_id, state);
      }
      if (state !== "active") continue;
      const policy = verificationClaimPolicy(row.claim_type);
      if (!policy || policy.rewardWeight !== Number(row.reward_weight) || row.policy_version !== verificationMarketPolicyVersion) {
        throw new VerificationMarketValidationError("Stored verification job does not match the active market policy.");
      }
      projected.push(publicJob(row, policy));
    }
    return Object.freeze(projected);
  }

  async claimJob(jobId, verifierPersonId, claimedAt = new Date().toISOString()) {
    requireIdentifier(jobId, "jobId");
    requireIdentifier(verifierPersonId, "verifierPersonId");
    requireUtcInstant(claimedAt, "claimedAt");
    const job = await this.requireJob(jobId);
    const existingClaim = await this.database.prepare(
      "SELECT * FROM verification_market_job_claims WHERE job_id = ?",
    ).bind(jobId).first();
    if (existingClaim) {
      if (existingClaim.verifier_person_id !== verifierPersonId) {
        throw new VerificationMarketConflictError("This verification job has already been claimed by another Person.");
      }
      return Object.freeze({
        created: false,
        job: toStoredJob(job),
        assignment: await this.requireAssignment(existingClaim.assignment_id),
      });
    }
    if (job.attempt_owner_person_id === verifierPersonId) {
      throw new VerificationMarketConflictError("A Person cannot claim independent review work over their own Attempt.");
    }
    if (await this.requirePoolState(job.pool_id) !== "active") {
      throw new VerificationMarketConflictError("This verification pool is not active for new review claims.");
    }
    if (!await this.hasActiveReviewDelegation(verifierPersonId, claimedAt)) {
      throw new VerificationMarketConflictError("Claiming public review work requires an active review-scoped Agent delegation.");
    }
    if (await this.activeAssignmentCount(verifierPersonId) >= closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson) {
      throw new VerificationMarketConflictError(
        `This Person already has ${closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson} active independent reviews.`,
      );
    }

    const assignmentHash = await sha256Canonical({
      protocolVersion: verificationMarketPolicyVersion,
      jobId,
      verifierPersonId,
    });
    const assignmentId = `verification-assignment:${assignmentHash.slice("sha256:".length)}`;
    const claimId = `verification-job-claim:${assignmentHash.slice("sha256:".length)}`;
    const assigned = {
      id: assignmentId,
      artifactBundleManifestHash: job.artifact_bundle_manifest_hash,
      claimType: job.claim_type,
      attemptOwnerPersonId: job.attempt_owner_person_id,
      verifierPersonId,
      assignedAt: claimedAt,
    };
    const assignmentCreatedEvent = await assignmentEvent({
      assignment: { ...assigned, status: "assigned" },
      sequence: 1,
      eventType: "assignment_created",
      occurredAt: claimedAt,
      payload: {
        artifactBundleManifestHash: job.artifact_bundle_manifest_hash,
        claimType: job.claim_type,
        verifierPersonId,
        marketJobId: jobId,
      },
    });
    const assignmentAcceptedEvent = await assignmentEvent({
      assignment: { ...assigned, status: "accepted" },
      sequence: 2,
      eventType: "assignment_accepted",
      occurredAt: claimedAt,
      payload: { verifierPersonId, marketJobId: jobId },
    });
    const claimedEvent = await jobEvent({
      jobId,
      sequence: 2,
      eventType: "claimed",
      occurredAt: claimedAt,
      payload: { assignmentId, verifierPersonId },
    });

    const results = await this.database.batch([
      this.database.prepare(
        `INSERT INTO verification_assignments (
           id, artifact_bundle_manifest_hash, claim_type,
           attempt_owner_person_id, verifier_person_id, status,
           assigned_at, accepted_at, updated_at
         )
         SELECT ?, job.artifact_bundle_manifest_hash, job.claim_type,
                job.attempt_owner_person_id, ?, 'accepted', ?, ?, ?
         FROM verification_market_jobs AS job
         WHERE job.id = ?
           AND job.attempt_owner_person_id <> ?
           AND NOT EXISTS (
             SELECT 1 FROM verification_market_job_claims AS existing_claim
             WHERE existing_claim.job_id = job.id
           )
           AND (
             SELECT COUNT(*) FROM verification_assignments AS active_assignment
             WHERE active_assignment.verifier_person_id = ?
               AND active_assignment.status IN ('assigned','accepted')
           ) < ?
           AND EXISTS (${activeReviewDelegationSelect()})
           AND (
             SELECT pool_event.event_type
             FROM problem_credit_pool_events AS pool_event
             WHERE pool_event.pool_id = job.pool_id
             ORDER BY pool_event.sequence DESC LIMIT 1
           ) = 'activated'`,
      ).bind(
        assignmentId,
        verifierPersonId,
        claimedAt,
        claimedAt,
        claimedAt,
        jobId,
        verifierPersonId,
        verifierPersonId,
        closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson,
        verifierPersonId,
        claimedAt,
        claimedAt,
        claimedAt,
      ),
      insertAssignmentEvent(this.database, assignmentCreatedEvent, assignmentId),
      insertAssignmentEvent(this.database, assignmentAcceptedEvent, assignmentId),
      this.database.prepare(
        `INSERT INTO verification_market_job_claims (
           id, job_id, assignment_id, verifier_person_id, claimed_at
         )
         SELECT ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM verification_assignments WHERE id = ?)
           AND NOT EXISTS (SELECT 1 FROM verification_market_job_claims WHERE job_id = ?)`,
      ).bind(claimId, jobId, assignmentId, verifierPersonId, claimedAt, assignmentId, jobId),
      insertJobEvent(this.database, claimedEvent, false, claimId),
    ]);
    const claim = await this.database.prepare(
      "SELECT * FROM verification_market_job_claims WHERE job_id = ?",
    ).bind(jobId).first();
    if (!claim) {
      throw new VerificationMarketConflictError("This verification job changed before the claim could be recorded.");
    }
    if (claim.verifier_person_id !== verifierPersonId) {
      throw new VerificationMarketConflictError("This verification job was claimed concurrently by another Person.");
    }
    return Object.freeze({
      created: Number(results[0]?.meta?.changes ?? 0) === 1,
      job: toStoredJob(job),
      assignment: await this.requireAssignment(claim.assignment_id),
    });
  }

  async listBundleJobs(artifactBundleManifestHash) {
    const rows = await this.database.prepare(
      `SELECT * FROM verification_market_jobs
       WHERE artifact_bundle_manifest_hash = ?
       ORDER BY claim_type ASC`,
    ).bind(artifactBundleManifestHash).all();
    return (rows.results ?? []).map(toStoredJob);
  }

  async bundleReviewStatus(artifactBundleManifestHash) {
    requireSha256(artifactBundleManifestHash, "artifactBundleManifestHash");
    const rows = await this.database.prepare(
      `SELECT job.claim_type, job.reward_weight, claim.id AS claim_id,
              assignment.status AS assignment_status
       FROM verification_market_jobs AS job
       LEFT JOIN verification_market_job_claims AS claim ON claim.job_id = job.id
       LEFT JOIN verification_assignments AS assignment ON assignment.id = claim.assignment_id
       WHERE job.artifact_bundle_manifest_hash = ?
       ORDER BY job.claim_type ASC`,
    ).bind(artifactBundleManifestHash).all();
    const jobs = (rows.results ?? []).map((row) => Object.freeze({
      claimType: row.claim_type,
      rewardWeight: Number(row.reward_weight),
      state: !row.claim_id ? "open" : row.assignment_status === "completed" ? "completed" : "claimed",
    }));
    return Object.freeze({
      totalJobs: jobs.length,
      openJobs: jobs.filter((job) => job.state === "open").length,
      claimedJobs: jobs.filter((job) => job.state === "claimed").length,
      completedJobs: jobs.filter((job) => job.state === "completed").length,
      jobs: Object.freeze(jobs),
    });
  }

  async hasAcceptedLeanResult(bundle) {
    const rows = await this.database.prepare(
      `SELECT run.id, run.attempt_id, run.artifact_bundle_hash, run.state,
              run.runner_result_hash, result.result_hash, result.canonical_result
       FROM runs AS run
       INNER JOIN run_results AS result ON result.run_id = run.id
       WHERE run.artifact_bundle_hash = ?
       ORDER BY run.finished_at DESC, run.id ASC`,
    ).bind(bundle.manifest_hash).all();
    for (const row of rows.results ?? []) {
      let result;
      try {
        result = normalizeLeanRunnerResult(JSON.parse(row.canonical_result));
      } catch {
        throw new VerificationMarketValidationError("Stored Lean Runner evidence is not a valid canonical result.");
      }
      const resultHash = await sha256Canonical(result);
      if (
        canonicalJson(result) !== row.canonical_result ||
        resultHash !== row.result_hash ||
        resultHash !== row.runner_result_hash ||
        result.jobId !== row.id ||
        result.attemptId !== row.attempt_id ||
        row.attempt_id === null ||
        row.artifact_bundle_hash !== bundle.manifest_hash ||
        result.artifacts.manifestHash !== bundle.manifest_hash
      ) {
        throw new VerificationMarketValidationError("Stored Lean Runner evidence failed its immutable integrity check.");
      }
      if (row.state === "succeeded" && result.status === "succeeded" && result.kernelStatus === "accepted") return true;
    }
    return false;
  }

  async requirePoolState(poolId) {
    const rows = await this.database.prepare(
      `SELECT sequence, event_type, payload_hash, canonical_payload, occurred_at
       FROM problem_credit_pool_events
       WHERE pool_id = ?
       ORDER BY sequence ASC`,
    ).bind(poolId).all();
    const events = rows.results ?? [];
    if (events.length === 0) throw new VerificationMarketValidationError("Verification market pool has no lifecycle events.");
    for (const row of events) {
      let payload;
      try {
        payload = JSON.parse(row.canonical_payload);
      } catch {
        throw new VerificationMarketValidationError("Verification market pool event is not valid canonical JSON.");
      }
      if (
        canonicalJson(payload) !== row.canonical_payload ||
        await sha256Canonical(payload) !== row.payload_hash ||
        payload.poolId !== poolId ||
        payload.sequence !== Number(row.sequence) ||
        payload.eventType !== row.event_type ||
        payload.occurredAt !== row.occurred_at
      ) {
        throw new VerificationMarketValidationError("Verification market pool event failed its canonical integrity check.");
      }
    }
    return projectCreditPoolState(events.map((row) => ({ sequence: Number(row.sequence), eventType: row.event_type })));
  }

  async requireJob(jobId) {
    const row = await this.database.prepare("SELECT * FROM verification_market_jobs WHERE id = ?").bind(jobId).first();
    if (!row) throw new VerificationMarketNotFoundError();
    const policy = verificationClaimPolicy(row.claim_type);
    if (!policy || policy.rewardWeight !== Number(row.reward_weight) || row.policy_version !== verificationMarketPolicyVersion) {
      throw new VerificationMarketValidationError("Stored verification job does not match the market policy.");
    }
    return row;
  }

  async assertStoredJob(expected) {
    const row = await this.requireJob(expected.id);
    if (
      row.problem_revision_id !== expected.problemRevisionId ||
      row.pool_id !== expected.poolId ||
      row.artifact_bundle_manifest_hash !== expected.artifactBundleManifestHash ||
      row.claim_type !== expected.claimType ||
      row.attempt_owner_person_id !== expected.attemptOwnerPersonId ||
      Number(row.reward_weight) !== expected.rewardWeight
    ) {
      throw new VerificationMarketConflictError("A verification job id is already bound to different immutable work.");
    }
  }

  async hasActiveReviewDelegation(personId, at) {
    const row = await this.database.prepare(activeReviewDelegationSelect()).bind(personId, at, at, at).first();
    return Boolean(row);
  }

  async activeAssignmentCount(personId) {
    const row = await this.database.prepare(
      `SELECT COUNT(*) AS count FROM verification_assignments
       WHERE verifier_person_id = ? AND status IN ('assigned','accepted')`,
    ).bind(personId).first();
    return Number(row?.count ?? 0);
  }

  async requireAssignment(assignmentId) {
    const row = await this.database.prepare("SELECT * FROM verification_assignments WHERE id = ?").bind(assignmentId).first();
    if (!row) throw new VerificationMarketConflictError("Claimed verification assignment could not be read.");
    return Object.freeze({
      id: row.id,
      artifactBundleManifestHash: row.artifact_bundle_manifest_hash,
      claimType: row.claim_type,
      attemptOwnerPersonId: row.attempt_owner_person_id,
      verifierPersonId: row.verifier_person_id,
      status: row.status,
      assignedAt: row.assigned_at,
      acceptedAt: row.accepted_at,
      completedAt: row.completed_at,
    });
  }
}

function activeReviewDelegationSelect() {
  return `SELECT certificate.id
    FROM delegation_certificates AS certificate
    INNER JOIN agents AS agent ON agent.id = certificate.agent_id
    INNER JOIN person_keys AS signer ON signer.id = certificate.person_key_id
    LEFT JOIN delegation_revocations AS revocation
      ON revocation.delegation_certificate_id = certificate.id
    LEFT JOIN person_key_revocations AS key_revocation
      ON key_revocation.person_key_id = signer.id
    WHERE certificate.owner_person_id = ?
      AND agent.owner_person_id = certificate.owner_person_id
      AND agent.status = 'active'
      AND EXISTS (
        SELECT 1 FROM json_each(certificate.scopes_json) AS scope
        WHERE scope.value = 'review'
      )
      AND certificate.valid_from <= ? AND certificate.valid_until > ?
      AND (revocation.revoked_at IS NULL OR revocation.revoked_at > ?)
      AND COALESCE(key_revocation.revoked_at, signer.revoked_at) IS NULL
    LIMIT 1`;
}

async function assignmentEvent({ assignment, sequence, eventType, occurredAt, payload }) {
  const eventPayload = {
    protocolVersion: "pw-verification-assignment-event-v1",
    assignmentId: assignment.id,
    sequence,
    eventType,
    status: assignment.status,
    occurredAt,
    ...payload,
  };
  return Object.freeze({
    id: `verification-event:${assignment.id}:${sequence}`,
    assignmentId: assignment.id,
    sequence,
    eventType,
    status: assignment.status,
    payloadHash: await sha256Canonical(eventPayload),
    canonicalPayload: canonicalJson(eventPayload),
    occurredAt,
  });
}

async function jobEvent({ jobId, sequence, eventType, occurredAt, payload }) {
  const eventPayload = {
    protocolVersion: "pw-verification-market-job-event-v1",
    jobId,
    sequence,
    eventType,
    occurredAt,
    ...payload,
  };
  const payloadHash = await sha256Canonical(eventPayload);
  return Object.freeze({
    id: `verification-market-event:${payloadHash.slice("sha256:".length)}`,
    jobId,
    sequence,
    eventType,
    payloadHash,
    canonicalPayload: canonicalJson(eventPayload),
    occurredAt,
  });
}

function insertAssignmentEvent(database, event, assignmentId) {
  return database.prepare(
    `INSERT INTO verification_assignment_events (
       id, assignment_id, sequence, event_type, status,
       payload_hash, canonical_payload, occurred_at
     )
     SELECT ?, ?, ?, ?, ?, ?, ?, ?
     WHERE EXISTS (SELECT 1 FROM verification_assignments WHERE id = ?)`,
  ).bind(
    event.id,
    event.assignmentId,
    event.sequence,
    event.eventType,
    event.status,
    event.payloadHash,
    event.canonicalPayload,
    event.occurredAt,
    assignmentId,
  );
}

function insertJobEvent(database, event, published = false, claimId = null) {
  const guard = published
    ? "EXISTS (SELECT 1 FROM verification_market_jobs WHERE id = ?)"
    : "EXISTS (SELECT 1 FROM verification_market_job_claims WHERE id = ?)";
  return database.prepare(
    `INSERT OR IGNORE INTO verification_market_job_events (
       id, job_id, sequence, event_type, payload_hash, canonical_payload, occurred_at
     )
     SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`,
  ).bind(
    event.id,
    event.jobId,
    event.sequence,
    event.eventType,
    event.payloadHash,
    event.canonicalPayload,
    event.occurredAt,
    published ? event.jobId : claimId,
  );
}

function publicJob(row, policy) {
  return Object.freeze({
    id: row.id,
    claimType: row.claim_type,
    label: policy.label,
    evidenceRequirement: policy.evidenceRequirement,
    rewardWeight: Number(row.reward_weight),
    artifactBundleManifestHash: row.artifact_bundle_manifest_hash,
    publishedAt: row.published_at,
    submittingAgentLabel: row.agent_label ?? "Delegated Agent",
    target: Object.freeze({
      problemRevisionId: row.problem_revision_id,
      problemSlug: row.problem_slug,
      projectSlug: row.project_slug,
      title: row.problem_title,
    }),
    pool: Object.freeze({
      id: row.pool_id,
      totalCredits: Number(row.total_credits),
      sponsorLabel: row.sponsor_label,
      verificationBucketPercentage: 20,
    }),
  });
}

function toStoredJob(row) {
  return Object.freeze({
    id: row.id,
    problemRevisionId: row.problem_revision_id,
    poolId: row.pool_id,
    artifactBundleManifestHash: row.artifact_bundle_manifest_hash,
    claimType: row.claim_type,
    attemptOwnerPersonId: row.attempt_owner_person_id,
    rewardWeight: Number(row.reward_weight),
    policyVersion: row.policy_version,
    publishedAt: row.published_at,
  });
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 240 || /[\0\r\n]/.test(value)) {
    throw new VerificationMarketValidationError(`${label} must be a bounded identifier.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new VerificationMarketValidationError(`${label} must be sha256:<hex>.`);
  }
}

function requireUtcInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new VerificationMarketValidationError(`${label} must be an ISO-8601 UTC instant.`);
  }
}
