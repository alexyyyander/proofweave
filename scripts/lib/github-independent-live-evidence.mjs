import { createHash } from "node:crypto";
import { createRemoteLibsqlD1Database } from "../../services/database/libsql-d1-adapter.mjs";
import {
  contributionReceiptHash,
  normalizeContributionReceipt,
} from "../../packages/protocol/contribution-receipt.mjs";
import { canonicalJson, sha256Canonical } from "../../packages/protocol/canonical-json.mjs";
import {
  normalizeVerificationAttestation,
  verifyVerificationAttestationSignature,
} from "../../packages/protocol/verification-attestation.mjs";

const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9:._+/-]{0,511}$/;
const forbiddenProductionMarker = /(mock|demo|smoke|fixture)/i;
const issuerKeysetPath = "/api/receipts/issuer-keys";
const maxIssuerKeysetBytes = 1024 * 1024;

export class GithubIndependentLiveEvidenceError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = "GithubIndependentLiveEvidenceError";
    this.code = code;
  }
}

export async function probeTursoLiveClosureEvidence({ environment, state, evidence }) {
  const url = requiredSetting(environment, "TURSO_DATABASE_URL", "TURSO_DATABASE_URL_MISSING");
  const authToken = requiredSetting(environment, "TURSO_AUTH_TOKEN", "TURSO_AUTH_TOKEN_MISSING");
  const fingerprint = tursoDatabaseFingerprint(url);
  if (fingerprint !== state.release.databaseFingerprint) {
    throw error("LIVE_EVIDENCE_DATABASE_MISMATCH");
  }
  const database = createRemoteLibsqlD1Database({ url, authToken });
  try {
    return await readLiveClosureEvidence({ database, state, evidence });
  } catch (cause) {
    if (cause instanceof GithubIndependentLiveEvidenceError) throw cause;
    throw error("LIVE_EVIDENCE_QUERY_FAILED", { cause });
  } finally {
    database.close();
  }
}

export function tursoDatabaseFingerprint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw error("TURSO_DATABASE_URL_INVALID");
  }
  const canonical = `libsql://${url.host}`;
  if (
    url.protocol !== "libsql:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    value !== canonical
  ) {
    throw error("TURSO_DATABASE_URL_INVALID");
  }
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/**
 * Reconstruct one exact production closure from canonical Turso records.
 * The exported database seam is for focused fake-D1 tests only. Controllers
 * that inject a probe are permanently fixture-only.
 */
