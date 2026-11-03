import { canonicalJson, sha256Canonical } from "../../packages/protocol/canonical-json.mjs";
import { projectCreditPoolState } from "../../packages/protocol/credit-market.mjs";
import { derivePoolCreditAllocation } from "../../packages/protocol/pool-credit-allocation.mjs";
import { contributionReceiptHash } from "../../packages/protocol/contribution-receipt.mjs";
import { verificationClaimPolicy } from "../../packages/protocol/verification-market.mjs";
import { D1ContributionReceiptStore } from "../receipts/d1-contribution-receipt-store.mjs";
import { D1VerificationStore } from "../verification/d1-verification-store.mjs";
import { D1VerificationMarketStore } from "../verification/d1-verification-market-store.mjs";
import { D1RunStore } from "../lean-runner/d1-run-store.mjs";
import { normalizeLeanRunnerResult } from "../../packages/protocol/lean-runner.mjs";
import { artifactBundleHash, canonicalArtifactBundle, normalizeArtifactBundle, verifyArtifactBundleAgentSignature } from "../../packages/protocol/artifact-bundle.mjs";
import { assertDelegationAllows, delegationPayloadHash, delegationProtocolVersion, delegationSigningPayload, normalizeDelegationCertificate, verifyDelegationSignature } from "../../packages/domain/delegation.mjs";
import { normalizePoolFinalityAdjudication, poolFinalityHash, trustedPoolFinalityAuthorities, verifyPoolFinalitySignatures } from "../../packages/protocol/pool-finality-adjudication.mjs";

const maximumClosureReceipts = 40;
const eligibleDecisions = new Set(["attested", "rejected", "request_changes", "integrity_flagged"]);

export class PoolSettlementError extends Error {
  constructor(message) { super(message); this.name = "PoolSettlementError"; }
}

/**
 * Operator-invoked pool lock. It re-resolves signed evidence from the DB;
 * no caller supplies beneficiaries, review decisions, or numerical shares.
 * The canonical locked event is the append-only pool allocation ledger.
 * No route, receipt hook, or scheduler invokes this automatically.
 */
export class D1PoolCreditSettlement {
  constructor(database, { now = () => new Date() } = {}) {
    if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function" || typeof now !== "function") throw new TypeError("Pool settlement requires a database and clock.");
    this.database = database;
    this.now = now;
    this.receipts = new D1ContributionReceiptStore(database);
    this.verification = new D1VerificationStore(database);
    this.market = new D1VerificationMarketStore(database);
    this.runs = new D1RunStore(database);
  }

  async preview(poolId, finalReceiptId) {
    const authorityBefore = await this.authoritySnapshot();
    const pool = await this.database.prepare(
      `SELECT pool.id, pool.problem_revision_id, pool.total_credits, pool.policy_version, pool.unit, pool.sponsor_label, pool.created_at,
              revision.target_key
       FROM problem_credit_pools AS pool INNER JOIN problem_revisions AS revision ON revision.id = pool.problem_revision_id
       WHERE pool.id = ?`,
    ).bind(poolId).first();
    if (!pool || pool.policy_version !== "pw-credit-market-v1" || pool.unit !== "non_transferable_research_credit") throw new PoolSettlementError("An eligible pool was not found.");
    const history = await this.poolHistory(poolId);
    if (projectCreditPoolState(history) !== "active") throw new PoolSettlementError("The pool must be active and unlocked.");
    this.assertPoolMetadata(pool, history);

    const closure = await this.loadClosure(finalReceiptId);
    const root = closure.get(finalReceiptId);
    await this.assertFinalTarget(pool, root.receipt);
    const bundleHashes = [...new Set([...closure.values()].map((entry) => entry.receipt.artifactBundleHash))].sort();
    const before = await this.attestationCount(bundleHashes);
    const cutoff = this.now().toISOString();
    const reviews = [];
    const publicReviewRevisions = new Set();
    const verifiedAttestations = [];
    const byBundle = new Map();
    // One Bundle's signed reviews are credited once even when several distinct
    // Receipts in the closure refer to that same immutable Bundle.
    for (const [receiptId, entry] of [...closure].sort(([a], [b]) => (a === finalReceiptId ? -1 : b === finalReceiptId ? 1 : compare(a, b)))) {
      const bundleHash = entry.receipt.artifactBundleHash;
      if (byBundle.has(bundleHash)) continue;
      const attestations = await this.receipts.loadReviewEvidence(bundleHash, { includeOptionalClaims: true });
      byBundle.set(bundleHash, attestations);
      for (const attestation of attestations) {
        if (Date.parse(attestation.attestedAt) > Date.parse(cutoff) || !eligibleDecisions.has(attestation.decision)) continue;
        await this.verifyReviewAttestation(attestation);
        verifiedAttestations.push(Object.freeze({ assignmentId: attestation.assignmentId, attestedAt: attestation.attestedAt }));
        if (verifiedAttestations.length > 100) throw new PoolSettlementError("Review closure exceeds the bounded lock limit.");
        const policy = verificationClaimPolicy(attestation.claimType);
        if (!policy) throw new PoolSettlementError("Completed review uses an unsupported claim.");
        const job = await this.marketJobForAttestation(attestation);
        if (!job || job.pool_id !== poolId) continue;
        publicReviewRevisions.add(job.problem_revision_id);
        reviews.push({
          jobId: job.id, assignmentId: attestation.assignmentId, personId: attestation.verifierPersonId,
          sourceReceiptId: receiptId, attestationId: attestation.id,
          attestationHash: await sha256Canonical(attestation), claimType: attestation.claimType,
          decision: attestation.decision, rewardWeight: policy.rewardWeight,
        });
      }
    }
    const after = await this.attestationCount(bundleHashes);
    if (before !== after) throw new PoolSettlementError("Review evidence changed during the snapshot; retry the preview.");
    const rootReviews = byBundle.get(root.receipt.artifactBundleHash) ?? [];
    // A kernel check and project approval alone do not show that the formal
    // statement matches the pinned mathematical claim.
    const fidelity = rootReviews.filter((item) => item.claimType === "statement_faithful" && Date.parse(item.attestedAt) <= Date.parse(cutoff))
      .sort((a, b) => Date.parse(b.attestedAt) - Date.parse(a.attestedAt) || compare(b.id, a.id))[0];
    if (!fidelity || fidelity.decision !== "attested") throw new PoolSettlementError("Independent statement-fidelity acceptance is required before a final-result allocation.");
    const effective = await this.receipts.loadEffectiveReviewEvidence(root.receipt.artifactBundleHash);
    for (const claim of root.receipt.claims) {
      const latest = effective.get(claim.claimType);
      if (!latest || latest.decision !== "attested" || latest.id !== claim.verificationAttestationId
          || await sha256Canonical(latest) !== claim.verificationAttestationHash) throw new PoolSettlementError("The final Receipt no longer matches current required review evidence.");
    }
    const authorityAfter = await this.authoritySnapshot();
    if (canonicalJson(authorityBefore) !== canonicalJson(authorityAfter)) throw new PoolSettlementError("Signing authority changed during the snapshot; retry the preview.");
    const records = [...closure].map(([id, entry]) => ({ receiptId: id, receiptHash: entry.hash, personId: entry.receipt.beneficiary.personId, attemptOwnerPersonId: entry.receipt.attempt.personId }));
    const plan = await derivePoolCreditAllocation({ poolId, problemRevisionId: pool.problem_revision_id, totalCredits: Number(pool.total_credits), finalReceipt: records.find((item) => item.receiptId === finalReceiptId), dependencies: records.filter((item) => item.receiptId !== finalReceiptId), reviews });
    return Object.freeze({ plan, cutoff, targetDeclaration: root.receipt.target.declaration, lastEvent: history.at(-1), bundleHashes: Object.freeze(bundleHashes), attestationCount: after, receiptIds: Object.freeze([...closure.keys()].sort()), bundleSigners: Object.freeze([...closure.values()].map((entry) => entry.bundleSigner)), publicReviewRevisions: Object.freeze([...publicReviewRevisions].sort()), authoritySnapshot: authorityAfter, verifiedAttestations: Object.freeze(verifiedAttestations) });
  }

