import {
  contributionReceiptHash,
  contributionReceiptRequiredClaimTypes,
} from "../../packages/protocol/contribution-receipt.mjs";
import { normalizeLeanRunnerResult } from "../../packages/protocol/lean-runner.mjs";
import { D1ContributionReceiptIssuerKeyStore } from "./d1-contribution-receipt-issuer-key-store.mjs";
import { D1ContributionReceiptStore } from "./d1-contribution-receipt-store.mjs";
import { D1ReceiptCreditSettlement } from "../credits/d1-receipt-credit-settlement.mjs";

export class ContributionReceiptCoordinatorConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContributionReceiptCoordinatorConfigurationError";
  }
}

/**
 * Internal closure boundary for one accepted Bundle. Review Agents can submit
 * signed decisions, but only this coordinator may derive and sign a Receipt
 * from immutable D1 evidence. It never accepts a client-provided beneficiary,
 * contribution kind, Run id, Receipt payload, or issuer key.
 */
export class D1ContributionReceiptCoordinator {
  constructor({ database, issuer }) {
    if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function") {
      throw new TypeError("Contribution Receipt coordinator requires a D1-compatible database.");
    }
    this.database = database;
    this.issuer = normalizeIssuer(issuer);
    this.receipts = new D1ContributionReceiptStore(database);
    this.credits = new D1ReceiptCreditSettlement(database);
    this.issuerKeys = new D1ContributionReceiptIssuerKeyStore(database);
    this.issuerPrivateKeyPromise = null;
  }

  async statusForBundle(artifactBundleManifestHash) {
    requireSha256(artifactBundleManifestHash, "artifactBundleManifestHash");
    const existing = await this.database.prepare(
      `SELECT id, receipt_hash FROM contribution_receipts
       WHERE artifact_bundle_manifest_hash = ?
         AND kind <> 'verification'
       ORDER BY issued_at ASC, id ASC LIMIT 1`,
    ).bind(artifactBundleManifestHash).first();
    if (existing) {
      const receipt = await this.receipts.require(existing.id);
      return freezeClosure({
        state: "receipt_issued",
        receiptId: receipt.id,
        receiptHash: existing.receipt_hash,
        missingClaims: [],
        blockingDecisions: [],
      });
    }

    const [run, reviewState] = await Promise.all([
      this.findEligibleRun(artifactBundleManifestHash),
      this.reviewState(artifactBundleManifestHash),
    ]);
    if (!run) {
      return freezeClosure({
        state: "awaiting_kernel_run",
        receiptId: null,
        receiptHash: null,
        missingClaims: [...contributionReceiptRequiredClaimTypes],
        blockingDecisions: reviewState.blockingDecisions,
      });
    }
    const state = reviewState.blockingDecisions.length > 0
      ? "review_blocked"
      : reviewState.missingClaims.length > 0
        ? "awaiting_review"
        : "ready_to_issue";
    return freezeClosure({
      state,
      receiptId: null,
      receiptHash: null,
      missingClaims: reviewState.missingClaims,
      blockingDecisions: reviewState.blockingDecisions,
    });
  }

  async tryIssueForBundle(artifactBundleManifestHash) {
    const status = await this.statusForBundle(artifactBundleManifestHash);
    if (status.state === "receipt_issued") {
      const creditSettlement = await this.credits.settleReceipt(status.receiptId);
      return freezeClosure({ ...status, creditSettlement });
    }
    if (status.state !== "ready_to_issue") return status;

    const [run, attempt, reviewState] = await Promise.all([
      this.findEligibleRun(artifactBundleManifestHash),
      this.requireAttempt(artifactBundleManifestHash),
      this.reviewState(artifactBundleManifestHash),
    ]);
    if (!run || reviewState.missingClaims.length > 0 || reviewState.blockingDecisions.length > 0) {
      return this.statusForBundle(artifactBundleManifestHash);
    }

    await this.issuerKeys.registerInitial({
      id: this.issuer.keyId,
      publicKey: this.issuer.publicKey,
      activatedAt: this.issuer.activatedAt,
    });
    const issuedAt = laterInstant(this.issuer.activatedAt, reviewState.closedAt);
    const issued = await this.receipts.issue({
      id: `receipt:${artifactBundleManifestHash.slice("sha256:".length)}`,
      kind: contributionKindForScope(attempt.delegation_scope),
      artifactBundleManifestHash,
      runId: run.id,
      issuedAt,
      issuerKeyId: this.issuer.keyId,
      issuerPublicKey: this.issuer.publicKey,
      issuerPrivateKey: await this.importIssuerPrivateKey(),
    });
    const creditSettlement = await this.credits.settleReceipt(issued.receipt.id);
    return freezeClosure({
      state: "receipt_issued",
      receiptId: issued.receipt.id,
      receiptHash: await contributionReceiptHash(issued.receipt),
      receiptCreated: issued.created,
      creditSettlement,
      missingClaims: [],
      blockingDecisions: [],
    });
  }

  async findEligibleRun(artifactBundleManifestHash) {
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
    ).bind(artifactBundleManifestHash).all();
    for (const row of rows.results ?? []) {
      try {
        const result = normalizeLeanRunnerResult(JSON.parse(row.canonical_result));
        if (
          row.state === "succeeded" &&
          result.status === "succeeded" &&
          result.kernelStatus === "accepted" &&
          row.runner_result_hash === row.result_hash
        ) return Object.freeze({ id: row.id });
      } catch {
        // A malformed historical result is ineligible; the Receipt store will
        // still perform the full canonical evidence check on the chosen Run.
      }
    }
    return null;
  }

  async requireAttempt(artifactBundleManifestHash) {
    const row = await this.database.prepare(
      `SELECT attempt.id, attempt.delegation_scope
       FROM artifact_bundles AS bundle
       INNER JOIN agent_attempts AS attempt ON attempt.id = bundle.attempt_id
       WHERE bundle.manifest_hash = ?`,
    ).bind(artifactBundleManifestHash).first();
    if (!row) throw new ContributionReceiptCoordinatorConfigurationError("Receipt closure references an unknown Artifact Bundle.");
    return row;
  }

  async reviewState(artifactBundleManifestHash) {
    const rows = await this.database.prepare(
      `SELECT claim_type, decision, attested_at
       FROM verification_attestations
       WHERE artifact_bundle_manifest_hash = ?
         AND claim_type IN ('bundle_reproducible','kernel_accepted','project_accepted')
       ORDER BY attested_at ASC, id ASC`,
    ).bind(artifactBundleManifestHash).all();
    const positive = new Map();
    const nonPositive = new Map();
    for (const row of rows.results ?? []) {
      if (row.decision === "attested") positive.set(row.claim_type, row.attested_at);
      else if (!positive.has(row.claim_type)) nonPositive.set(row.claim_type, row.decision);
    }
    const missingClaims = contributionReceiptRequiredClaimTypes.filter((claimType) => !positive.has(claimType));
    const blockingDecisions = missingClaims
      .filter((claimType) => nonPositive.has(claimType))
      .map((claimType) => Object.freeze({ claimType, decision: nonPositive.get(claimType) }));
    const closedAt = [...positive.values()].sort().at(-1) ?? this.issuer.activatedAt;
    return Object.freeze({
      missingClaims: Object.freeze([...missingClaims]),
      blockingDecisions: Object.freeze(blockingDecisions),
      closedAt,
    });
  }

  async importIssuerPrivateKey() {
    this.issuerPrivateKeyPromise ??= crypto.subtle.importKey(
      "jwk",
      this.issuer.privateKeyJwk,
      { name: "Ed25519" },
      false,
      ["sign"],
    ).catch(() => {
      throw new ContributionReceiptCoordinatorConfigurationError("Contribution Receipt issuer private key is not a valid Ed25519 JWK.");
    });
    return this.issuerPrivateKeyPromise;
  }
}

