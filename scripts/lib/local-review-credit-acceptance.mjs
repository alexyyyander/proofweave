import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson, sha256Canonical } from '../../packages/protocol/canonical-json.mjs';
import { contributionReceiptRequiredClaimTypes, verifyContributionReceiptSignature } from '../../packages/protocol/contribution-receipt.mjs';
import { D1ContributionReceiptStore } from '../../services/receipts/d1-contribution-receipt-store.mjs';
import { D1ReceiptCreditSettlement } from '../../services/credits/d1-receipt-credit-settlement.mjs';
import { deriveReceiptCreditSettlement } from '../../packages/protocol/receipt-credit.mjs';

/** This driver only operates on an explicitly synthetic, isolated loopback server. */
export function assertLocalReviewAcceptanceContext({ origin, syntheticOwner, ownerPersonId, reviewerPersonId }) {
  const url = new URL(origin);
  assert.ok(['http:', 'https:'].includes(url.protocol), 'Local acceptance requires loopback HTTP or HTTPS');
  assert.ok(['127.0.0.1', '[::1]'].includes(url.hostname), 'Remote origins are forbidden');
  assert.equal(url.username + url.password + url.search + url.hash, '', 'Origin must not carry credentials or query data');
  assert.equal(url.pathname, '/', 'Pass an origin, not a route');
  assert.equal(syntheticOwner, true, 'Synthetic test ownership must be explicitly declared');
  assert.ok(typeof ownerPersonId === 'string' && ownerPersonId.startsWith('person:'), 'Owner Person is required');
  assert.ok(typeof reviewerPersonId === 'string' && reviewerPersonId.startsWith('person:'), 'Reviewer Person is required');
  assert.notEqual(ownerPersonId, reviewerPersonId, 'The protocol must reject same-Person independent review');
  return url.origin;
}

/**
 * Writes go through Person HTTP and the real stdio Connector supplied by the
 * parent driver. D1 is used for final independent reads only: this module never
 * inserts an assignment, Run, attestation, Receipt or credit entry itself.
 *
 * personRequest(path,{method,body,personId}) -> {status,body}
 * callReviewerTool(name,args) -> decoded Connector business JSON; errors throw
 * executeReplay({assignmentId,idempotencyKey,queued}) -> pumps real local Lean
 * confirmPreparedAttestation(draft) -> true only for the exact synthetic draft
 */