  async lock(poolId, finalReceiptId, { expectedPlanHash, finalityAdjudication } = {}) {
    if (typeof expectedPlanHash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(expectedPlanHash)) throw new PoolSettlementError("The reviewed allocation plan hash is required.");
    if (!finalityAdjudication || trustedPoolFinalityAuthorities.length === 0) throw new PoolSettlementError("Independent target-completion and contribution-attribution adjudication is required; settlement is disabled.");
    await this.#requireArtifactByteVerification();
    const existing = await this.readLocked(poolId);
    if (existing) {
      if (existing.allocation.finalReceipt.receiptId !== finalReceiptId) throw new PoolSettlementError("The pool is already locked to a different final Receipt.");
      if (existing.allocation.payloadHash !== expectedPlanHash) throw new PoolSettlementError("The pool is already locked to a different reviewed plan.");
      return Object.freeze({ ...existing, created: false });
    }
    const prepared = await this.preview(poolId, finalReceiptId);
    if (prepared.plan.payloadHash !== expectedPlanHash) throw new PoolSettlementError("The allocation differs from the reviewed plan; preview and review again.");
    const finality = await this.#verifyFinalityAdjudication(finalityAdjudication, prepared.plan, prepared.cutoff);
    const sequence = prepared.lastEvent.sequence + 1;
    const payload = { protocolVersion: "pw-credit-pool-event-v1", poolId, sequence, eventType: "locked", occurredAt: prepared.cutoff, allocation: prepared.plan, finalityAdjudication: finality.adjudication };
    const hash = await sha256Canonical(payload);
    const result = await this.database.prepare(
      `INSERT INTO problem_credit_pool_events (id, pool_id, sequence, event_type, payload_hash, canonical_payload, occurred_at)
       SELECT ?, ?, ?, 'locked', ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM problem_credit_pool_events WHERE pool_id = ? AND sequence = ? AND payload_hash = ? AND event_type = 'activated')
         AND NOT EXISTS (SELECT 1 FROM problem_credit_pool_events WHERE pool_id = ? AND sequence > ?)
         AND (SELECT COUNT(*) FROM verification_attestations WHERE artifact_bundle_manifest_hash IN (SELECT value FROM json_each(?))) = ?
         AND (SELECT COUNT(*) FROM delegation_revocations) = ?
         AND (SELECT COUNT(*) FROM person_key_revocations) = ?
         AND (SELECT COUNT(*) FROM contribution_receipt_issuer_key_events) = ?
         AND (SELECT COUNT(*) FROM agents WHERE status = 'revoked') = ?
         AND (SELECT COUNT(*) FROM person_keys WHERE revoked_at IS NOT NULL) = ?
         AND (SELECT COUNT(*) FROM verification_market_jobs) = ?
         AND (SELECT COUNT(*) FROM verification_market_job_claims) = ?
         AND (SELECT COUNT(*) FROM verification_assignments WHERE status = 'completed') = ?
         AND (SELECT COUNT(*) FROM runner_keys WHERE status = 'active' AND revoked_at IS NULL) = ?
         AND COALESCE((SELECT GROUP_CONCAT(encoded, '|') FROM (SELECT hex(id) || ':' || hex(public_key) || ':' || hex(fingerprint) AS encoded FROM runner_keys WHERE status = 'active' AND revoked_at IS NULL ORDER BY id)), '') = ?
         AND (SELECT COUNT(DISTINCT qualified_name) FROM declarations WHERE problem_revision_id = ? AND is_primary = 1) = 1
         AND EXISTS (SELECT 1 FROM declarations WHERE problem_revision_id = ? AND is_primary = 1 AND qualified_name = ?)
         AND EXISTS (SELECT 1 FROM problem_revisions WHERE id = ? AND project_id = ?)
         AND NOT EXISTS (SELECT 1 FROM json_each(?) AS item WHERE NOT EXISTS (
           SELECT 1 FROM verification_assignments WHERE id = json_extract(item.value, '$.assignmentId') AND status = 'completed' AND completed_at = json_extract(item.value, '$.attestedAt')
         ))
         AND NOT EXISTS (SELECT 1 FROM json_each(?) AS item WHERE NOT EXISTS (
           SELECT 1 FROM agents AS agent INNER JOIN delegation_certificates AS certificate ON certificate.id = json_extract(item.value, '$.certificateId')
           INNER JOIN person_keys AS signer ON signer.id = certificate.person_key_id
           WHERE agent.id = json_extract(item.value, '$.agentId') AND agent.public_key = json_extract(item.value, '$.publicKey') AND agent.owner_person_id = json_extract(item.value, '$.personId')
             AND signer.id = json_extract(item.value, '$.signerKeyId') AND signer.public_key = json_extract(item.value, '$.signerPublicKey')
         ))
         AND NOT EXISTS (SELECT 1 FROM json_each(?) AS item WHERE NOT EXISTS (
           SELECT 1 FROM person_keys AS signer WHERE signer.id = json_extract(item.value, '$.id') AND signer.person_id = json_extract(item.value, '$.personId')
             AND signer.public_key = json_extract(item.value, '$.publicKey') AND signer.fingerprint = json_extract(item.value, '$.fingerprint') AND signer.revoked_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM person_key_revocations AS revoked WHERE revoked.person_key_id = signer.id)
         ))
         AND NOT EXISTS (SELECT 1 FROM json_each(?) AS item WHERE NOT EXISTS (
           SELECT 1 FROM problem_revisions AS revision INNER JOIN projects AS project ON project.id = revision.project_id
           INNER JOIN source_snapshots AS snapshot ON snapshot.id = revision.source_snapshot_id
           WHERE revision.id = item.value AND project.visibility = 'public'
             AND EXISTS (SELECT 1 FROM declarations WHERE problem_revision_id = revision.id AND is_primary = 1)
             AND EXISTS (SELECT 1 FROM verification_claims WHERE problem_revision_id = revision.id)
         ))
         AND NOT EXISTS (SELECT 1 FROM contribution_receipt_lifecycle_events WHERE receipt_id IN (SELECT value FROM json_each(?)) AND event_type IN ('retracted','superseded'))`,
    ).bind(`pool-event:${poolId}:locked`, poolId, sequence, hash, canonicalJson(payload), prepared.cutoff,
      poolId, prepared.lastEvent.sequence, prepared.lastEvent.payloadHash, poolId, prepared.lastEvent.sequence,
      JSON.stringify(prepared.bundleHashes), prepared.attestationCount, ...prepared.authoritySnapshot,
      prepared.plan.problemRevisionId, prepared.plan.problemRevisionId, prepared.targetDeclaration,
      prepared.plan.problemRevisionId, finality.projectId,
      JSON.stringify(prepared.verifiedAttestations), JSON.stringify(prepared.bundleSigners), JSON.stringify(finality.signers), JSON.stringify(prepared.publicReviewRevisions), JSON.stringify(prepared.receiptIds)).run();
    if (Number(result?.meta?.changes ?? 0) !== 1) throw new PoolSettlementError("Pool or evidence changed before the lock; no allocation was written.");
    return Object.freeze({ ...await this.readLocked(poolId), created: true });
  }