function normalizeIssuer(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContributionReceiptCoordinatorConfigurationError("Contribution Receipt issuer configuration is required.");
  }
  requireIdentifier(value.keyId, "issuer keyId");
  requireBase64Url(value.publicKey, 32, "issuer publicKey");
  requireUtcInstant(value.activatedAt, "issuer activatedAt");
  if (!value.privateKeyJwk || typeof value.privateKeyJwk !== "object" || Array.isArray(value.privateKeyJwk)) {
    throw new ContributionReceiptCoordinatorConfigurationError("issuer privateKeyJwk is required.");
  }
  return Object.freeze({
    keyId: value.keyId,
    publicKey: value.publicKey,
    activatedAt: value.activatedAt,
    privateKeyJwk: Object.freeze({ ...value.privateKeyJwk }),
  });
}

function contributionKindForScope(scope) {
  return scope === "formalize" ? "formalization" : "proof_patch";
}

function laterInstant(left, right) {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function freezeClosure(value) {
  return Object.freeze({
    ...value,
    missingClaims: Object.freeze([...value.missingClaims]),
    blockingDecisions: Object.freeze([...value.blockingDecisions]),
  });
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 240 || /[\0\r\n]/.test(value)) {
    throw new ContributionReceiptCoordinatorConfigurationError(`${label} must be a bounded identifier.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new ContributionReceiptCoordinatorConfigurationError(`${label} must be a lowercase SHA-256 digest.`);
  }
}

function requireBase64Url(value, bytes, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ContributionReceiptCoordinatorConfigurationError(`${label} must be base64url without padding.`);
  }
  let decoded;
  try {
    const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
    const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
    decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new ContributionReceiptCoordinatorConfigurationError(`${label} must be valid base64url.`);
  }
  if (decoded.byteLength !== bytes) {
    throw new ContributionReceiptCoordinatorConfigurationError(`${label} has the wrong byte length.`);
  }
}

function requireUtcInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new ContributionReceiptCoordinatorConfigurationError(`${label} must be a UTC timestamp.`);
  }
}
