import { canonicalJson, sha256Canonical } from "./canonical-json.mjs";
import {
  assertContributionReceiptPolicy,
  contributionReceiptHash,
  normalizeContributionReceipt,
  verifyContributionReceiptSignature,
} from "./contribution-receipt.mjs";
import {
  normalizeContributionReceiptLifecycleEvent,
  verifyContributionReceiptLifecycleEventSignature,
} from "./contribution-receipt-lifecycle.mjs";

export const contributionReceiptVerificationBundleProtocolVersion = "pw-contribution-receipt-verification-bundle-v1";
const issuerKeyStatuses = Object.freeze(["active", "retired", "revoked"]);
const maxReceiptsPerBundle = 128;

export class ContributionReceiptVerificationBundleProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContributionReceiptVerificationBundleProtocolError";
  }
}

/**
 * Normalize a portable, read-only evidence closure for one Receipt. The
 * exported data contains no private artifact bytes or issuing credentials.
 */
export function normalizeContributionReceiptVerificationBundle(bundle) {
  requireRecord(bundle, "Contribution Receipt verification bundle");
  rejectExtraKeys(bundle, ["protocolVersion", "rootReceiptId", "receipts", "issuerKeys"], "Contribution Receipt verification bundle");
  if (bundle.protocolVersion !== contributionReceiptVerificationBundleProtocolVersion) {
    throw new ContributionReceiptVerificationBundleProtocolError("Unsupported Contribution Receipt verification bundle protocol version.");
  }
  requireIdentifier(bundle.rootReceiptId, "Contribution Receipt verification bundle rootReceiptId");
  if (!Array.isArray(bundle.receipts) || bundle.receipts.length === 0 || bundle.receipts.length > maxReceiptsPerBundle) {
    throw new ContributionReceiptVerificationBundleProtocolError(`Contribution Receipt verification bundle receipts must contain 1 to ${maxReceiptsPerBundle} records.`);
  }
  if (!Array.isArray(bundle.issuerKeys) || bundle.issuerKeys.length === 0 || bundle.issuerKeys.length > maxReceiptsPerBundle) {
    throw new ContributionReceiptVerificationBundleProtocolError(`Contribution Receipt verification bundle issuerKeys must contain 1 to ${maxReceiptsPerBundle} records.`);
  }

  const receiptIds = new Set();
  const lifecycleEventIds = new Set();
  const receipts = bundle.receipts
    .map((entry) => normalizeReceiptEntry(entry, receiptIds, lifecycleEventIds))
    .sort((left, right) => compareIdentifier(left.receipt.id, right.receipt.id));
  const issuerKeyIds = new Set();
  const issuerKeys = bundle.issuerKeys
    .map((key) => normalizeIssuerKey(key, issuerKeyIds))
    .sort((left, right) => compareIdentifier(left.id, right.id));
  if (!receiptIds.has(bundle.rootReceiptId)) {
    throw new ContributionReceiptVerificationBundleProtocolError("Contribution Receipt verification bundle does not contain its root receipt.");
  }
  return Object.freeze({
    protocolVersion: contributionReceiptVerificationBundleProtocolVersion,
    rootReceiptId: bundle.rootReceiptId,
    receipts: Object.freeze(receipts),
    issuerKeys: Object.freeze(issuerKeys),
  });
}

/** Canonical JSON lets an external verifier name or cache this exact export. */
export function canonicalContributionReceiptVerificationBundle(bundle) {
  return canonicalJson(normalizeContributionReceiptVerificationBundle(bundle));
}

export async function contributionReceiptVerificationBundleHash(bundle) {
  return sha256Canonical(normalizeContributionReceiptVerificationBundle(bundle));
}

/**
 * Normalize the public key-distribution response from
 * GET /api/receipts/issuer-keys. It intentionally has no signing material.
 */
export function normalizeContributionReceiptIssuerKeyset(keyset) {
  requireRecord(keyset, "Contribution Receipt issuer keyset");
  rejectExtraKeys(keyset, ["issuerKeys"], "Contribution Receipt issuer keyset");
  if (!Array.isArray(keyset.issuerKeys) || keyset.issuerKeys.length === 0 || keyset.issuerKeys.length > maxReceiptsPerBundle) {
    throw new ContributionReceiptVerificationBundleProtocolError(`Contribution Receipt issuer keyset issuerKeys must contain 1 to ${maxReceiptsPerBundle} records.`);
  }
  const issuerKeyIds = new Set();
  const issuerKeys = keyset.issuerKeys
    .map((key) => normalizeIssuerKey(key, issuerKeyIds))
    .sort((left, right) => compareIdentifier(left.id, right.id));
  return Object.freeze({ issuerKeys: Object.freeze(issuerKeys) });
}