  async readLocked(poolId) {
    const history = await this.poolHistory(poolId);
    const locked = history.find((event) => event.eventType === "locked");
    if (!locked) return null;
    if (!locked.allocation) throw new PoolSettlementError("The existing pool lock does not contain a compatible allocation.");
    const stored = locked.allocation;
    const calculated = await derivePoolCreditAllocation(stored);
    if (canonicalJson(calculated) !== canonicalJson(stored) || stored.poolId !== poolId) throw new PoolSettlementError("The stored pool allocation is invalid.");
    const finality = await this.#verifyFinalityAdjudication(locked.finalityAdjudication, stored, locked.occurredAt);
    await this.#requireArtifactByteVerification();
    await this.verifyLockedEvidence(stored, locked.occurredAt, history);
    return Object.freeze({ state: projectCreditPoolState(history), lockedAt: locked.occurredAt, eventHash: locked.payloadHash, finalityHash: finality.hash, allocation: stored });
  }

  async verifyLockedEvidence(plan, cutoff, history) {
    const pool = await this.database.prepare(
      `SELECT pool.id, pool.problem_revision_id, pool.total_credits, pool.policy_version, pool.unit, pool.sponsor_label, pool.created_at, revision.target_key
       FROM problem_credit_pools AS pool INNER JOIN problem_revisions AS revision ON revision.id = pool.problem_revision_id WHERE pool.id = ?`,
    ).bind(plan.poolId).first();
    if (!pool || pool.problem_revision_id !== plan.problemRevisionId || Number(pool.total_credits) !== plan.totalCredits
        || pool.policy_version !== "pw-credit-market-v1" || pool.unit !== "non_transferable_research_credit") throw new PoolSettlementError("Stored allocation does not match the pool.");
    this.assertPoolMetadata(pool, history);
    const closure = await this.loadClosure(plan.finalReceipt.receiptId);
    const actual = [...closure].map(([id, entry]) => ({ receiptId: id, receiptHash: entry.hash, personId: entry.receipt.beneficiary.personId, attemptOwnerPersonId: entry.receipt.attempt.personId })).sort((a, b) => compare(a.receiptId, b.receiptId));
    const expected = [plan.finalReceipt, ...plan.dependencies].sort((a, b) => compare(a.receiptId, b.receiptId));
    if (canonicalJson(actual) !== canonicalJson(expected)) throw new PoolSettlementError("Stored allocation no longer matches its Receipt closure.");
    const root = closure.get(plan.finalReceipt.receiptId).receipt;
    await this.assertFinalTarget(pool, root);
    const evidenceById = new Map();
    for (const { receipt } of closure.values()) {
      for (const attestation of await this.receipts.loadReviewEvidence(receipt.artifactBundleHash, { includeOptionalClaims: true })) {
        evidenceById.set(attestation.id, attestation);
      }
    }
    for (const item of plan.reviews) {
      const attestation = evidenceById.get(item.attestationId);
      const source = closure.get(item.sourceReceiptId)?.receipt;
      if (!attestation || !source || attestation.artifactBundleHash !== source.artifactBundleHash
          || attestation.assignmentId !== item.assignmentId || attestation.verifierPersonId !== item.personId
          || attestation.claimType !== item.claimType || attestation.decision !== item.decision
          || Date.parse(attestation.attestedAt) > Date.parse(cutoff)
          || await sha256Canonical(attestation) !== item.attestationHash) throw new PoolSettlementError("Stored allocation review evidence does not match its frozen assignment.");
      await this.verifyReviewAttestation(attestation);
      const job = await this.marketJobForAttestation(attestation);
      if (!job || job.id !== item.jobId || job.pool_id !== plan.poolId) throw new PoolSettlementError("A frozen review is not bound to this pool's public market job.");
    }
    for (const claim of root.claims) {
      const attestation = evidenceById.get(claim.verificationAttestationId);
      if (!attestation || attestation.decision !== "attested" || Date.parse(attestation.attestedAt) > Date.parse(cutoff)
          || await sha256Canonical(attestation) !== claim.verificationAttestationHash) throw new PoolSettlementError("Frozen allocation lacks required final Receipt review evidence.");
      await this.verifyReviewAttestation(attestation);
    }
    const fidelity = [...evidenceById.values()].filter((item) => item.artifactBundleHash === root.artifactBundleHash && item.claimType === "statement_faithful" && Date.parse(item.attestedAt) <= Date.parse(cutoff))
      .sort((a, b) => Date.parse(b.attestedAt) - Date.parse(a.attestedAt) || compare(b.id, a.id))[0];
    if (!fidelity || fidelity.decision !== "attested") throw new PoolSettlementError("Frozen allocation lacks independent statement-fidelity acceptance.");
    await this.verifyReviewAttestation(fidelity);
  }

