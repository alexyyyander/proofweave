import { getSharedResearchD1 } from "@/db";
import { getContributionReceiptReaderFor } from "@/db/repositories/receipts";
import { canonicalJson, sha256Canonical } from "@/packages/protocol/canonical-json.mjs";
import { receiptCreditCategories, receiptCreditPolicyVersion, receiptCreditUnit } from "@/packages/protocol/receipt-credit.mjs";

export type ReceiptCreditCategory = typeof receiptCreditCategories[number];

export type PublicReceiptCreditSummary = Readonly<{
  active: boolean;
  policyVersion: string;
  unit: string;
  totalUnits: number;
  settledReceipts: number;
  latestSettlementAt: string | null;
  categories: readonly Readonly<{ category: ReceiptCreditCategory; units: number }> [];
}>;

type CreditRow = {
  id: string;
  receipt_id: string;
  receipt_hash: string;
  settlement_payload_hash: string;
  settlement_canonical_payload: string;
  settled_at: string;
  person_id: string;
  category: ReceiptCreditCategory;
  units: number;
  reason_key: string;
  source_receipt_id: string;
  policy_version: string;
  unit: string;
  entry_payload_hash: string;
  entry_canonical_payload: string;
  occurred_at: string;
};

export class ReceiptCreditSchemaUnavailableError extends Error {
  constructor() {
    super("Receipt credit settlement is not active in this control plane.");
    this.name = "ReceiptCreditSchemaUnavailableError";
  }
}

export class ReceiptCreditIntegrityError extends Error {
  constructor() {
    super("A receipt-derived credit record failed its canonical evidence check.");
    this.name = "ReceiptCreditIntegrityError";
  }
}

export interface ReceiptCreditRepository {
  summaryForPerson(personId: string): Promise<PublicReceiptCreditSummary>;
}

class D1ReceiptCreditRepository implements ReceiptCreditRepository {
  async summaryForPerson(personId: string): Promise<PublicReceiptCreditSummary> {
    const database = getSharedResearchD1();
    let result;
    try {
      result = await database.prepare(
        `SELECT entry.id, entry.receipt_id, settlement.receipt_hash,
                settlement.payload_hash AS settlement_payload_hash,
                settlement.canonical_payload AS settlement_canonical_payload,
                settlement.settled_at,
                entry.person_id, entry.category, entry.units, entry.reason_key,
                entry.source_receipt_id, entry.policy_version, entry.unit,
                entry.payload_hash AS entry_payload_hash,
                entry.canonical_payload AS entry_canonical_payload,
                entry.occurred_at
         FROM receipt_credit_entries AS entry
         INNER JOIN receipt_credit_settlements AS settlement ON settlement.receipt_id = entry.receipt_id
         WHERE entry.person_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM contribution_receipt_lifecycle_events AS lifecycle
             WHERE lifecycle.receipt_id = entry.receipt_id
               AND lifecycle.event_type IN ('retracted','superseded')
           )
         ORDER BY entry.occurred_at ASC, entry.id ASC
         LIMIT 1000`,
      ).bind(personId).all<CreditRow>();
    } catch (error) {
      if (error instanceof Error && /no such table:\s*receipt_credit_(entries|settlements)/i.test(error.message)) {
        throw new ReceiptCreditSchemaUnavailableError();
      }
      throw error;
    }
    const rows = result.results ?? [];
    const receipts = new Map<string, { receiptHash: string; settledAt: string; payloadHash: string; canonicalPayload: string }>();
    const categoryUnits = new Map<ReceiptCreditCategory, number>();
    for (const row of rows) {
      await assertEntryIntegrity(row);
      const existing = receipts.get(row.receipt_id);
      const settlement = {
        receiptHash: row.receipt_hash,
        settledAt: row.settled_at,
        payloadHash: row.settlement_payload_hash,
        canonicalPayload: row.settlement_canonical_payload,
      };
      if (existing && canonicalJson(existing) !== canonicalJson(settlement)) throw new ReceiptCreditIntegrityError();
      receipts.set(row.receipt_id, settlement);
      categoryUnits.set(row.category, (categoryUnits.get(row.category) ?? 0) + Number(row.units));
    }
    const reader = getContributionReceiptReaderFor(database);
    for (const [receiptId, settlement] of receipts) {
      const parsed = JSON.parse(settlement.canonicalPayload) as Record<string, unknown>;
      if (
        canonicalJson(parsed) !== settlement.canonicalPayload
        || await sha256Canonical(parsed) !== settlement.payloadHash
        || parsed.receiptId !== receiptId
        || parsed.receiptHash !== settlement.receiptHash
        || parsed.policyVersion !== receiptCreditPolicyVersion
        || parsed.unit !== receiptCreditUnit
        || parsed.settledAt !== settlement.settledAt
      ) throw new ReceiptCreditIntegrityError();
      const verified = await reader.findById(receiptId);
      if (!verified || verified.receiptHash !== settlement.receiptHash) throw new ReceiptCreditIntegrityError();
    }
    return Object.freeze({
      active: true,
      policyVersion: receiptCreditPolicyVersion,
      unit: receiptCreditUnit,
      totalUnits: [...categoryUnits.values()].reduce((sum, units) => sum + units, 0),
      settledReceipts: receipts.size,
      latestSettlementAt: [...receipts.values()].map((entry) => entry.settledAt).sort().at(-1) ?? null,
      categories: Object.freeze([...categoryUnits.entries()]
        .map(([category, units]) => Object.freeze({ category, units }))
        .sort((left, right) => right.units - left.units || left.category.localeCompare(right.category))),
    });
  }
}

const repository = new D1ReceiptCreditRepository();

export function getReceiptCreditRepository(): ReceiptCreditRepository {
  return repository;
}

export function emptyReceiptCreditSummary(): PublicReceiptCreditSummary {
  return Object.freeze({
    active: false,
    policyVersion: receiptCreditPolicyVersion,
    unit: receiptCreditUnit,
    totalUnits: 0,
    settledReceipts: 0,
    latestSettlementAt: null,
    categories: Object.freeze([]),
  });
}

async function assertEntryIntegrity(row: CreditRow) {
  let entry: Record<string, unknown>;
  try { entry = JSON.parse(row.entry_canonical_payload) as Record<string, unknown>; } catch { throw new ReceiptCreditIntegrityError(); }
  if (
    canonicalJson(entry) !== row.entry_canonical_payload
    || await sha256Canonical(entry) !== row.entry_payload_hash
    || entry.receiptId !== row.receipt_id
    || entry.personId !== row.person_id
    || entry.category !== row.category
    || entry.units !== row.units
    || entry.reasonKey !== row.reason_key
    || entry.sourceReceiptId !== row.source_receipt_id
    || entry.policyVersion !== row.policy_version
    || entry.unit !== row.unit
    || entry.occurredAt !== row.occurred_at
    || row.policy_version !== receiptCreditPolicyVersion
    || row.unit !== receiptCreditUnit
  ) throw new ReceiptCreditIntegrityError();
}