/**
 * Verify every signed Receipt and lifecycle event, its issuer-key snapshot,
 * its complete dependency closure, and lifecycle replacement relationships.
 * A successful result means the bundle is self-consistent; key snapshots still
 * need a trusted transport or a newer public keyset for revocation updates.
 */
export async function verifyContributionReceiptVerificationBundle(bundle) {
  const normalized = normalizeContributionReceiptVerificationBundle(bundle);
  const receiptsById = new Map(normalized.receipts.map((entry) => [entry.receipt.id, entry]));
  const keysById = new Map(normalized.issuerKeys.map((key) => [key.id, key]));

  for (const entry of normalized.receipts) {
    const { receipt } = entry;
    if (
      entry.receiptHash !== await contributionReceiptHash(receipt) ||
      !await verifyContributionReceiptSignature(receipt)
    ) {
      throw new ContributionReceiptVerificationBundleProtocolError(`Receipt ${receipt.id} does not match its hash or issuer signature.`);
    }
    try {
      assertContributionReceiptPolicy(receipt);
    } catch {
      throw new ContributionReceiptVerificationBundleProtocolError(`Receipt ${receipt.id} does not meet the bundled receipt policy.`);
    }
    assertIssuerTrustedAt(keysById, receipt.issuerKeyId, receipt.issuerPublicKey, receipt.issuedAt, `Receipt ${receipt.id}`);

    for (const event of entry.lifecycle) {
      if (
        event.receiptId !== receipt.id ||
        Date.parse(event.occurredAt) < Date.parse(receipt.issuedAt) ||
        !await verifyContributionReceiptLifecycleEventSignature(event)
      ) {
        throw new ContributionReceiptVerificationBundleProtocolError(`Lifecycle event ${event.id} is not valid for Receipt ${receipt.id}.`);
      }
      assertIssuerTrustedAt(keysById, event.issuerKeyId, event.issuerPublicKey, event.occurredAt, `Lifecycle event ${event.id}`);
      if (event.replacementReceiptId) {
        const replacement = receiptsById.get(event.replacementReceiptId)?.receipt;
        if (
          !replacement ||
          replacement.attempt.id !== receipt.attempt.id ||
          replacement.target.declaration !== receipt.target.declaration ||
          replacement.target.statementHash !== receipt.target.statementHash ||
          Date.parse(replacement.issuedAt) <= Date.parse(receipt.issuedAt) ||
          Date.parse(replacement.issuedAt) > Date.parse(event.occurredAt)
        ) {
          throw new ContributionReceiptVerificationBundleProtocolError(`Lifecycle event ${event.id} has an invalid replacement Receipt.`);
        }
      }
    }
    assertLifecycleSequence(entry.lifecycle, receipt.id);
  }

  assertCompleteEvidenceClosure(normalized.rootReceiptId, receiptsById);
  assertNoDependencyCycles(receiptsById);
  assertNoReplacementCycles(receiptsById);
  return normalized;
}

/**
 * Re-verify a portable closure with a newer public issuer-key response.
 * The caller must obtain that response through a trusted current transport;
 * this check detects a later retirement or revocation without trusting the
 * stale key snapshot embedded in the downloaded bundle.
 */
export async function verifyContributionReceiptVerificationBundleWithIssuerKeyset(bundle, issuerKeyset) {
  const verifiedBundle = await verifyContributionReceiptVerificationBundle(bundle);
  const normalizedKeyset = normalizeContributionReceiptIssuerKeyset(issuerKeyset);
  const currentKeysById = new Map(normalizedKeyset.issuerKeys.map((key) => [key.id, key]));
  const currentBundleKeys = verifiedBundle.issuerKeys.map((snapshot) => {
    const current = currentKeysById.get(snapshot.id);
    if (!current || current.publicKey !== snapshot.publicKey || current.validFrom !== snapshot.validFrom) {
      throw new ContributionReceiptVerificationBundleProtocolError(`Current issuer keyset does not preserve Receipt issuer key ${snapshot.id}.`);
    }
    assertIssuerKeyLifecycleDoesNotRegress(snapshot, current);
    return current;
  });
  return verifyContributionReceiptVerificationBundle({
    ...verifiedBundle,
    issuerKeys: currentBundleKeys,
  });
}