  async loadClosure(finalReceiptId) {
    const found = new Map();
    const visiting = new Set();
    const visit = async (id, expectedHash = null) => {
      if (visiting.has(id)) throw new PoolSettlementError("Receipt dependency closure contains a cycle.");
      if (found.has(id)) {
        if (expectedHash && found.get(id).hash !== expectedHash) throw new PoolSettlementError("A dependency Receipt hash conflicts.");
        return;
      }
      if (found.size + visiting.size >= maximumClosureReceipts) throw new PoolSettlementError("Receipt dependency closure exceeds the bounded lock limit.");
      visiting.add(id);
      const receipt = await this.receipts.loadVerifiedReceipt(id);
      const hash = await contributionReceiptHash(receipt);
      if (expectedHash && hash !== expectedHash) throw new PoolSettlementError("A dependency Receipt hash does not match.");
      const publication = await this.database.prepare("SELECT record_class, visibility FROM contribution_receipt_publications WHERE receipt_id = ?").bind(id).first();
      if (publication?.record_class !== "research" || publication?.visibility !== "public") throw new PoolSettlementError("Every Receipt in the closure must be public research.");
      const terminal = await this.database.prepare("SELECT id FROM contribution_receipt_lifecycle_events WHERE receipt_id = ? AND event_type IN ('retracted','superseded') LIMIT 1").bind(id).first();
      if (terminal) throw new PoolSettlementError("The closure includes a retracted or superseded Receipt.");
      await this.verifyRun(receipt.run.id, receipt.run.resultHash, receipt.run.requestHash, receipt.attempt.id, receipt.artifactBundleHash);
      const bundleSigner = await this.verifyBundle(receipt);
      for (const dependency of receipt.bundle.dependencyReceipts) await visit(dependency.receiptId, dependency.receiptHash);
      visiting.delete(id);
      found.set(id, Object.freeze({ receipt, hash, bundleSigner }));
    };
    await visit(finalReceiptId);
    return found;
  }

