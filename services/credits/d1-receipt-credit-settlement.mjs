import { canonicalJson, sha256Canonical } from "../../packages/protocol/canonical-json.mjs";
import { contributionReceiptHash } from "../../packages/protocol/contribution-receipt.mjs";
import {
  deriveReceiptCreditSettlement,
  receiptCreditPolicyVersion,
  receiptCreditUnit,
} from "../../packages/protocol/receipt-credit.mjs";
import { D1ContributionReceiptStore } from "../receipts/d1-contribution-receipt-store.mjs";

export class ReceiptCreditSettlementError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReceiptCreditSettlementError";
  }
}

/**
 * Internal, idempotent settlement boundary. It accepts only a stored Receipt
 * id, re-verifies that Receipt and every dependency, then derives the complete
 * append-only ledger itself. Clients cannot choose recipients or amounts.
 */
export class D1ReceiptCreditSettlement {
  constructor(database) {
    if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function") {
      throw new TypeError("Receipt credit settlement requires a D1-compatible database.");
    }
    this.database = database;
    this.receipts = new D1ContributionReceiptStore(database);
  }

  async settleReceipt(receiptId) {
    requireIdentifier(receiptId, "receiptId");
    const publication = await this.database.prepare(
      `SELECT record_class, visibility
       FROM contribution_receipt_publications WHERE receipt_id = ?`,
    ).bind(receiptId).first();
    if (publication?.record_class !== "research" || publication?.visibility !== "public") {
      return Object.freeze({
        eligible: false,
        created: false,
        reason: "not_public_research",
        receiptId,
        totalUnits: 0,
        peopleCredited: 0,
        entryCount: 0,
        categoryUnits: Object.freeze([]),
      });
    }
    const existing = await this.getSettlement(receiptId);
    if (existing) return Object.freeze({ ...existing, created: false });

    const receipt = await this.receipts.loadVerifiedReceipt(receiptId);
    await this.assertReceiptActive(receipt.id);
    const receiptHash = await contributionReceiptHash(receipt);
    const dependencyBeneficiaries = [];
    for (const dependency of receipt.bundle.dependencyReceipts) {
      const upstream = await this.receipts.loadVerifiedReceipt(dependency.receiptId);
      const upstreamHash = await contributionReceiptHash(upstream);
      if (upstreamHash !== dependency.receiptHash) {
        throw new ReceiptCreditSettlementError("A dependency Receipt changed before credit settlement.");
      }
      await this.assertReceiptActive(upstream.id);
      dependencyBeneficiaries.push(Object.freeze({
        receiptId: upstream.id,
        receiptHash: upstreamHash,
        personId: upstream.beneficiary.personId,
      }));
    }

    const settlement = await deriveReceiptCreditSettlement({ receipt, receiptHash, dependencyBeneficiaries });
    const settlementInsert = this.database.prepare(
      `INSERT INTO receipt_credit_settlements (
         receipt_id, receipt_hash, policy_version, unit, payload_hash,
         canonical_payload, settled_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      settlement.receiptId,
      settlement.receiptHash,
      settlement.policyVersion,
      settlement.unit,
      settlement.payloadHash,
      settlement.canonicalPayload,
      settlement.settledAt,
    );
    const entryInserts = settlement.entries.map((entry) => this.database.prepare(
      `INSERT INTO receipt_credit_entries (
         id, receipt_id, person_id, category, units, reason_key,
         source_receipt_id, policy_version, unit, payload_hash,
         canonical_payload, occurred_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      entry.id,
      entry.receiptId,
      entry.personId,
      entry.category,
      entry.units,
      entry.reasonKey,
      entry.sourceReceiptId,
      entry.policyVersion,
      entry.unit,
      entry.payloadHash,
      entry.canonicalPayload,
      entry.occurredAt,
    ));
    try {
      await this.database.batch([settlementInsert, ...entryInserts]);
    } catch (error) {
      const raced = await this.getSettlement(receiptId);
      if (raced && raced.payloadHash === settlement.payloadHash) return Object.freeze({ ...raced, created: false });
      throw error;
    }
    return Object.freeze({ ...projectSettlement(settlement), eligible: true, created: true });
  }

  async getSettlement(receiptId) {
    const row = await this.database.prepare(
      `SELECT receipt_id, receipt_hash, policy_version, unit, payload_hash,
              canonical_payload, settled_at
       FROM receipt_credit_settlements WHERE receipt_id = ?`,
    ).bind(receiptId).first();
    if (!row) return null;
    const entryRows = await this.database.prepare(
      `SELECT id, receipt_id, person_id, category, units, reason_key,
              source_receipt_id, policy_version, unit, payload_hash,
              canonical_payload, occurred_at
       FROM receipt_credit_entries WHERE receipt_id = ?
       ORDER BY person_id, category, reason_key`,
    ).bind(receiptId).all();
    const settlement = await verifyStoredSettlement(row, entryRows.results ?? []);
    return projectSettlement(settlement);
  }

  async assertReceiptActive(receiptId) {
    const terminal = await this.database.prepare(
      `SELECT event_type FROM contribution_receipt_lifecycle_events
       WHERE receipt_id = ? AND event_type IN ('retracted','superseded')
       ORDER BY occurred_at DESC, id DESC LIMIT 1`,
    ).bind(receiptId).first();
    if (terminal) throw new ReceiptCreditSettlementError("Retracted or superseded Receipts cannot create active research credit.");
  }
}

