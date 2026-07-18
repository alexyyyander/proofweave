import {
  delegationPayloadHash,
  delegationSigningPayload,
  verifyDelegationSignature,
} from "../../packages/domain/delegation.mjs";
import {
  artifactBundleSigningPayload,
  artifactBundleSigningPayloadHash,
  isExecutableArtifactBundle,
  normalizeArtifactBundle,
  verifyArtifactBundleAgentSignature,
} from "../../packages/protocol/artifact-bundle.mjs";
import { canonicalJson, canonicalUtf8 } from "../../packages/protocol/canonical-json.mjs";
import {
  personKeyProofChallengePayloadHash,
  personKeyProofChallengeProtocolVersion,
  personKeyProofChallengeSigningPayload,
  verifyPersonKeyProofChallengeSignature,
} from "../../packages/protocol/person-key-proof.mjs";
import { D1InlineArtifactStore } from "../artifacts/d1-inline-artifact-store.mjs";
import { D1ContributionReceiptStore } from "../receipts/d1-contribution-receipt-store.mjs";

export class BuildWeekDemoBundleError extends Error {
  constructor(message) {
    super(message);
    this.name = "BuildWeekDemoBundleError";
  }
}

/**
 * Locally stage a fresh, explicitly labelled demo Bundle from an already
 * Receipt-verified executable template. A new Person key, Agent key,
 * possession proof, delegation, Attempt, Agent event, and Bundle signature are
 * created on the caller's computer. Private keys are never written to D1 or
 * returned. This creates reproducible input for the live multi-owner replay;
 * it does not perform inference, Lean verification, review, or Receipt issue.
 */