  async poolHistory(poolId) {
    const rows = await this.database.prepare("SELECT sequence, event_type, payload_hash, canonical_payload, occurred_at FROM problem_credit_pool_events WHERE pool_id = ? ORDER BY sequence").bind(poolId).all();
    const events = [];
    for (const row of rows.results ?? []) {
      let payload;
      try { payload = JSON.parse(row.canonical_payload); } catch { throw new PoolSettlementError("Pool event payload is invalid."); }
      if (canonicalJson(payload) !== row.canonical_payload || await sha256Canonical(payload) !== row.payload_hash || payload.poolId !== poolId
          || payload.sequence !== row.sequence || payload.eventType !== row.event_type || payload.occurredAt !== row.occurred_at) throw new PoolSettlementError("Pool event failed integrity checks.");
      events.push(Object.freeze({ ...payload, payloadHash: row.payload_hash }));
    }
    if (!events.length) throw new PoolSettlementError("Pool history is missing.");
    return events;
  }

  async attestationCount(bundleHashes) {
    const marks = bundleHashes.map(() => "?").join(",");
    return Number(await this.database.prepare(`SELECT COUNT(*) AS count FROM verification_attestations WHERE artifact_bundle_manifest_hash IN (${marks})`).bind(...bundleHashes).first("count"));
  }

  async assertFinalTarget(pool, receipt) {
    if (receipt.kind === "verification" || receipt.attempt.problemRevisionId !== pool.problem_revision_id) throw new PoolSettlementError("The final Receipt does not bind the pool revision.");
    const rows = await this.database.prepare("SELECT DISTINCT qualified_name FROM declarations WHERE problem_revision_id = ? AND is_primary = 1 ORDER BY qualified_name").bind(pool.problem_revision_id).all();
    const names = (rows.results ?? []).map((row) => row.qualified_name);
    if (names.length !== 1 || names[0] !== receipt.target.declaration) throw new PoolSettlementError("The final Receipt must bind the pool's unique primary declaration.");
  }

  assertPoolMetadata(pool, history) {
    const created = history[0];
    if (!created || created.protocolVersion !== "pw-credit-pool-event-v1" || created.eventType !== "created"
        || created.problemRevisionId !== pool.problem_revision_id || created.policyVersion !== pool.policy_version
        || created.unit !== pool.unit || created.totalCredits !== Number(pool.total_credits)
        || created.sponsorLabel !== pool.sponsor_label || created.occurredAt !== pool.created_at) throw new PoolSettlementError("Pool creation evidence does not match the immutable budget.");
  }

  async authoritySnapshot() {
    const row = await this.database.prepare(`SELECT
      (SELECT COUNT(*) FROM delegation_revocations) AS delegation_count,
      (SELECT COUNT(*) FROM person_key_revocations) AS person_key_count,
      (SELECT COUNT(*) FROM contribution_receipt_issuer_key_events) AS issuer_count,
      (SELECT COUNT(*) FROM agents WHERE status = 'revoked') AS agent_count,
      (SELECT COUNT(*) FROM person_keys WHERE revoked_at IS NOT NULL) AS legacy_key_count,
      (SELECT COUNT(*) FROM verification_market_jobs) AS market_job_count,
      (SELECT COUNT(*) FROM verification_market_job_claims) AS market_claim_count,
      (SELECT COUNT(*) FROM verification_assignments WHERE status = 'completed') AS completed_assignment_count,
      (SELECT COUNT(*) FROM runner_keys WHERE status = 'active' AND revoked_at IS NULL) AS runner_key_count,
      COALESCE((SELECT GROUP_CONCAT(encoded, '|') FROM (SELECT hex(id) || ':' || hex(public_key) || ':' || hex(fingerprint) AS encoded FROM runner_keys WHERE status = 'active' AND revoked_at IS NULL ORDER BY id)), '') AS runner_keys`).first();
    return Object.freeze([...[row.delegation_count, row.person_key_count, row.issuer_count, row.agent_count, row.legacy_key_count, row.market_job_count, row.market_claim_count, row.completed_assignment_count, row.runner_key_count].map(Number), row.runner_keys]);
  }