function normalizeReceiptEntry(entry, receiptIds, lifecycleEventIds) {
  requireRecord(entry, "Contribution Receipt verification bundle receipt entry");
  rejectExtraKeys(entry, ["receipt", "receiptHash", "lifecycle"], "Contribution Receipt verification bundle receipt entry");
  let receipt;
  try {
    receipt = normalizeContributionReceipt(entry.receipt);
  } catch {
    throw new ContributionReceiptVerificationBundleProtocolError("Contribution Receipt verification bundle contains an invalid Receipt.");
  }
  if (receiptIds.has(receipt.id)) {
    throw new ContributionReceiptVerificationBundleProtocolError("Contribution Receipt verification bundle cannot contain duplicate Receipt ids.");
  }
  receiptIds.add(receipt.id);
  requireSha256(entry.receiptHash, "Contribution Receipt verification bundle receiptHash");
  if (!Array.isArray(entry.lifecycle)) {
    throw new ContributionReceiptVerificationBundleProtocolError("Contribution Receipt verification bundle lifecycle must be an array.");
  }
  const lifecycle = entry.lifecycle.map((event) => {
    let normalized;
    try {
      normalized = normalizeContributionReceiptLifecycleEvent(event);
    } catch {
      throw new ContributionReceiptVerificationBundleProtocolError("Contribution Receipt verification bundle contains an invalid lifecycle event.");
    }
    if (lifecycleEventIds.has(normalized.id)) {
      throw new ContributionReceiptVerificationBundleProtocolError("Contribution Receipt verification bundle cannot contain duplicate lifecycle event ids.");
    }
    lifecycleEventIds.add(normalized.id);
    return normalized;
  });
  lifecycle.sort((left, right) => {
    const time = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
    return time === 0 ? compareIdentifier(left.id, right.id) : time;
  });
  return Object.freeze({ receipt, receiptHash: entry.receiptHash, lifecycle: Object.freeze(lifecycle) });
}

function normalizeIssuerKey(key, issuerKeyIds) {
  requireRecord(key, "Contribution Receipt verification bundle issuer key");
  rejectExtraKeys(key, ["id", "publicKey", "status", "validFrom", "retiredAt", "revokedAt"], "Contribution Receipt verification bundle issuer key");
  requireIdentifier(key.id, "Contribution Receipt verification bundle issuer key id");
  requireEd25519PublicKey(key.publicKey, "Contribution Receipt verification bundle issuer key publicKey");
  if (!issuerKeyStatuses.includes(key.status)) {
    throw new ContributionReceiptVerificationBundleProtocolError("Contribution Receipt verification bundle issuer key status is invalid.");
  }
  requireUtcInstant(key.validFrom, "Contribution Receipt verification bundle issuer key validFrom");
  requireOptionalUtcInstant(key.retiredAt, "Contribution Receipt verification bundle issuer key retiredAt");
  requireOptionalUtcInstant(key.revokedAt, "Contribution Receipt verification bundle issuer key revokedAt");
  if (
    issuerKeyIds.has(key.id) ||
    (key.retiredAt && Date.parse(key.retiredAt) < Date.parse(key.validFrom)) ||
    (key.revokedAt && Date.parse(key.revokedAt) < Date.parse(key.validFrom)) ||
    (key.status === "active" && (key.retiredAt || key.revokedAt)) ||
    (key.status === "retired" && (!key.retiredAt || key.revokedAt)) ||
    (key.status === "revoked" && !key.revokedAt)
  ) {
    throw new ContributionReceiptVerificationBundleProtocolError("Contribution Receipt verification bundle issuer key lifecycle is invalid.");
  }
  issuerKeyIds.add(key.id);
  return Object.freeze({
    id: key.id,
    publicKey: key.publicKey,
    status: key.status,
    validFrom: key.validFrom,
    retiredAt: key.retiredAt ?? null,
    revokedAt: key.revokedAt ?? null,
  });
}

function assertIssuerTrustedAt(keysById, issuerKeyId, issuerPublicKey, occurredAt, subject) {
  const key = keysById.get(issuerKeyId);
  if (
    !key ||
    key.publicKey !== issuerPublicKey ||
    key.status === "revoked" ||
    Date.parse(occurredAt) < Date.parse(key.validFrom) ||
    (key.retiredAt && Date.parse(occurredAt) > Date.parse(key.retiredAt))
  ) {
    throw new ContributionReceiptVerificationBundleProtocolError(`${subject} issuer key was not trusted at its evidence time.`);
  }
}

function assertIssuerKeyLifecycleDoesNotRegress(snapshot, current) {
  if (
    (snapshot.retiredAt && current.retiredAt !== snapshot.retiredAt) ||
    (snapshot.revokedAt && current.revokedAt !== snapshot.revokedAt) ||
    (snapshot.status === "retired" && current.status === "active") ||
    (snapshot.status === "revoked" && current.status !== "revoked")
  ) {
    throw new ContributionReceiptVerificationBundleProtocolError(`Current issuer keyset regresses lifecycle state for issuer key ${snapshot.id}.`);
  }
}