export async function readLiveClosureEvidence({ database, state, evidence }) {
  const row = await database
    .prepare(
      `SELECT
        run.id AS run_id, run.attempt_id, run.artifact_bundle_hash,
        run.request_hash, run.state AS run_state,
        run.queued_at, run.started_at, run.finished_at,
        run.runner_result_hash,
        attempt.person_id AS attempt_person_id, attempt.agent_id AS attempt_agent_id,
        result.result_hash, result.received_at,
        receipt.id AS receipt_id, receipt.attempt_id AS receipt_attempt_id,
        receipt.beneficiary_person_id, receipt.beneficiary_agent_id,
        receipt.artifact_bundle_manifest_hash AS receipt_bundle_hash,
        receipt.run_id AS receipt_run_id, receipt.receipt_hash,
        receipt.canonical_receipt, receipt.issued_at
       FROM runs AS run
       INNER JOIN agent_attempts AS attempt ON attempt.id = run.attempt_id
       INNER JOIN run_results AS result ON result.run_id = run.id
       INNER JOIN contribution_receipts AS receipt ON receipt.id = ?
       WHERE run.id = ?`,
    )
    .bind(evidence.receipt.id, evidence.run.id)
    .first();
  if (!row) throw error("LIVE_CLOSURE_NOT_FOUND");

  let receipt;
  try {
    receipt = normalizeContributionReceipt(JSON.parse(row.canonical_receipt));
  } catch (cause) {
    throw error("LIVE_RECEIPT_CANONICAL_INVALID", { cause });
  }
  const receiptHash = await contributionReceiptHash(receipt);
  if (
    canonicalJson(receipt) !== row.canonical_receipt ||
    row.run_id !== evidence.run.id ||
    row.attempt_person_id !== state.participant.personId ||
    row.attempt_agent_id !== state.participant.agentId ||
    row.artifact_bundle_hash !== state.artifactBundleHash ||
    row.runner_result_hash !== row.result_hash ||
    row.request_hash !== receipt.run.requestHash ||
    row.result_hash !== evidence.run.resultHash ||
    row.run_state !== "succeeded" ||
    row.receipt_id !== evidence.receipt.id ||
    row.receipt_hash !== evidence.receipt.hash ||
    receiptHash !== row.receipt_hash ||
    row.receipt_attempt_id !== row.attempt_id ||
    row.beneficiary_person_id !== state.participant.personId ||
    row.beneficiary_agent_id !== state.participant.agentId ||
    row.receipt_bundle_hash !== state.artifactBundleHash ||
    row.receipt_run_id !== row.run_id ||
    receipt.id !== row.receipt_id ||
    receipt.attempt.id !== row.attempt_id ||
    receipt.attempt.personId !== row.attempt_person_id ||
    receipt.attempt.agentId !== row.attempt_agent_id ||
    receipt.beneficiary.personId !== row.beneficiary_person_id ||
    receipt.beneficiary.agentId !== row.beneficiary_agent_id ||
    receipt.artifactBundleHash !== row.artifact_bundle_hash ||
    receipt.bundle.manifestHash !== row.artifact_bundle_hash ||
    receipt.run.id !== row.run_id ||
    receipt.run.resultHash !== row.result_hash ||
    receipt.run.status !== row.run_state ||
    receipt.run.kernelStatus !== "accepted" ||
    receipt.issuedAt !== row.issued_at
  ) {
    throw error("LIVE_CLOSURE_BINDING_MISMATCH");
  }

  const run = Object.freeze({
    id: productionIdentifier(row.run_id, "LIVE_RUN_INVALID"),
    attemptId: productionIdentifier(row.attempt_id, "LIVE_RUN_INVALID"),
    personId: productionIdentifier(row.attempt_person_id, "LIVE_RUN_INVALID"),
    agentId: productionIdentifier(row.attempt_agent_id, "LIVE_RUN_INVALID"),
    artifactBundleHash: sha256(row.artifact_bundle_hash, "LIVE_RUN_INVALID"),
    requestHash: sha256(row.request_hash, "LIVE_RUN_INVALID"),
    resultHash: sha256(row.result_hash, "LIVE_RUN_INVALID"),
    status: row.run_state,
    queuedAt: timestamp(row.queued_at, "LIVE_RUN_TIME_INVALID"),
    startedAt: timestamp(row.started_at, "LIVE_RUN_TIME_INVALID"),
    finishedAt: timestamp(row.finished_at, "LIVE_RUN_TIME_INVALID"),
    resultReceivedAt: timestamp(row.received_at, "LIVE_RUN_TIME_INVALID"),
  });
  freshChronology(
    state.createdAt,
    [run.queuedAt, run.startedAt, run.finishedAt, run.resultReceivedAt],
    "LIVE_RUN_NOT_FRESH",
  );

  const queueRow = await database
    .prepare(
      `SELECT run_id, attempt_id, delivery_state, lease_id, lease_consumer_id,
              delivery_attempts, enqueued_at, acknowledged_at
       FROM runner_queue_messages
       WHERE run_id = ?`,
    )
    .bind(run.id)
    .first();
  const queueEventResult = await database
    .prepare(
      `SELECT id, event_type, delivery_state, lease_id, delivery_attempt,
              occurred_at, event_sequence
       FROM runner_queue_events
       WHERE run_id = ?
       ORDER BY event_sequence ASC`,
    )
    .bind(run.id)
    .all();
  const queue = liveQueue({
    queueRow,
    eventRows: queueEventResult.results ?? [],
    run,
    notBefore: state.createdAt,
    expectedConsumerId: state.release.expectedRunnerConsumerId,
  });

  const attestationResult = await database
    .prepare(
      `SELECT
        attestation.id, attestation.assignment_id,
        attestation.artifact_bundle_manifest_hash, attestation.claim_type,
        attestation.verifier_person_id, attestation.verifier_agent_id,
        attestation.delegation_certificate_id,
        attestation.verifier_agent_public_key, attestation.decision,
        attestation.evidence_hash, attestation.canonical_payload,
        attestation.payload_hash, attestation.signature,
        attestation.attested_at,
        assignment.attempt_owner_person_id,
        assignment.verifier_person_id AS assignment_verifier_person_id,
        assignment.artifact_bundle_manifest_hash AS assignment_bundle_hash,
        assignment.claim_type AS assignment_claim_type,
        assignment.status AS assignment_status,
        assignment.completed_at AS assignment_completed_at
       FROM verification_attestations AS attestation
       INNER JOIN verification_assignments AS assignment
         ON assignment.id = attestation.assignment_id
       WHERE attestation.artifact_bundle_manifest_hash = ?
       ORDER BY attestation.attested_at ASC, attestation.id ASC`,
    )
    .bind(state.artifactBundleHash)
    .all();
  const rowsById = new Map((attestationResult.results ?? []).map((candidate) => [
    candidate.id,
    candidate,
  ]));
  const reviews = [];
  for (const claim of receipt.claims) {
    const attestationRow = rowsById.get(claim.verificationAttestationId);
    if (!attestationRow) throw error("LIVE_ATTESTATION_NOT_FOUND");
    let attestation;
    try {
      attestation = normalizeVerificationAttestation(JSON.parse(attestationRow.canonical_payload));
    } catch (cause) {
      throw error("LIVE_ATTESTATION_CANONICAL_INVALID", { cause });
    }
    const attestationHash = await sha256Canonical(attestation);
    if (
      canonicalJson(attestation) !== attestationRow.canonical_payload ||
      !await verifyVerificationAttestationSignature(attestation) ||
      attestation.id !== attestationRow.id ||
      attestation.assignmentId !== attestationRow.assignment_id ||
      attestation.artifactBundleHash !== attestationRow.artifact_bundle_manifest_hash ||
      attestation.claimType !== attestationRow.claim_type ||
      attestation.verifierPersonId !== attestationRow.verifier_person_id ||
      attestation.verifierAgentId !== attestationRow.verifier_agent_id ||
      attestation.delegationCertificateId !== attestationRow.delegation_certificate_id ||
      attestation.verifierAgentPublicKey !== attestationRow.verifier_agent_public_key ||
      attestation.decision !== attestationRow.decision ||
      attestation.evidenceHash !== attestationRow.evidence_hash ||
      attestation.payloadHash !== attestationRow.payload_hash ||
      attestation.signature !== attestationRow.signature ||
      attestation.attestedAt !== attestationRow.attested_at ||
      attestationRow.assignment_status !== "completed" ||
      attestationRow.assignment_completed_at !== attestation.attestedAt ||
      attestationRow.attempt_owner_person_id !== state.participant.personId ||
      attestationRow.assignment_verifier_person_id !== attestation.verifierPersonId ||
      attestationRow.assignment_bundle_hash !== attestation.artifactBundleHash ||
      attestationRow.assignment_claim_type !== attestation.claimType ||
      attestation.decision !== "attested" ||
      attestation.verifierPersonId === state.participant.personId ||
      claim.verificationAttestationHash !== attestationHash ||
      claim.artifactBundleHash !== attestation.artifactBundleHash ||
      claim.reviewerPersonId !== attestation.verifierPersonId ||
      claim.reviewerAgentId !== attestation.verifierAgentId
    ) {
      throw error("LIVE_ATTESTATION_BINDING_MISMATCH");
    }
    const attestedAt = timestamp(attestation.attestedAt, "LIVE_ATTESTATION_TIME_INVALID");
    freshChronology(state.createdAt, [attestedAt], "LIVE_ATTESTATION_NOT_FRESH");
    reviews.push(Object.freeze({
      verificationAttestationId: attestation.id,
      verificationAttestationHash: attestationHash,
      reviewerPersonId: attestation.verifierPersonId,
      reviewerAgentId: attestation.verifierAgentId,
      artifactBundleHash: attestation.artifactBundleHash,
      attestedAt,
    }));
  }

  const issuedAt = timestamp(row.issued_at, "LIVE_RECEIPT_TIME_INVALID");
  freshChronology(state.createdAt, [issuedAt], "LIVE_RECEIPT_NOT_FRESH");
  if (
    Date.parse(issuedAt) < Date.parse(run.resultReceivedAt) ||
    reviews.some((review) => (
      Date.parse(review.attestedAt) < Date.parse(run.resultReceivedAt) ||
      Date.parse(review.attestedAt) > Date.parse(issuedAt)
    ))
  ) {
    throw error("LIVE_RECEIPT_TIME_MISMATCH");
  }
  return Object.freeze({
    run,
    queue,
    receipt: Object.freeze({
      id: productionIdentifier(row.receipt_id, "LIVE_RECEIPT_INVALID"),
      hash: sha256(row.receipt_hash, "LIVE_RECEIPT_INVALID"),
      attemptId: productionIdentifier(row.receipt_attempt_id, "LIVE_RECEIPT_INVALID"),
      runId: productionIdentifier(row.receipt_run_id, "LIVE_RECEIPT_INVALID"),
      artifactBundleHash: sha256(row.receipt_bundle_hash, "LIVE_RECEIPT_INVALID"),
      beneficiaryPersonId: productionIdentifier(
        row.beneficiary_person_id,
        "LIVE_RECEIPT_INVALID",
      ),
      beneficiaryAgentId: productionIdentifier(
        row.beneficiary_agent_id,
        "LIVE_RECEIPT_INVALID",
      ),
      issuedAt,
    }),
    reviews: Object.freeze(reviews.sort((left, right) => (
      left.verificationAttestationId.localeCompare(right.verificationAttestationId)
    ))),
  });
}