  async marketJobForAttestation(attestation) {
    const row = await this.database.prepare(
      `SELECT job.id, job.problem_revision_id, job.pool_id, job.claim_type, job.reward_weight, job.policy_version, job.published_at,
              job.artifact_bundle_manifest_hash, claim.verifier_person_id, claim.claimed_at
       FROM verification_market_job_claims AS claim
       INNER JOIN verification_market_jobs AS job ON job.id = claim.job_id
       WHERE claim.assignment_id = ?`,
    ).bind(attestation.assignmentId).first();
    if (!row) return null;
    if (!await this.market.hasInspectablePublicTarget(row.problem_revision_id)) return null;
    const policy = verificationClaimPolicy(attestation.claimType);
    if (!policy || row.claim_type !== attestation.claimType || Number(row.reward_weight) !== policy.rewardWeight
        || row.policy_version !== "pw-verification-market-v1" || row.artifact_bundle_manifest_hash !== attestation.artifactBundleHash
        || row.verifier_person_id !== attestation.verifierPersonId || !Number.isFinite(Date.parse(row.claimed_at))
        || Date.parse(row.claimed_at) > Date.parse(attestation.attestedAt)) throw new PoolSettlementError("Market job does not match its signed review.");
    const jobHash = await sha256Canonical({ protocolVersion: "pw-verification-market-v1", poolId: row.pool_id, artifactBundleManifestHash: row.artifact_bundle_manifest_hash, claimType: row.claim_type });
    if (row.id !== `verification-job:${jobHash.slice("sha256:".length)}`) throw new PoolSettlementError("Market job identity is not canonical.");
    const expectedEvents = [
      { protocolVersion: "pw-verification-market-job-event-v1", jobId: row.id, sequence: 1, eventType: "published", occurredAt: row.published_at, poolId: row.pool_id, artifactBundleManifestHash: row.artifact_bundle_manifest_hash, claimType: row.claim_type, rewardWeight: Number(row.reward_weight) },
      { protocolVersion: "pw-verification-market-job-event-v1", jobId: row.id, sequence: 2, eventType: "claimed", occurredAt: row.claimed_at, assignmentId: attestation.assignmentId, verifierPersonId: row.verifier_person_id },
    ];
    for (const expected of expectedEvents) {
      const event = await this.database.prepare("SELECT event_type, payload_hash, canonical_payload, occurred_at FROM verification_market_job_events WHERE job_id = ? AND sequence = ?").bind(row.id, expected.sequence).first();
      if (!event || event.event_type !== expected.eventType || event.occurred_at !== expected.occurredAt
          || event.canonical_payload !== canonicalJson(expected) || event.payload_hash !== await sha256Canonical(expected)) throw new PoolSettlementError("Market job lacks canonical published and claimed events.");
    }
    return row;
  }

  async verifyReviewAttestation(attestation) {
    const evidence = await this.database.prepare("SELECT content_hash FROM artifact_objects WHERE content_hash = ?").bind(attestation.evidenceHash).first();
    if (!evidence) throw new PoolSettlementError("A completed review has no indexed evidence.");
    const assignment = await this.verification.requireAssignment(attestation.assignmentId);
    await this.verification.assertCanonicalCompletedHistory(assignment, attestation);
    if (["bundle_reproducible", "kernel_accepted"].includes(attestation.claimType) && attestation.decision === "attested") {
      await this.verification.assertFreshReplayEvidence(assignment, attestation);
      const replay = await this.database.prepare("SELECT run_id, runner_result_hash FROM verification_replay_evidence WHERE assignment_id = ? AND evidence_hash = ?").bind(assignment.id, attestation.evidenceHash).first();
      if (!replay) throw new PoolSettlementError("Verified replay result is missing.");
      await this.verifyRun(replay.run_id, replay.runner_result_hash);
    }
  }

  async verifyRun(runId, expectedHash, expectedRequestHash = null, expectedAttemptId = null, expectedBundleHash = null) {
    const row = await this.database.prepare(
      `SELECT run.state, run.attempt_id, run.artifact_bundle_hash, run.request_hash, run.runner_result_hash, result.result_hash, result.canonical_result
       FROM runs AS run INNER JOIN run_results AS result ON result.run_id = run.id WHERE run.id = ?`,
    ).bind(runId).first();
    if (!row) throw new PoolSettlementError("Signed Runner result is missing.");
    let result;
    try { result = normalizeLeanRunnerResult(JSON.parse(row.canonical_result)); } catch { throw new PoolSettlementError("Signed Runner result is malformed."); }
    if (canonicalJson(result) !== row.canonical_result || await sha256Canonical(result) !== row.result_hash
        || row.result_hash !== row.runner_result_hash || row.result_hash !== expectedHash || result.jobId !== runId
        || result.attemptId !== row.attempt_id || result.artifacts.manifestHash !== row.artifact_bundle_hash
        || (expectedAttemptId && row.attempt_id !== expectedAttemptId)
        || (expectedBundleHash && row.artifact_bundle_hash !== expectedBundleHash)
        || result.requestHash !== row.request_hash || (expectedRequestHash && row.request_hash !== expectedRequestHash)
        || row.state !== "succeeded" || result.status !== "succeeded" || result.kernelStatus !== "accepted"
        || Object.values(result.checks).some((check) => check !== "passed")) throw new PoolSettlementError("Signed Runner result does not match accepted immutable evidence.");
    await this.runs.assertTrustedRunnerSignature(result);
    await this.runs.assertStoredOutputArtifacts(runId, result);
  }