async function verifyStoredSettlement(row, entryRows) {
  let settlement;
  try {
    settlement = JSON.parse(row.canonical_payload);
  } catch {
    throw new ReceiptCreditSettlementError("Stored credit settlement payload is not JSON.");
  }
  if (
    canonicalJson(settlement) !== row.canonical_payload
    || await sha256Canonical(settlement) !== row.payload_hash
    || settlement.receiptId !== row.receipt_id
    || settlement.receiptHash !== row.receipt_hash
    || settlement.policyVersion !== row.policy_version
    || settlement.unit !== row.unit
    || settlement.settledAt !== row.settled_at
    || settlement.policyVersion !== receiptCreditPolicyVersion
    || settlement.unit !== receiptCreditUnit
  ) throw new ReceiptCreditSettlementError("Stored credit settlement failed its canonical hash check.");

  const expectedEntries = new Map(settlement.entries.map((entry) => [entry.id, entry.payloadHash]));
  if (expectedEntries.size !== entryRows.length) throw new ReceiptCreditSettlementError("Stored credit settlement entry closure is incomplete.");
  const entries = [];
  for (const rowEntry of entryRows) {
    let entry;
    try { entry = JSON.parse(rowEntry.canonical_payload); } catch { throw new ReceiptCreditSettlementError("Stored credit entry payload is not JSON."); }
    if (
      canonicalJson(entry) !== rowEntry.canonical_payload
      || await sha256Canonical(entry) !== rowEntry.payload_hash
      || expectedEntries.get(rowEntry.id) !== rowEntry.payload_hash
      || entry.receiptId !== rowEntry.receipt_id
      || entry.personId !== rowEntry.person_id
      || entry.category !== rowEntry.category
      || entry.units !== rowEntry.units
      || entry.reasonKey !== rowEntry.reason_key
      || entry.sourceReceiptId !== rowEntry.source_receipt_id
      || entry.policyVersion !== rowEntry.policy_version
      || entry.unit !== rowEntry.unit
      || entry.occurredAt !== rowEntry.occurred_at
    ) throw new ReceiptCreditSettlementError("Stored credit entry failed its canonical hash check.");
    entries.push(Object.freeze({ id: rowEntry.id, ...entry, payloadHash: rowEntry.payload_hash, canonicalPayload: rowEntry.canonical_payload }));
  }
  return Object.freeze({ ...settlement, payloadHash: row.payload_hash, canonicalPayload: row.canonical_payload, entries: Object.freeze(entries) });
}

function projectSettlement(settlement) {
  const categoryUnits = new Map();
  const people = new Set();
  for (const entry of settlement.entries) {
    categoryUnits.set(entry.category, (categoryUnits.get(entry.category) ?? 0) + entry.units);
    people.add(entry.personId);
  }
  return Object.freeze({
    eligible: true,
    receiptId: settlement.receiptId,
    receiptHash: settlement.receiptHash,
    payloadHash: settlement.payloadHash,
    policyVersion: settlement.policyVersion,
    unit: settlement.unit,
    settledAt: settlement.settledAt,
    totalUnits: settlement.entries.reduce((sum, entry) => sum + entry.units, 0),
    peopleCredited: people.size,
    entryCount: settlement.entries.length,
    categoryUnits: Object.freeze([...categoryUnits.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([category, units]) => Object.freeze({ category, units }))),
  });
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{2,519}$/.test(value)) {
    throw new ReceiptCreditSettlementError(`${label} must be a bounded identifier.`);
  }
}