export async function fetchCurrentIssuerKeyset({ fetcher, siteOrigin }) {
  const origin = httpsOrigin(siteOrigin, "SITE_ORIGIN_INVALID");
  const url = new URL(issuerKeysetPath, origin);
  if (url.origin !== origin.origin || url.pathname !== issuerKeysetPath) {
    throw error("ISSUER_KEYSET_ORIGIN_INVALID");
  }
  let response;
  try {
    response = await fetcher(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { accept: "application/json" },
    });
  } catch (cause) {
    throw error("ISSUER_KEYSET_UNREACHABLE", { cause });
  }
  if (!response?.ok || response.redirected === true) {
    throw error("ISSUER_KEYSET_UNREACHABLE");
  }
  if (response.url) {
    let resolved;
    try {
      resolved = new URL(response.url);
    } catch {
      throw error("ISSUER_KEYSET_ORIGIN_INVALID");
    }
    if (
      resolved.origin !== origin.origin ||
      resolved.pathname !== issuerKeysetPath ||
      resolved.search ||
      resolved.hash
    ) {
      throw error("ISSUER_KEYSET_ORIGIN_INVALID");
    }
  }
  const contentType = response.headers?.get?.("content-type") ?? "";
  if (!/^application\/(?:[A-Za-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
    throw error("ISSUER_KEYSET_CONTENT_TYPE_INVALID");
  }
  const contentLength = response.headers?.get?.("content-length");
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > maxIssuerKeysetBytes)
  ) {
    throw error("ISSUER_KEYSET_TOO_LARGE");
  }
  let source;
  try {
    source = await response.text();
  } catch (cause) {
    throw error("ISSUER_KEYSET_INVALID", { cause });
  }
  const byteLength = Buffer.byteLength(source);
  if (byteLength === 0 || byteLength > maxIssuerKeysetBytes) {
    throw error("ISSUER_KEYSET_SIZE_INVALID");
  }
  try {
    const keyset = JSON.parse(source);
    record(keyset, "ISSUER_KEYSET_INVALID");
    return keyset;
  } catch (cause) {
    if (cause instanceof GithubIndependentLiveEvidenceError) throw cause;
    throw error("ISSUER_KEYSET_INVALID", { cause });
  }
}