export async function stageBuildWeekDemoBundle({ database, sourceArtifactBundleHash, now = () => new Date() }) {
  requireDatabase(database);
  requireSha256(sourceArtifactBundleHash, "sourceArtifactBundleHash");
  if (typeof now !== "function") throw new BuildWeekDemoBundleError("The demo staging clock must be a function.");

  const source = await requireVerifiedTemplate(database, sourceArtifactBundleHash);
  const occurredAt = isoInstant(now());
  const suffix = crypto.randomUUID();
  const ids = Object.freeze({
    personId: `person:build-week-local-mock-owner:${suffix}`,
    personKeyId: `person-key:build-week-local-mock-owner:${suffix}`,
    proofChallengeId: `person-proof-challenge:build-week-local-mock-owner:${suffix}`,
    proofId: `person-proof:build-week-local-mock-owner:${suffix}`,
    agentId: `agent:build-week-local-mock-owner:${suffix}`,
    delegationId: `delegation:build-week-local-mock-owner:${suffix}`,
    attemptId: `attempt:build-week-local-mock-owner:${suffix}`,
    attemptEventId: `attempt-event:build-week-local-mock-owner:${suffix}:1`,
    bundleId: `bundle:build-week-local-mock-owner:${suffix}`,
    agentEventId: `agent-event:build-week-local-mock-owner:${suffix}`,
  });
  const [personKeyPair, agentKeyPair] = await Promise.all([
    crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]),
    crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]),
  ]);
  const personPublicKey = base64Url(await crypto.subtle.exportKey("raw", personKeyPair.publicKey));
  const agentPublicKey = base64Url(await crypto.subtle.exportKey("raw", agentKeyPair.publicKey));
  const personFingerprint = await keyFingerprint(personPublicKey);
  const agentFingerprint = await keyFingerprint(agentPublicKey);
  const validFrom = new Date(Date.parse(occurredAt) - 60_000).toISOString();
  const validUntil = new Date(Date.parse(occurredAt) + 365 * 24 * 60 * 60 * 1_000).toISOString();

  const challenge = {
    protocolVersion: personKeyProofChallengeProtocolVersion,
    id: ids.proofChallengeId,
    personId: ids.personId,
    personKeyId: ids.personKeyId,
    personPublicKey,
    nonce: base64Url(crypto.getRandomValues(new Uint8Array(32))),
    issuedAt: occurredAt,
    expiresAt: new Date(Date.parse(occurredAt) + 5 * 60_000).toISOString(),
  };
  const challengePayload = personKeyProofChallengeSigningPayload(challenge);
  const challengeCanonical = canonicalJson(challengePayload);
  const challengeHash = await personKeyProofChallengePayloadHash(challenge);
  const proofSignature = base64Url(await crypto.subtle.sign("Ed25519", personKeyPair.privateKey, canonicalUtf8(challengePayload)));
  if (!await verifyPersonKeyProofChallengeSignature({ challenge, personPublicKey, personSignature: proofSignature })) {
    throw new BuildWeekDemoBundleError("The locally generated Person possession proof did not verify.");
  }

  const certificate = {
    id: ids.delegationId,
    ownerPersonId: ids.personId,
    agentId: ids.agentId,
    agentPublicKey,
    scopes: ["prove"],
    validFrom,
    validUntil,
    attributionPolicy: { beneficiaryPersonId: ids.personId, mode: "agent_delegated" },
  };
  const certificatePayload = delegationSigningPayload(certificate);
  const certificateCanonical = canonicalJson(certificatePayload);
  const certificateHash = await delegationPayloadHash(certificate);
  const certificateSignature = base64Url(await crypto.subtle.sign("Ed25519", personKeyPair.privateKey, canonicalUtf8(certificatePayload)));
  if (!await verifyDelegationSignature({ certificate, personPublicKey, personSignature: certificateSignature })) {
    throw new BuildWeekDemoBundleError("The locally generated Agent delegation did not verify.");
  }

  await database.batch([
    database.prepare(
      `INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at)
       VALUES (?, 'proofweave', ?, 'Build Week local mock owner', ?)`,
    ).bind(ids.personId, `build-week-local-mock-owner:${suffix}`, occurredAt),
    database.prepare(
      "INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)",
    ).bind(ids.personKeyId, ids.personId, personPublicKey, personFingerprint),
    database.prepare(
      `INSERT INTO person_key_proof_challenges (
         id, person_id, person_key_id, nonce, issued_at, expires_at,
         canonical_payload, payload_hash
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      challenge.id, challenge.personId, challenge.personKeyId, challenge.nonce,
      challenge.issuedAt, challenge.expiresAt, challengeCanonical, challengeHash,
    ),
    database.prepare(
      `INSERT INTO person_key_proof_events (
         id, challenge_id, person_id, person_key_id, protocol_version,
         canonical_payload, payload_hash, person_signature, verified_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      ids.proofId, challenge.id, ids.personId, ids.personKeyId,
      personKeyProofChallengeProtocolVersion, challengeCanonical, challengeHash,
      proofSignature, occurredAt,
    ),
    database.prepare(
      "INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)",
    ).bind(ids.agentId, ids.personId, "Build Week local mock research Agent", agentPublicKey, agentFingerprint),
    database.prepare(
      `INSERT INTO delegation_certificates (
         id, owner_person_id, agent_id, person_key_id, agent_public_key,
         scopes_json, valid_from, valid_until, beneficiary_person_id,
         protocol_version, payload_hash, canonical_payload, person_signature
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      certificate.id, certificate.ownerPersonId, certificate.agentId, ids.personKeyId,
      certificate.agentPublicKey, JSON.stringify(certificate.scopes), certificate.validFrom,
      certificate.validUntil, certificate.attributionPolicy.beneficiaryPersonId,
      "pw-delegation-v1", certificateHash, certificateCanonical, certificateSignature,
    ),
    database.prepare(
      `INSERT INTO agent_attempts (
         id, person_id, problem_revision_id, agent_id, delegation_certificate_id,
         delegation_scope, agent_label, idempotency_key, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'prove', ?, ?, ?)`,
    ).bind(
      ids.attemptId, ids.personId, source.problemRevisionId, ids.agentId,
      ids.delegationId, "Build Week local mock research Agent",
      `build-week-local-mock-owner:${suffix}`, occurredAt,
    ),
    database.prepare(
      `INSERT INTO agent_attempt_events (
         id, attempt_id, sequence, event_type, message, idempotency_key, occurred_at
       ) VALUES (?, ?, 1, 'attempt_created', ?, ?, ?)`,
    ).bind(
      ids.attemptEventId, ids.attemptId,
      "Local demo Agent opened a fresh Attempt from an already Receipt-verified executable template.",
      `attempt-created:build-week-local-mock-owner:${suffix}`, occurredAt,
    ),
  ]);

  const bundle = {
    ...source.manifest,
    id: ids.bundleId,
    attemptId: ids.attemptId,
    problemRevisionId: source.problemRevisionId,
    agentEvent: {
      eventId: ids.agentEventId,
      occurredAt,
      payloadHash: `sha256:${"0".repeat(64)}`,
      agentPublicKey,
      signature: base64Url(new Uint8Array(64)),
    },
  };
  bundle.agentEvent.payloadHash = await artifactBundleSigningPayloadHash(bundle);
  bundle.agentEvent.signature = base64Url(await crypto.subtle.sign(
    "Ed25519",
    agentKeyPair.privateKey,
    canonicalUtf8(artifactBundleSigningPayload(bundle)),
  ));
  if (!await verifyArtifactBundleAgentSignature(bundle)) {
    throw new BuildWeekDemoBundleError("The locally generated Artifact Bundle signature did not verify.");
  }
  const staged = await new D1InlineArtifactStore({ database }).stageBundle(bundle);
  return Object.freeze({
    state: "bundle_staged_run_not_requested",
    sourceArtifactBundleHash,
    artifactBundleHash: staged.bundle.manifestHash,
    personId: ids.personId,
    agentId: ids.agentId,
    delegationCertificateId: ids.delegationId,
    attemptId: ids.attemptId,
    problemRevisionId: source.problemRevisionId,
    created: staged.created,
    privateKeysPersisted: false,
  });
}

async function requireVerifiedTemplate(database, sourceArtifactBundleHash) {
  const row = await database.prepare(
    `SELECT bundle.problem_revision_id, bundle.canonical_manifest, receipt.id AS receipt_id
     FROM artifact_bundles AS bundle
     INNER JOIN contribution_receipts AS receipt
       ON receipt.artifact_bundle_manifest_hash = bundle.manifest_hash
     WHERE bundle.manifest_hash = ?
       AND NOT EXISTS (
         SELECT 1 FROM contribution_receipt_lifecycle_events AS lifecycle
         WHERE lifecycle.receipt_id = receipt.id
           AND lifecycle.event_type IN ('retracted','superseded')
       )
     ORDER BY receipt.issued_at ASC LIMIT 1`,
  ).bind(sourceArtifactBundleHash).first();
  if (!row) throw new BuildWeekDemoBundleError("The source template must have an active, verified Contribution Receipt.");
  await new D1ContributionReceiptStore(database).loadVerifiedReceipt(row.receipt_id);
  let manifest;
  try { manifest = normalizeArtifactBundle(JSON.parse(row.canonical_manifest)); } catch {
    throw new BuildWeekDemoBundleError("The source template manifest failed normalization.");
  }
  if (!isExecutableArtifactBundle(manifest)) {
    throw new BuildWeekDemoBundleError("The source template is not an executable workspace Bundle.");
  }
  return Object.freeze({ manifest, problemRevisionId: row.problem_revision_id });
}

function requireDatabase(database) {
  if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function") {
    throw new BuildWeekDemoBundleError("Demo Bundle staging requires a D1-compatible database.");
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new BuildWeekDemoBundleError(`${label} must be sha256:<hex>.`);
  }
}

function isoInstant(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new BuildWeekDemoBundleError("The demo staging clock returned an invalid instant.");
  return date.toISOString();
}

async function keyFingerprint(publicKey) {
  const bytes = fromBase64Url(publicKey);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function base64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