  async verifyBundle(receipt) {
    const row = await this.database.prepare(
      `SELECT bundle.canonical_manifest, bundle.attempt_id, bundle.problem_revision_id,
              attempt.agent_id AS attempt_agent_id, attempt.person_id AS attempt_person_id, attempt.delegation_scope,
              agent.public_key, agent.owner_person_id, agent.key_fingerprint, agent.created_at AS agent_created_at, agent.status AS agent_status, agent.revoked_at AS agent_revoked_at,
              certificate.id AS certificate_id, certificate.owner_person_id AS certificate_owner, certificate.agent_id AS certificate_agent,
              certificate.agent_public_key, certificate.scopes_json, certificate.valid_from, certificate.valid_until,
              certificate.beneficiary_person_id, certificate.protocol_version, certificate.canonical_payload, certificate.payload_hash, certificate.person_signature,
              signer.id AS signer_id, signer.person_id AS signer_person_id, signer.public_key AS signer_public_key, signer.fingerprint AS signer_fingerprint, signer.algorithm AS signer_algorithm,
              signer.revoked_at AS legacy_revoked_at, key_revocation.revoked_at AS key_revoked_at, revocation.revoked_at AS delegation_revoked_at
       FROM artifact_bundles AS bundle INNER JOIN agent_attempts AS attempt ON attempt.id = bundle.attempt_id
       INNER JOIN agents AS agent ON agent.id = attempt.agent_id
       INNER JOIN delegation_certificates AS certificate ON certificate.id = ?
       INNER JOIN person_keys AS signer ON signer.id = certificate.person_key_id
       LEFT JOIN person_key_revocations AS key_revocation ON key_revocation.person_key_id = signer.id
       LEFT JOIN delegation_revocations AS revocation ON revocation.delegation_certificate_id = certificate.id
       WHERE bundle.manifest_hash = ?`,
    ).bind(receipt.attempt.delegationCertificateId, receipt.artifactBundleHash).first();
    if (!row) throw new PoolSettlementError("Signed Artifact Bundle is missing.");
    let bundle;
    try { bundle = normalizeArtifactBundle(JSON.parse(row.canonical_manifest)); } catch { throw new PoolSettlementError("Signed Artifact Bundle is malformed."); }
    if (canonicalArtifactBundle(bundle) !== row.canonical_manifest || await artifactBundleHash(bundle) !== receipt.artifactBundleHash
        || !await verifyArtifactBundleAgentSignature(bundle) || bundle.agentEvent.agentPublicKey !== row.public_key
        || row.owner_person_id !== receipt.attempt.personId || row.attempt_person_id !== receipt.attempt.personId
        || row.attempt_agent_id !== receipt.attempt.agentId || row.attempt_id !== receipt.attempt.id
        || row.problem_revision_id !== receipt.attempt.problemRevisionId || bundle.attemptId !== receipt.attempt.id
        || bundle.problemRevisionId !== receipt.attempt.problemRevisionId
        || canonicalJson(bundle.target) !== canonicalJson(receipt.target)
        || canonicalJson(bundle.dependencyReceipts) !== canonicalJson(receipt.bundle.dependencyReceipts)) throw new PoolSettlementError("Signed Artifact Bundle does not match its Receipt.");
    try {
      const scopes = JSON.parse(row.scopes_json);
      const certificate = normalizeDelegationCertificate({ id: row.certificate_id, ownerPersonId: row.certificate_owner, agentId: row.certificate_agent, agentPublicKey: row.agent_public_key, scopes, validFrom: row.valid_from, validUntil: row.valid_until, attributionPolicy: { beneficiaryPersonId: row.beneficiary_person_id, mode: "agent_delegated" } });
      const fingerprints = await Promise.all([row.public_key, row.signer_public_key].map((publicKey) => sha256Canonical({ algorithm: "ed25519", public_key: publicKey })));
      const eventTime = Date.parse(bundle.agentEvent.occurredAt);
      const agentCreatedAt = Date.parse(row.agent_created_at.includes("T") ? row.agent_created_at : `${row.agent_created_at.replace(" ", "T")}Z`);
      const agentRevokedAt = row.agent_revoked_at === null ? null : Date.parse(row.agent_revoked_at);
      if (row.certificate_owner !== receipt.attempt.personId || row.certificate_agent !== receipt.attempt.agentId || row.agent_public_key !== row.public_key
          || row.beneficiary_person_id !== receipt.attempt.personId || row.signer_person_id !== receipt.attempt.personId || row.signer_algorithm !== "ed25519"
          || row.key_fingerprint !== fingerprints[0] || row.signer_fingerprint !== fingerprints[1]
          || !["active", "revoked"].includes(row.agent_status) || !Number.isFinite(agentCreatedAt) || agentCreatedAt > eventTime
          || (row.agent_status === "revoked" && agentRevokedAt === null) || (agentRevokedAt !== null && (!Number.isFinite(agentRevokedAt) || eventTime >= agentRevokedAt))
          || row.protocol_version !== delegationProtocolVersion || row.canonical_payload !== canonicalJson(delegationSigningPayload(certificate))
          || row.payload_hash !== await delegationPayloadHash(certificate)
          || !await verifyDelegationSignature({ certificate, personPublicKey: row.signer_public_key, personSignature: row.person_signature })) throw new Error("invalid authority");
      const revocations = [row.legacy_revoked_at, row.key_revoked_at, row.delegation_revoked_at].filter((value) => value !== null && value !== undefined);
      if (revocations.some((value) => !Number.isFinite(Date.parse(value)))) throw new Error("invalid revocation");
      const revokedAt = revocations.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
      assertDelegationAllows(certificate, row.delegation_scope, bundle.agentEvent.occurredAt, revokedAt);
    } catch { throw new PoolSettlementError("Artifact Bundle lacks valid signed owner delegation."); }
    return Object.freeze({ agentId: receipt.attempt.agentId, personId: row.owner_person_id, publicKey: row.public_key, certificateId: row.certificate_id, signerKeyId: row.signer_id, signerPublicKey: row.signer_public_key });
  }