export function normalizeLiveEvidence(value) {
  record(value, "LIVE_EVIDENCE_INVALID");
  extraKeys(value, ["run", "queue", "receipt", "reviews"], "LIVE_EVIDENCE_INVALID");
  record(value.run, "LIVE_RUN_INVALID");
  extraKeys(value.run, [
    "id", "attemptId", "personId", "agentId", "artifactBundleHash", "requestHash", "resultHash",
    "status", "queuedAt", "startedAt", "finishedAt", "resultReceivedAt",
  ], "LIVE_RUN_INVALID");
  const run = Object.freeze({
    id: productionIdentifier(value.run.id, "LIVE_RUN_INVALID"),
    attemptId: productionIdentifier(value.run.attemptId, "LIVE_RUN_INVALID"),
    personId: productionIdentifier(value.run.personId, "LIVE_RUN_INVALID"),
    agentId: productionIdentifier(value.run.agentId, "LIVE_RUN_INVALID"),
    artifactBundleHash: sha256(value.run.artifactBundleHash, "LIVE_RUN_INVALID"),
    requestHash: sha256(value.run.requestHash, "LIVE_RUN_INVALID"),
    resultHash: sha256(value.run.resultHash, "LIVE_RUN_INVALID"),
    status: value.run.status,
    queuedAt: timestamp(value.run.queuedAt, "LIVE_RUN_TIME_INVALID"),
    startedAt: timestamp(value.run.startedAt, "LIVE_RUN_TIME_INVALID"),
    finishedAt: timestamp(value.run.finishedAt, "LIVE_RUN_TIME_INVALID"),
    resultReceivedAt: timestamp(value.run.resultReceivedAt, "LIVE_RUN_TIME_INVALID"),
  });
  if (run.status !== "succeeded") throw error("LIVE_RUN_INVALID");

  record(value.queue, "LIVE_QUEUE_INVALID");
  extraKeys(value.queue, [
    "runId", "attemptId", "consumerId", "leaseId", "deliveryAttempts",
    "deliveryState", "enqueuedAt", "acknowledgedAt", "events",
  ], "LIVE_QUEUE_INVALID");
  if (!Array.isArray(value.queue.events) || value.queue.events.length < 2 || value.queue.events.length > 256) {
    throw error("LIVE_QUEUE_EVENTS_INVALID");
  }
  const orderedEvents = [...value.queue.events].sort((left, right) => (
    Number(left?.sequence) - Number(right?.sequence)
  ));
  const events = orderedEvents.map((eventValue, index) => {
    record(eventValue, "LIVE_QUEUE_EVENT_INVALID");
    extraKeys(eventValue, [
      "id", "sequence", "eventType", "deliveryState", "leaseId",
      "deliveryAttempt", "occurredAt",
    ], "LIVE_QUEUE_EVENT_INVALID");
    if (
      !Number.isSafeInteger(eventValue.sequence) ||
      eventValue.sequence !== index + 1 ||
      !Number.isSafeInteger(eventValue.deliveryAttempt) ||
      eventValue.deliveryAttempt < 0
    ) {
      throw error("LIVE_QUEUE_SEQUENCE_INVALID");
    }
    return Object.freeze({
      id: identifier(eventValue.id, "LIVE_QUEUE_EVENT_INVALID"),
      sequence: eventValue.sequence,
      eventType: identifier(eventValue.eventType, "LIVE_QUEUE_EVENT_INVALID"),
      deliveryState: identifier(eventValue.deliveryState, "LIVE_QUEUE_EVENT_INVALID"),
      leaseId: eventValue.leaseId === null
        ? null
        : identifier(eventValue.leaseId, "LIVE_QUEUE_EVENT_INVALID"),
      deliveryAttempt: eventValue.deliveryAttempt,
      occurredAt: timestamp(eventValue.occurredAt, "LIVE_QUEUE_EVENT_TIME_INVALID"),
    });
  });
  const queue = Object.freeze({
    runId: productionIdentifier(value.queue.runId, "LIVE_QUEUE_INVALID"),
    attemptId: productionIdentifier(value.queue.attemptId, "LIVE_QUEUE_INVALID"),
    consumerId: productionIdentifier(value.queue.consumerId, "LIVE_QUEUE_INVALID"),
    leaseId: identifier(value.queue.leaseId, "LIVE_QUEUE_INVALID"),
    deliveryAttempts: value.queue.deliveryAttempts,
    deliveryState: value.queue.deliveryState,
    enqueuedAt: timestamp(value.queue.enqueuedAt, "LIVE_QUEUE_TIME_INVALID"),
    acknowledgedAt: timestamp(value.queue.acknowledgedAt, "LIVE_QUEUE_TIME_INVALID"),
    events: Object.freeze(events),
  });
  if (
    !Number.isSafeInteger(queue.deliveryAttempts) ||
    queue.deliveryAttempts <= 0 ||
    queue.deliveryState !== "acknowledged" ||
    events[0].eventType !== "enqueued" ||
    events.at(-1).eventType !== "acknowledged" ||
    events.at(-1).deliveryState !== "acknowledged" ||
    events.at(-1).leaseId !== queue.leaseId ||
    events.at(-1).deliveryAttempt !== queue.deliveryAttempts
  ) {
    throw error("LIVE_QUEUE_NOT_ACKNOWLEDGED");
  }

  record(value.receipt, "LIVE_RECEIPT_INVALID");
  extraKeys(value.receipt, [
    "id", "hash", "attemptId", "runId", "artifactBundleHash",
    "beneficiaryPersonId", "beneficiaryAgentId", "issuedAt",
  ], "LIVE_RECEIPT_INVALID");
  const receipt = Object.freeze({
    id: productionIdentifier(value.receipt.id, "LIVE_RECEIPT_INVALID"),
    hash: sha256(value.receipt.hash, "LIVE_RECEIPT_INVALID"),
    attemptId: productionIdentifier(value.receipt.attemptId, "LIVE_RECEIPT_INVALID"),
    runId: productionIdentifier(value.receipt.runId, "LIVE_RECEIPT_INVALID"),
    artifactBundleHash: sha256(value.receipt.artifactBundleHash, "LIVE_RECEIPT_INVALID"),
    beneficiaryPersonId: productionIdentifier(
      value.receipt.beneficiaryPersonId,
      "LIVE_RECEIPT_INVALID",
    ),
    beneficiaryAgentId: productionIdentifier(
      value.receipt.beneficiaryAgentId,
      "LIVE_RECEIPT_INVALID",
    ),
    issuedAt: timestamp(value.receipt.issuedAt, "LIVE_RECEIPT_TIME_INVALID"),
  });

  if (!Array.isArray(value.reviews) || value.reviews.length === 0 || value.reviews.length > 32) {
    throw error("LIVE_ATTESTATION_INVALID");
  }
  const reviews = value.reviews.map((review) => {
    record(review, "LIVE_ATTESTATION_INVALID");
    extraKeys(review, [
      "verificationAttestationId", "verificationAttestationHash",
      "reviewerPersonId", "reviewerAgentId", "artifactBundleHash", "attestedAt",
    ], "LIVE_ATTESTATION_INVALID");
    return Object.freeze({
      verificationAttestationId: productionIdentifier(
        review.verificationAttestationId,
        "LIVE_ATTESTATION_INVALID",
      ),
      verificationAttestationHash: sha256(
        review.verificationAttestationHash,
        "LIVE_ATTESTATION_INVALID",
      ),
      reviewerPersonId: productionIdentifier(
        review.reviewerPersonId,
        "LIVE_ATTESTATION_INVALID",
      ),
      reviewerAgentId: productionIdentifier(
        review.reviewerAgentId,
        "LIVE_ATTESTATION_INVALID",
      ),
      artifactBundleHash: sha256(review.artifactBundleHash, "LIVE_ATTESTATION_INVALID"),
      attestedAt: timestamp(review.attestedAt, "LIVE_ATTESTATION_TIME_INVALID"),
    });
  }).sort((left, right) => (
    left.verificationAttestationId.localeCompare(right.verificationAttestationId)
  ));
  if (new Set(reviews.map((review) => review.verificationAttestationId)).size !== reviews.length) {
    throw error("LIVE_ATTESTATION_DUPLICATE");
  }
  return Object.freeze({ run, queue, receipt, reviews: Object.freeze(reviews) });
}