function assertCompleteEvidenceClosure(rootReceiptId, receiptsById) {
  const reachable = new Set();
  const pending = [rootReceiptId];
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id || reachable.has(id)) continue;
    if (reachable.size >= maxReceiptsPerBundle) {
      throw new ContributionReceiptVerificationBundleProtocolError("Contribution Receipt verification bundle exceeds the maximum evidence closure.");
    }
    const entry = receiptsById.get(id);
    if (!entry) throw new ContributionReceiptVerificationBundleProtocolError(`Receipt ${id} is missing from the verification bundle.`);
    reachable.add(id);
    for (const dependency of entry.receipt.bundle.dependencyReceipts) {
      const upstream = receiptsById.get(dependency.receiptId);
      if (
        !upstream ||
        dependency.receiptId === entry.receipt.id ||
        dependency.receiptHash !== upstream.receiptHash ||
        Date.parse(upstream.receipt.issuedAt) > Date.parse(entry.receipt.issuedAt)
      ) {
        throw new ContributionReceiptVerificationBundleProtocolError(`Receipt ${entry.receipt.id} has an invalid bundled dependency.`);
      }
      pending.push(dependency.receiptId);
    }
    for (const event of entry.lifecycle) {
      if (event.replacementReceiptId) pending.push(event.replacementReceiptId);
    }
  }
  if (reachable.size !== receiptsById.size) {
    throw new ContributionReceiptVerificationBundleProtocolError("Contribution Receipt verification bundle contains receipts outside the root evidence closure.");
  }
}

function assertLifecycleSequence(events, receiptId) {
  let corrected = false;
  let terminal = false;
  let previousTime = -Infinity;
  for (const event of events) {
    if (event.receiptId !== receiptId || Date.parse(event.occurredAt) < previousTime || terminal) {
      throw new ContributionReceiptVerificationBundleProtocolError(`Receipt ${receiptId} lifecycle sequence is invalid.`);
    }
    previousTime = Date.parse(event.occurredAt);
    if (event.eventType === "corrected") {
      if (corrected) throw new ContributionReceiptVerificationBundleProtocolError(`Receipt ${receiptId} has duplicate corrections.`);
      corrected = true;
      continue;
    }
    if (event.eventType === "superseded") {
      if (corrected) throw new ContributionReceiptVerificationBundleProtocolError(`Receipt ${receiptId} cannot be corrected and superseded.`);
      terminal = true;
      continue;
    }
    terminal = true;
  }
}

function assertNoReplacementCycles(receiptsById) {
  for (const rootId of receiptsById.keys()) {
    const pending = [{ id: rootId, path: new Set() }];
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) continue;
      if (current.path.has(current.id)) {
        throw new ContributionReceiptVerificationBundleProtocolError("Contribution Receipt verification bundle contains a lifecycle replacement cycle.");
      }
      const entry = receiptsById.get(current.id);
      if (!entry) continue;
      const path = new Set(current.path);
      path.add(current.id);
      for (const event of entry.lifecycle) {
        if (event.replacementReceiptId) pending.push({ id: event.replacementReceiptId, path });
      }
    }
  }
}

function assertNoDependencyCycles(receiptsById) {
  for (const rootId of receiptsById.keys()) {
    const pending = [{ id: rootId, path: new Set() }];
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) continue;
      if (current.path.has(current.id)) {
        throw new ContributionReceiptVerificationBundleProtocolError("Contribution Receipt verification bundle contains a dependency cycle.");
      }
      const entry = receiptsById.get(current.id);
      if (!entry) continue;
      const path = new Set(current.path);
      path.add(current.id);
      for (const dependency of entry.receipt.bundle.dependencyReceipts) {
        pending.push({ id: dependency.receiptId, path });
      }
    }
  }
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContributionReceiptVerificationBundleProtocolError(`${label} must be an object.`);
  }
}

function rejectExtraKeys(value, allowed, label) {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) throw new ContributionReceiptVerificationBundleProtocolError(`${label} contains unsupported field ${extra}.`);
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{2,239}$/.test(value)) {
    throw new ContributionReceiptVerificationBundleProtocolError(`${label} must be a bounded identifier.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new ContributionReceiptVerificationBundleProtocolError(`${label} must be sha256:<hex>.`);
  }
}

function requireEd25519PublicKey(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new ContributionReceiptVerificationBundleProtocolError(`${label} must be a raw Ed25519 base64url public key.`);
  }
}

function requireUtcInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new ContributionReceiptVerificationBundleProtocolError(`${label} must be an ISO-8601 UTC instant.`);
  }
}

function requireOptionalUtcInstant(value, label) {
  if (value !== null && value !== undefined) requireUtcInstant(value, label);
}

function compareIdentifier(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