  async #verifyFinalityAdjudication(value, plan, cutoff) {
    return verifyPoolFinalityEvidence({ database: this.database, receipts: this.receipts, verifyReviewAttestation: (attestation) => this.verifyReviewAttestation(attestation), authorities: trustedPoolFinalityAuthorities, value, plan, cutoff });
  }

  async #requireArtifactByteVerification() {
    // An artifact_objects row proves only that a hash is indexed. It does not
    // establish that the object exists, or that its bytes hash to that value.
    // Never commit or present an allocation as final until a real trusted
    // object-store reader verifies every required evidence object.
    throw new PoolSettlementError("Artifact object bytes have not been verified; settlement is disabled.");
  }
}


/** Verify explicit, project-pinned finality evidence without writing. The
 * production settlement method always supplies its compiled trust registry. */
export async function verifyPoolFinalityEvidence({ database, receipts, verifyReviewAttestation, authorities, value, plan, cutoff }) {
  if (!value || authorities.length === 0) throw new PoolSettlementError("Independent target-completion and contribution-attribution adjudication is required; settlement is disabled.");
  let adjudication;
  try { adjudication = normalizePoolFinalityAdjudication(value); } catch { throw new PoolSettlementError("Finality adjudication is malformed."); }
  const payload = adjudication.payload;
  const root = await receipts.loadVerifiedReceipt(plan.finalReceipt.receiptId);
  const revision = await database.prepare("SELECT project_id FROM problem_revisions WHERE id = ?").bind(plan.problemRevisionId).first();
  if (!revision || payload.poolId !== plan.poolId || payload.problemRevisionId !== plan.problemRevisionId
      || payload.finalReceiptId !== plan.finalReceipt.receiptId || payload.finalReceiptHash !== plan.finalReceipt.receiptHash
      || payload.beneficiaryPersonId !== plan.finalReceipt.personId || payload.targetDeclaration !== root.target.declaration
      || payload.targetStatementHash !== root.target.statementHash || payload.reviewerPersonId === root.attempt.personId
      || Date.parse(payload.issuedAt) > Date.parse(cutoff)) throw new PoolSettlementError("Finality adjudication does not match the frozen target and beneficiary.");
  const keys = [];
  for (const [id, personId] of [[payload.reviewerKeyId, payload.reviewerPersonId], [payload.ownerKeyId, payload.ownerPersonId]]) {
    const key = await database.prepare(`SELECT signer.id, signer.person_id, signer.public_key, signer.fingerprint, signer.algorithm, signer.created_at, signer.revoked_at,
      revoked.revoked_at AS event_revoked_at FROM person_keys AS signer LEFT JOIN person_key_revocations AS revoked ON revoked.person_key_id = signer.id WHERE signer.id = ?`).bind(id).first();
    const createdAt = key?.created_at?.includes("T") ? key.created_at : key?.created_at ? `${key.created_at.replace(" ", "T")}Z` : "";
    if (!key || key.person_id !== personId || key.algorithm !== "ed25519" || key.revoked_at || key.event_revoked_at
        || !Number.isFinite(Date.parse(createdAt)) || Date.parse(createdAt) > Date.parse(payload.issuedAt)
        || key.fingerprint !== await sha256Canonical({ algorithm: "ed25519", public_key: key.public_key })) throw new PoolSettlementError("A finality signer is not an active verified Person key.");
    keys.push(Object.freeze({ id: key.id, personId, publicKey: key.public_key, fingerprint: key.fingerprint }));
  }
  if (!authorities.some((authority) => authority.projectId === revision.project_id && authority.personId === payload.ownerPersonId
      && authority.keyId === payload.ownerKeyId && authority.keyFingerprint === keys[1].fingerprint)) throw new PoolSettlementError("The finality signer is not the enrolled project owner.");
  if (!await verifyPoolFinalitySignatures(adjudication, { reviewerPublicKey: keys[0].publicKey, ownerPublicKey: keys[1].publicKey })) throw new PoolSettlementError("Finality adjudication signatures are invalid.");
  const reviews = await receipts.loadReviewEvidence(root.artifactBundleHash, { includeOptionalClaims: true });
  for (const [id, claimType, evidenceHash, attestationHash] of [
    [payload.reviewAttestationId, "statement_faithful", payload.reviewEvidenceHash, payload.reviewAttestationHash],
    [payload.noveltyAttestationId, "novelty_reviewed", payload.noveltyEvidenceHash, payload.noveltyAttestationHash],
  ]) {
    const attestation = reviews.find((item) => item.id === id);
    const latest = reviews.filter((item) => item.claimType === claimType && Date.parse(item.attestedAt) <= Date.parse(cutoff))
      .sort((a, b) => Date.parse(b.attestedAt) - Date.parse(a.attestedAt) || compare(b.id, a.id))[0];
    if (!attestation || attestation.claimType !== claimType || attestation.decision !== "attested"
        || attestation.verifierPersonId === root.attempt.personId || attestation.verifierPersonId === payload.ownerPersonId
        || (claimType === "statement_faithful" && attestation.verifierPersonId !== payload.reviewerPersonId)
        || attestation.evidenceHash !== evidenceHash || await sha256Canonical(attestation) !== attestationHash
        || Date.parse(attestation.attestedAt) > Date.parse(payload.issuedAt) || latest?.id !== attestation.id) throw new PoolSettlementError("Finality requires the latest named independent statement and novelty review evidence.");
    await verifyReviewAttestation(attestation);
  }
  return Object.freeze({ adjudication, hash: await poolFinalityHash(adjudication), projectId: revision.project_id, signers: Object.freeze(keys) });
}

function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