export function bindLiveEvidence({ state, evidence, live }) {
  freshChronology(
    state.createdAt,
    [live.run.queuedAt, live.run.startedAt, live.run.finishedAt, live.run.resultReceivedAt],
    "LIVE_RUN_NOT_FRESH",
  );
  freshChronology(
    state.createdAt,
    [
      live.queue.enqueuedAt,
      ...live.queue.events.map((eventValue) => eventValue.occurredAt),
      live.queue.acknowledgedAt,
    ],
    "LIVE_QUEUE_NOT_FRESH",
  );
  if (
    live.run.id !== evidence.run.id ||
    live.run.personId !== state.participant.personId ||
    live.run.agentId !== state.participant.agentId ||
    live.run.artifactBundleHash !== state.artifactBundleHash ||
    live.run.resultHash !== evidence.run.resultHash ||
    live.queue.runId !== live.run.id ||
    live.queue.attemptId !== live.run.attemptId ||
    live.queue.consumerId !== state.release.expectedRunnerConsumerId ||
    live.receipt.id !== evidence.receipt.id ||
    live.receipt.hash !== evidence.receipt.hash ||
    live.receipt.attemptId !== live.run.attemptId ||
    live.receipt.runId !== live.run.id ||
    live.receipt.artifactBundleHash !== state.artifactBundleHash ||
    live.receipt.beneficiaryPersonId !== state.participant.personId ||
    live.receipt.beneficiaryAgentId !== state.participant.agentId
  ) {
    throw error("LIVE_EVIDENCE_BINDING_MISMATCH");
  }
  freshChronology(state.createdAt, [live.receipt.issuedAt], "LIVE_RECEIPT_NOT_FRESH");
  if (
    Date.parse(live.receipt.issuedAt) < Date.parse(live.run.resultReceivedAt) ||
    live.reviews.some((review) => (
      Date.parse(review.attestedAt) < Date.parse(state.createdAt) ||
      Date.parse(review.attestedAt) < Date.parse(live.run.resultReceivedAt) ||
      Date.parse(review.attestedAt) > Date.parse(live.receipt.issuedAt)
    ))
  ) {
    throw error("LIVE_RECEIPT_TIME_MISMATCH");
  }
  const liveReviews = new Map(live.reviews.map((review) => [
    review.verificationAttestationId,
    review,
  ]));
  if (
    liveReviews.size !== evidence.reviews.length ||
    evidence.reviews.some((review) => {
      const observed = liveReviews.get(review.verificationAttestationId);
      return (
        !observed ||
        observed.verificationAttestationHash !== review.verificationAttestationHash ||
        observed.reviewerPersonId !== review.reviewerPersonId ||
        observed.reviewerAgentId !== review.reviewerAgentId ||
        observed.artifactBundleHash !== state.artifactBundleHash ||
        observed.reviewerPersonId === state.participant.personId
      );
    })
  ) {
    throw error("LIVE_REVIEW_BINDING_MISMATCH");
  }
}