export async function runLocalReviewCreditAcceptance(options) {
  const origin = assertLocalReviewAcceptanceContext(options);
  const {
    database, ownerPersonId, reviewerPersonId, bundleHash, reviewJobs,
    projectEvidenceHash, callReviewerTool, personRequest, executeReplay,
    confirmPreparedAttestation, onStage = () => {},
  } = options;
  assert.match(bundleHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(projectEvidenceHash, /^sha256:[a-f0-9]{64}$/);
  for (const fn of [callReviewerTool, personRequest, executeReplay, confirmPreparedAttestation]) assert.equal(typeof fn, 'function');
  assert.equal(typeof database?.prepare, 'function');
  const jobs = contributionReceiptRequiredClaimTypes.map(claimType => {
    const matches = reviewJobs.filter(job => job.claimType === claimType);
    assert.equal(matches.length, 1, `Exactly one published job is required for ${claimType}`);
    return matches[0];
  });
  const authority = await callReviewerTool('get_connection_authority', {});
  assert.equal(authority.personId, reviewerPersonId, 'Connector is bound to another Person');
  assert.ok(authority.oauthScopes.includes('verification:replay'));
  assert.ok(authority.oauthScopes.includes('verification:write'));

  const sameOwner = await personRequest(`/api/me/review-jobs/${encodeURIComponent(jobs[0].id)}/claim`, {method:'POST',personId:ownerPersonId});
  assert.equal(sameOwner.status, 409, 'The author must not claim their own independent review');
  assert.match(sameOwner.body?.error?.message ?? '', /own Attempt/i);
  const claims = [];
  let lastSubmission;
  let lastSubmitInput;
  for (const job of jobs) {
    const claim = requireHttp(await personRequest(`/api/me/review-jobs/${encodeURIComponent(job.id)}/claim`, {method:'POST',personId:reviewerPersonId}), 'claim');
    const assignmentId = claim.claim?.assignment?.id;
    assert.ok(assignmentId, 'Person claim must return its actual assignment');
    let detail = await callReviewerTool('get_review_assignment', {assignmentId});
    if (detail.assignment.status === 'assigned') {
      requireHttp(await personRequest(`/api/me/review-assignments/${encodeURIComponent(assignmentId)}/accept`, {method:'POST',personId:reviewerPersonId}), 'accept');
      detail = await callReviewerTool('get_review_assignment', {assignmentId});
    }
    assert.equal(detail.assignment.status, 'accepted');
    assert.equal(detail.assignment.claimType, job.claimType);
    assert.equal(detail.bundle.manifestHash, bundleHash);
    assert.ok(detail.events.some(event => event.eventType === 'assignment_accepted'));
    await onStage({stage:'review_accepted',claimType:job.claimType,assignmentId});

    let evidenceHash = projectEvidenceHash;
    let replayIdempotencyKey;
    let replay;
    if (['bundle_reproducible','kernel_accepted'].includes(job.claimType)) {
      replayIdempotencyKey = `local-review-${randomUUID()}`;
      const queued = await callReviewerTool('request_verification_replay', {assignmentId,idempotencyKey:replayIdempotencyKey});
      await executeReplay({assignmentId,idempotencyKey:replayIdempotencyKey,queued});
      replay = await callReviewerTool('get_verification_replay', {assignmentId,idempotencyKey:replayIdempotencyKey});
      assert.equal(replay.run.state, 'succeeded');
      assert.equal(replay.replay.assignmentId, assignmentId);
      assert.equal(replay.replay.artifactBundleManifestHash, bundleHash);
      assert.equal(replay.replay.requesterPersonId, reviewerPersonId);
      assert.equal(replay.replay.requesterAgentId, authority.agentId);
      assert.equal(replay.replay.delegationCertificateId, authority.delegationCertificateId);
      evidenceHash = replay.replayEvidence?.evidenceHash;
      assert.match(evidenceHash ?? '', /^sha256:[a-f0-9]{64}$/);
      await onStage({stage:'review_replay_completed',claimType:job.claimType,assignmentId,runId:replay.run.id,evidenceHash});
    }
    const prepared = await callReviewerTool('prepare_verification_attestation', {
      assignmentId,artifactBundleHash:bundleHash,claimType:job.claimType,decision:'attested',evidenceHash,
      ...(replayIdempotencyKey ? {replayIdempotencyKey} : {}),
    });
    assert.equal(prepared.submitted, false);
    assert.equal(prepared.attestation.verifierPersonId, reviewerPersonId);
    assert.equal(prepared.attestation.verifierAgentId, authority.agentId);
    assert.equal(prepared.attestation.assignmentId, assignmentId);
    assert.equal(prepared.attestation.artifactBundleHash, bundleHash);
    assert.equal(prepared.attestation.claimType, job.claimType);
    assert.equal(prepared.attestation.evidenceHash, evidenceHash);
    assert.equal(await confirmPreparedAttestation({
      environment:'isolated_test',syntheticOwner:true,claimsRealHumanIndependence:false,
      ...prepared,
    }), true, 'The exact synthetic attestation requires explicit test-driver approval');
    lastSubmitInput = {attestation:prepared.attestation,expectedPayloadHash:prepared.payloadHash,ownerConfirmation:'I_CONFIRM_SUBMIT_VERIFICATION'};
    lastSubmission = await callReviewerTool('submit_prepared_verification_attestation', lastSubmitInput);
    assert.equal(lastSubmission.submitted, true);
    const closure = lastSubmission.receiptClosure;
    if (claims.length < jobs.length - 1) assert.notEqual(closure?.state, 'receipt_issued', 'Receipt was issued before all required claims');
    claims.push({claimType:job.claimType,assignmentId,attestationId:lastSubmission.attestationId,evidenceHash,replayRunId:replay?.run.id ?? null});
  }
  const closure = lastSubmission.receiptClosure;
  assert.equal(closure?.state, 'receipt_issued');
  assert.equal(closure.creditSettlement?.eligible, true, 'Demo/smoke/internal evidence must not be relabelled to force credit');
  const receiptId = closure.receiptId;
  const receipt = await new D1ContributionReceiptStore(database).loadVerifiedReceipt(receiptId);
  assert.equal(await verifyContributionReceiptSignature(receipt), true);
  assert.equal(receipt.beneficiary.personId, ownerPersonId);
  assert.equal(receipt.bundle.manifestHash, bundleHash);
  assert.deepEqual(receipt.claims.map(c => c.claimType).sort(), [...contributionReceiptRequiredClaimTypes].sort());
  assert.ok(receipt.claims.every(c => c.reviewerPersonId === reviewerPersonId));
  assert.equal(receipt.bundle.dependencyReceipts.length, 0, 'This minimal driver has no upstream credit fixture');
  const publicRecord = requireHttp(await personRequest(`/api/receipts/${encodeURIComponent(receiptId)}`, {method:'GET'}), 'public Receipt');
  assert.equal((publicRecord.receipt ?? publicRecord).id, receiptId);
  assert.equal(publicRecord.receiptHash, closure.receiptHash);

  const credit = await readLocalReceiptCredits(database, receiptId);
  assert.equal(credit.settlement.totalUnits, 5);
  assert.equal(credit.entries.length, 5);
  assert.deepEqual(credit.people, {[ownerPersonId]:2,[reviewerPersonId]:3});
  const expectedCredit = await deriveReceiptCreditSettlement({receipt,receiptHash:closure.receiptHash});
  assert.equal(credit.settlement.payloadHash, expectedCredit.payloadHash);
  assert.deepEqual(credit.entries, expectedCredit.entries.map(e => ({person_id:e.personId,category:e.category,units:e.units,reason_key:e.reasonKey,source_receipt_id:e.sourceReceiptId})));
  assert.ok(credit.entries.every(e => e.units === 1 && e.source_receipt_id === receiptId));
  const duplicate = await callReviewerTool('submit_prepared_verification_attestation', lastSubmitInput);
  assert.equal(duplicate.receiptClosure?.receiptId, receiptId);
  assert.equal(duplicate.receiptClosure?.creditSettlement?.created, false);
  assert.deepEqual(await readLocalReceiptCredits(database, receiptId), credit, 'Retry duplicated or changed receipt-backed credit');
  await onStage({stage:'receipt_credit_verified',receiptId,totalUnits:5});
  return {
    environment:'isolated_test',origin,syntheticOwner:true,claimsRealHumanIndependence:false,
    productionAcceptance:false,ownerPersonId,reviewerPersonId,reviewerAgentId:authority.agentId,
    bundleHash,claims,receiptId,receiptHash:closure.receiptHash,signatureVerified:true,
    creditSettlement:credit.settlement,creditEntries:credit.entries,creditByPerson:credit.people,
    duplicateSubmissionAddedCredit:false,sameOwnerClaimRejected:true,
  };
}

export async function readLocalReceiptCredits(database, receiptId) {
  const settlement = await new D1ReceiptCreditSettlement(database).getSettlement(receiptId);
  assert.ok(settlement, 'Receipt must have a durable canonical credit settlement');
  const result = await database.prepare(
    'SELECT person_id, category, units, reason_key, source_receipt_id FROM receipt_credit_entries WHERE receipt_id = ? ORDER BY person_id, category, reason_key',
  ).bind(receiptId).all();
  const entries = result.results ?? [];
  const people = {};
  for (const entry of entries) people[entry.person_id] = (people[entry.person_id] ?? 0) + entry.units;
  return {settlement,entries,people};
}

function requireHttp(response, operation) {
  assert.equal(response?.status, 200, `${operation} HTTP failure: ${response?.body?.error?.code ?? response?.status}`);
  return response.body;
}

/** Seed only catalog/pool metadata into an explicitly isolated test database. */
export async function seedLocalAcceptanceCatalog({ database, ids, target, now = new Date().toISOString(), environment }) {
  assert.equal(environment, 'isolated_test', 'Catalog seed is only for an isolated test database');
  const instant = new Date(now).toISOString();
  for (const name of ['projectId','revisionId','snapshotId','poolId','slug']) assert.ok(typeof ids?.[name] === 'string' && ids[name].length > 0, `Missing ${name}`);
  assert.ok(new URL(target.sourceUrl).hostname.endsWith('.test'), 'Synthetic catalog source must use a .test hostname');
  const textHash = `sha256:${createHash('sha256').update(target.leanStatement).digest('hex')}`;
  assert.equal(target.statementHash, textHash, 'Statement hash must bind the actual Lean text');
  const manifest = { environment, ids, target };
  const manifestHash = await sha256Canonical(manifest);
  const sourceRevision = target.sourceRevision ?? textHash.slice(7);
  const created = { protocolVersion:'pw-credit-pool-event-v1',poolId:ids.poolId,sequence:1,eventType:'created',occurredAt:instant,policyVersion:'pw-credit-market-v1',problemRevisionId:ids.revisionId,sponsorLabel:'Isolated synthetic acceptance',totalCredits:10000,unit:'non_transferable_research_credit' };
  const activated = { protocolVersion:'pw-credit-pool-event-v1',poolId:ids.poolId,sequence:2,eventType:'activated',occurredAt:instant };
  const statements = [
    database.prepare('INSERT INTO projects (id,slug,kind,title,summary,visibility,created_at) VALUES (?,?,?,?,?,?,?)').bind(ids.projectId,ids.slug,'frontier','Isolated acceptance target','Synthetic local integration; no real novelty or human independence claim.','public',instant),
    database.prepare('INSERT INTO source_snapshots (id,upstream_name,source_url,revision_tag,revision_commit,retrieved_at,content_hash,manifest_hash,source_license,lean_toolchain,mathlib_revision,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(ids.snapshotId,'Isolated local acceptance',target.sourceUrl,ids.slug,sourceRevision,instant,textHash,manifestHash,'CC0-1.0',target.leanToolchain,target.mathlibRevision,instant),
    database.prepare('INSERT INTO problem_revisions (id,project_id,source_snapshot_id,target_key,slug,revision_number,title,domain,research_status,informal_statement,lean_statement,source_correspondence,proof_state,priority,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(ids.revisionId,ids.projectId,ids.snapshotId,target.declaration,ids.slug,1,'Local identity acceptance','logic','research_open','Synthetic identity theorem for isolated integration only.',target.leanStatement,'imported_unreviewed','admitted',0,instant),
    database.prepare('INSERT INTO declarations (id,problem_revision_id,qualified_name,declaration_kind,source_path,source_url,source_line_start,source_line_end,source_content_hash,is_primary,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(`${ids.revisionId}:declaration`,ids.revisionId,target.declaration,'theorem',target.sourcePath ?? 'ProofweaveAcceptance.lean',target.sourceUrl,1,target.leanStatement.split('\n').length,textHash,1,instant),
    database.prepare('INSERT INTO verification_claims (id,problem_revision_id,claim_type,status,evidence_url,recorded_at,created_at) VALUES (?,?,?,?,?,?,?)').bind(`${ids.revisionId}:source-claim`,ids.revisionId,'source_correspondence','imported_unreviewed',target.sourceUrl,instant,instant),
    database.prepare('INSERT INTO problem_credit_pools (id,problem_revision_id,policy_version,unit,total_credits,sponsor_label,created_at) VALUES (?,?,?,?,?,?,?)').bind(ids.poolId,ids.revisionId,'pw-credit-market-v1','non_transferable_research_credit',10000,'Isolated synthetic acceptance',instant),
  ];
  for (const event of [created,activated]) statements.push(database.prepare('INSERT INTO problem_credit_pool_events (id,pool_id,sequence,event_type,payload_hash,canonical_payload,occurred_at,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(`${ids.poolId}:${event.eventType}`,ids.poolId,event.sequence,event.eventType,await sha256Canonical(event),canonicalJson(event),instant,instant));
  await database.batch(statements);
  return { environment, syntheticIdentities:true, ids, target, manifestHash,sourceRevision,snapshotIdentityKind:target.sourceRevision ? 'caller_provided_revision' : 'statement_content_hash' };
}