function liveQueue({ queueRow, eventRows, run, notBefore, expectedConsumerId }) {
  if (
    !queueRow ||
    queueRow.run_id !== run.id ||
    queueRow.attempt_id !== run.attemptId ||
    queueRow.lease_consumer_id !== expectedConsumerId
  ) {
    throw error("LIVE_QUEUE_BINDING_MISMATCH");
  }
  if (
    queueRow.delivery_state !== "acknowledged" ||
    typeof queueRow.acknowledged_at !== "string" ||
    typeof queueRow.lease_id !== "string" ||
    !Number.isSafeInteger(queueRow.delivery_attempts) ||
    queueRow.delivery_attempts <= 0
  ) {
    throw error("LIVE_QUEUE_NOT_ACKNOWLEDGED");
  }
  if (!Array.isArray(eventRows) || eventRows.length < 2 || eventRows.length > 256) {
    throw error("LIVE_QUEUE_EVENTS_INVALID");
  }
  const orderedRows = [...eventRows].sort((left, right) => (
    Number(left.event_sequence) - Number(right.event_sequence)
  ));
  const events = orderedRows.map((eventRow, index) => {
    if (
      !Number.isSafeInteger(eventRow.event_sequence) ||
      eventRow.event_sequence <= 0 ||
      eventRow.event_sequence !== index + 1 ||
      !Number.isSafeInteger(eventRow.delivery_attempt) ||
      eventRow.delivery_attempt < 0
    ) {
      throw error("LIVE_QUEUE_SEQUENCE_INVALID");
    }
    return Object.freeze({
      id: identifier(eventRow.id, "LIVE_QUEUE_EVENT_INVALID"),
      sequence: eventRow.event_sequence,
      eventType: identifier(eventRow.event_type, "LIVE_QUEUE_EVENT_INVALID"),
      deliveryState: identifier(eventRow.delivery_state, "LIVE_QUEUE_EVENT_INVALID"),
      leaseId: eventRow.lease_id === null
        ? null
        : identifier(eventRow.lease_id, "LIVE_QUEUE_EVENT_INVALID"),
      deliveryAttempt: eventRow.delivery_attempt,
      occurredAt: timestamp(eventRow.occurred_at, "LIVE_QUEUE_EVENT_TIME_INVALID"),
    });
  });
  if (
    events[0].eventType !== "enqueued" ||
    events.at(-1).eventType !== "acknowledged" ||
    events.at(-1).deliveryState !== "acknowledged" ||
    events.at(-1).leaseId !== queueRow.lease_id ||
    events.at(-1).deliveryAttempt !== queueRow.delivery_attempts
  ) {
    throw error("LIVE_QUEUE_TERMINAL_INVALID");
  }
  const enqueuedAt = timestamp(queueRow.enqueued_at, "LIVE_QUEUE_TIME_INVALID");
  const acknowledgedAt = timestamp(queueRow.acknowledged_at, "LIVE_QUEUE_TIME_INVALID");
  freshChronology(
    notBefore,
    [enqueuedAt, ...events.map((eventValue) => eventValue.occurredAt), acknowledgedAt],
    "LIVE_QUEUE_NOT_FRESH",
  );
  if (
    enqueuedAt !== events[0].occurredAt ||
    acknowledgedAt !== events.at(-1).occurredAt ||
    Date.parse(enqueuedAt) < Date.parse(run.queuedAt)
  ) {
    throw error("LIVE_QUEUE_TIME_MISMATCH");
  }
  return Object.freeze({
    runId: run.id,
    attemptId: run.attemptId,
    consumerId: expectedConsumerId,
    leaseId: identifier(queueRow.lease_id, "LIVE_QUEUE_INVALID"),
    deliveryAttempts: queueRow.delivery_attempts,
    deliveryState: "acknowledged",
    enqueuedAt,
    acknowledgedAt,
    events: Object.freeze(events),
  });
}

function freshChronology(notBefore, timestamps, code) {
  const boundary = Date.parse(timestamp(notBefore, code));
  let previous = boundary;
  for (const value of timestamps) {
    const current = Date.parse(timestamp(value, code));
    if (current < boundary || current < previous) throw error(code);
    previous = current;
  }
}

function httpsOrigin(value, code) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw error(code);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw error(code);
  }
  return url;
}

function productionIdentifier(value, code) {
  const normalized = identifier(value, code);
  if (forbiddenProductionMarker.test(normalized)) throw error("FIXTURE_IDENTIFIER_FORBIDDEN");
  return normalized;
}

function identifier(value, code) {
  if (typeof value !== "string" || !identifierPattern.test(value)) throw error(code);
  return value;
}

function sha256(value, code) {
  if (typeof value !== "string" || !sha256Pattern.test(value)) throw error(code);
  return value;
}

function timestamp(value, code) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw error(code);
  return date.toISOString();
}

function requiredSetting(environment, name, code) {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) throw error(code);
  return value;
}

function record(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw error(code);
}

function extraKeys(value, allowed, code) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw error(code);
}

function error(code, options) {
  return new GithubIndependentLiveEvidenceError(code, options);
}
