import { getD1, getSharedResearchD1 } from "@/db";
import {
  assertContributionReceiptPolicy,
  contributionReceiptHash,
  normalizeContributionReceipt,
  verifyContributionReceiptSignature,
} from "@/packages/protocol/contribution-receipt.mjs";
import {
  normalizeContributionReceiptLifecycleEvent,
  verifyContributionReceiptLifecycleEventSignature,
} from "@/packages/protocol/contribution-receipt-lifecycle.mjs";
import { D1ContributionReceiptIssuerKeyStore } from "@/services/receipts/d1-contribution-receipt-issuer-key-store.mjs";

export type ContributionReceiptKind =
  | "formalization"
  | "lemma"
  | "proof_patch"
  | "counterexample"
  | "verification"
  | "synthesis"
  | "infrastructure";

export type PublicContributionReceipt = Readonly<{
  protocolVersion: "pw-contribution-receipt-v1";
  id: string;
  kind: ContributionReceiptKind;
  beneficiary: Readonly<{
    personId: string;
    agentId: string;
    delegationCertificateId: string;
  }>;
  attempt: Readonly<{
    id: string;
    personId: string;
    agentId: string;
    delegationCertificateId: string;
    problemRevisionId: string;
  }>;
  target: Readonly<{ declaration: string; statementHash: string }>;
  artifactBundleHash: string;
  bundle: Readonly<{
    manifestHash: string;
    dependencyReceipts: readonly Readonly<{ receiptId: string; receiptHash: string }>[];
  }>;
  run: Readonly<{
    id: string;
    requestHash: string;
    resultHash: string;
    status: "succeeded";
    kernelStatus: "accepted";
  }>;
  claims: readonly Readonly<{
    claimType: string;
    verificationAttestationId: string;
    verificationAttestationHash: string;
    artifactBundleHash: string;
    reviewerPersonId: string;
    reviewerAgentId: string;
    reviewerDelegationCertificateId: string;
    decision: "attested";
  }>[];
  issuedAt: string;
  policyVersion: "pw-receipt-policy-v1";
  issuerKeyId: string;
  issuerPublicKey: string;
  payloadHash: string;
  issuerSignature: string;
}>;

export type PublicContributionReceiptRecord = Readonly<{
  receipt: PublicContributionReceipt;
  receiptHash: string;
}>;

export type PublicContributionReceiptDependency = Readonly<{
  receiptId: string;
  receiptHash: string;
  kind: ContributionReceiptKind;
  target: Readonly<{ declaration: string; statementHash: string }>;
  issuedAt: string;
  recordedAt: string;
}>;

export type PublicContributionReceiptLifecycleEvent = Readonly<{
  protocolVersion: "pw-contribution-receipt-lifecycle-event-v1";
  id: string;
  receiptId: string;
  eventType: "corrected" | "superseded" | "retracted";
  replacementReceiptId: string | null;
  reasonHash: string;
  occurredAt: string;
  issuerKeyId: string;
  issuerPublicKey: string;
  payloadHash: string;
  issuerSignature: string;
}>;

export type PublicContributionReceiptIndexItem = Readonly<{
  id: string;
  receiptHash: string;
  kind: ContributionReceiptKind;
  target: Readonly<{ declaration: string; statementHash: string }>;
  beneficiaryPersonId: string;
  issuedAt: string;
  dependencyCount: number;
  lifecycleStatus: "issued" | PublicContributionReceiptLifecycleEvent["eventType"];
}>;

export type PublicContributionReceiptIssuerKey = Readonly<{
  id: string;
  publicKey: string;
  status: "active" | "retired" | "revoked";
  validFrom: string;
  retiredAt: string | null;
  revokedAt: string | null;
}>;

export class ContributionReceiptIntegrityError extends Error {
  constructor() {
    super("Stored Contribution Receipt did not pass its canonical hash and issuer-signature checks.");
    this.name = "ContributionReceiptIntegrityError";
  }
}

export interface ContributionReceiptReader {
  findById(id: string): Promise<PublicContributionReceiptRecord | null>;
  listRecent(limit?: number): Promise<readonly PublicContributionReceiptIndexItem[]>;
  listByPerson(personId: string, limit?: number): Promise<readonly PublicContributionReceiptIndexItem[]>;
  findDependenciesById(id: string): Promise<readonly PublicContributionReceiptDependency[] | null>;
  findLifecycleById(id: string): Promise<readonly PublicContributionReceiptLifecycleEvent[] | null>;
  listIssuerKeys(): Promise<readonly PublicContributionReceiptIssuerKey[]>;
}

type ReceiptRow = {
  id: string;
  receipt_hash: string;
  canonical_receipt: string;
};

type DependencyRow = {
  upstream_receipt_id: string;
  upstream_receipt_hash: string;
  declared_by_bundle_manifest_hash: string;
  recorded_at: string;
  receipt_hash: string;
  canonical_receipt: string;
};

type LifecycleRow = {
  id: string;
  receipt_id: string;
  event_type: PublicContributionReceiptLifecycleEvent["eventType"];
  replacement_receipt_id: string | null;
  reason_hash: string;
  occurred_at: string;
  issuer_key_id: string;
  issuer_public_key: string;
  canonical_payload: string;
  payload_hash: string;
  issuer_signature: string;
};

/**
 * Public reads are deliberately stricter than a raw D1 lookup: a page or API
 * never presents a receipt unless its stored canonical payload, full hash, and
 * embedded issuer signature agree.
 */
class D1ContributionReceiptReader implements ContributionReceiptReader {
  constructor(private readonly database: ReturnType<typeof getD1> = getD1()) {}

  async listIssuerKeys(): Promise<readonly PublicContributionReceiptIssuerKey[]> {
    const keys = await new D1ContributionReceiptIssuerKeyStore(this.database).list();
    return Object.freeze(keys.map((key: PublicContributionReceiptIssuerKey) => Object.freeze({ ...key })));
  }

  async findById(id: string): Promise<PublicContributionReceiptRecord | null> {
    if (!isContributionReceiptId(id)) return null;

    const row = await this.database
      .prepare(
        `SELECT receipt.id, receipt.receipt_hash, receipt.canonical_receipt
         FROM contribution_receipts AS receipt
         INNER JOIN contribution_receipt_publications AS publication
           ON publication.receipt_id = receipt.id
         WHERE receipt.id = ?
           AND publication.record_class = 'research'
           AND publication.visibility = 'public'`,
      )
      .bind(id)
      .first<ReceiptRow>();
    if (!row) return null;

    return verifyStoredReceiptRow(row, id, this.database);
  }

  async listRecent(limit = 24): Promise<readonly PublicContributionReceiptIndexItem[]> {
    const boundedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 48) : 24;
    const result = await this.database
      .prepare(
        `SELECT receipt.id, receipt.receipt_hash, receipt.canonical_receipt
         FROM contribution_receipts AS receipt
         INNER JOIN contribution_receipt_publications AS publication
           ON publication.receipt_id = receipt.id
         WHERE publication.record_class = 'research'
           AND publication.visibility = 'public'
         ORDER BY receipt.issued_at DESC, receipt.id ASC
         LIMIT ?`,
      )
      .bind(boundedLimit)
      .all<ReceiptRow>();
    const items = await Promise.all((result.results ?? []).map((row: ReceiptRow) => this.toIndexItem(row)));
    return Object.freeze(items);
  }

  async listByPerson(personId: string, limit = 48): Promise<readonly PublicContributionReceiptIndexItem[]> {
    if (!isPersonId(personId)) return Object.freeze([]);
    const boundedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 48;
    const result = await this.database
      .prepare(
        `SELECT receipt.id, receipt.receipt_hash, receipt.canonical_receipt
         FROM contribution_receipts AS receipt
         INNER JOIN contribution_receipt_publications AS publication
           ON publication.receipt_id = receipt.id
         WHERE receipt.beneficiary_person_id = ?
           AND publication.record_class = 'research'
           AND publication.visibility = 'public'
         ORDER BY receipt.issued_at DESC, receipt.id ASC
         LIMIT ?`,
      )
      .bind(personId, boundedLimit)
      .all<ReceiptRow>();
    const items = await Promise.all((result.results ?? []).map((row: ReceiptRow) => this.toIndexItem(row)));
    return Object.freeze(items);
  }

  async findDependenciesById(id: string): Promise<readonly PublicContributionReceiptDependency[] | null> {
    const downstream = await this.findById(id);
    if (!downstream) return null;

    const result = await this.database
      .prepare(
        `SELECT
           edge.upstream_receipt_id, edge.upstream_receipt_hash,
           edge.declared_by_bundle_manifest_hash, edge.recorded_at,
           upstream.receipt_hash, upstream.canonical_receipt
         FROM contribution_receipt_dependency_edges AS edge
         INNER JOIN contribution_receipts AS upstream
           ON upstream.id = edge.upstream_receipt_id
         INNER JOIN contribution_receipt_publications AS publication
           ON publication.receipt_id = upstream.id
         WHERE edge.downstream_receipt_id = ?
           AND publication.record_class = 'research'
           AND publication.visibility = 'public'
         ORDER BY edge.upstream_receipt_id ASC`,
      )
      .bind(id)
      .all<DependencyRow>();
    const rows = result.results ?? [];
    const declared = new Map(
      downstream.receipt.bundle.dependencyReceipts.map((dependency) => [
        dependency.receiptId,
        dependency.receiptHash,
      ]),
    );
    if (rows.length !== declared.size) throw new ContributionReceiptIntegrityError();

    const dependencies = await Promise.all(rows.map(async (row: DependencyRow) => {
      const declaredHash = declared.get(row.upstream_receipt_id);
      const upstream = parseCanonicalReceipt(row.canonical_receipt);
      try {
        if (
          !declaredHash ||
          row.upstream_receipt_hash !== declaredHash ||
          row.receipt_hash !== declaredHash ||
          row.declared_by_bundle_manifest_hash !== downstream.receipt.artifactBundleHash ||
          row.recorded_at !== downstream.receipt.issuedAt ||
          upstream.id !== row.upstream_receipt_id ||
          row.receipt_hash !== await contributionReceiptHash(upstream) ||
          Date.parse(upstream.issuedAt) > Date.parse(downstream.receipt.issuedAt)
        ) {
          throw new Error("dependency projection mismatch");
        }
        await assertHistoricallyTrustedReceipt(upstream, this.database);
      } catch {
        throw new ContributionReceiptIntegrityError();
      }
      return Object.freeze({
        receiptId: upstream.id,
        receiptHash: row.receipt_hash,
        kind: upstream.kind,
        target: Object.freeze({ ...upstream.target }),
        issuedAt: upstream.issuedAt,
        recordedAt: row.recorded_at,
      });
    }));
    return Object.freeze(dependencies);
  }

  async findLifecycleById(id: string): Promise<readonly PublicContributionReceiptLifecycleEvent[] | null> {
    const receipt = await this.findById(id);
    if (!receipt) return null;
    const result = await this.database
      .prepare(
        `SELECT id, receipt_id, event_type, replacement_receipt_id, reason_hash,
                occurred_at, issuer_key_id, issuer_public_key, canonical_payload,
                payload_hash, issuer_signature
         FROM contribution_receipt_lifecycle_events
         WHERE receipt_id = ?
         ORDER BY occurred_at ASC, id ASC`,
      )
      .bind(id)
      .all<LifecycleRow>();
    const events: PublicContributionReceiptLifecycleEvent[] = [];
    for (const row of result.results ?? []) {
      const event = parseCanonicalLifecycleEvent(row.canonical_payload);
      try {
        if (
          event.id !== row.id ||
          event.receiptId !== row.receipt_id ||
          event.eventType !== row.event_type ||
          event.replacementReceiptId !== row.replacement_receipt_id ||
          event.reasonHash !== row.reason_hash ||
          event.occurredAt !== row.occurred_at ||
          event.issuerKeyId !== row.issuer_key_id ||
          event.issuerPublicKey !== row.issuer_public_key ||
          event.payloadHash !== row.payload_hash ||
          event.issuerSignature !== row.issuer_signature ||
          Date.parse(event.occurredAt) < Date.parse(receipt.receipt.issuedAt) ||
          !await verifyContributionReceiptLifecycleEventSignature(event)
        ) {
          throw new Error("lifecycle event projection mismatch");
        }
        await assertHistoricallyTrustedIssuer({
          issuerKeyId: event.issuerKeyId,
          issuerPublicKey: event.issuerPublicKey,
          occurredAt: event.occurredAt,
        }, this.database);
        if (event.replacementReceiptId) {
          const replacement = await this.findById(event.replacementReceiptId);
          if (
            !replacement ||
            replacement.receipt.attempt.id !== receipt.receipt.attempt.id ||
            replacement.receipt.target.declaration !== receipt.receipt.target.declaration ||
            replacement.receipt.target.statementHash !== receipt.receipt.target.statementHash ||
            Date.parse(replacement.receipt.issuedAt) <= Date.parse(receipt.receipt.issuedAt) ||
            Date.parse(replacement.receipt.issuedAt) > Date.parse(event.occurredAt)
          ) {
            throw new Error("lifecycle replacement mismatch");
          }
        }
      } catch {
        throw new ContributionReceiptIntegrityError();
      }
      events.push(Object.freeze(event));
    }
    assertLifecycleSequence(events);
    await this.assertNoLifecycleReplacementCycle(id);
    return Object.freeze(events);
  }

  private async assertNoLifecycleReplacementCycle(receiptId: string) {
    const pending: Array<{ id: string; path: ReadonlySet<string> }> = [{ id: receiptId, path: new Set() }];
    let traversed = 0;
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) continue;
      if (current.path.has(current.id)) throw new ContributionReceiptIntegrityError();
      traversed += 1;
      if (traversed > 512) throw new ContributionReceiptIntegrityError();
      const path = new Set(current.path);
      path.add(current.id);
      const result = await this.database
        .prepare(
          `SELECT replacement_receipt_id
           FROM contribution_receipt_lifecycle_events
           WHERE receipt_id = ? AND replacement_receipt_id IS NOT NULL`,
        )
        .bind(current.id)
        .all<{ replacement_receipt_id: string }>();
      for (const row of result.results ?? []) {
        pending.push({ id: row.replacement_receipt_id, path });
      }
    }
  }

  private async toIndexItem(row: ReceiptRow): Promise<PublicContributionReceiptIndexItem> {
    const record = await verifyStoredReceiptRow(row, row.id, this.database);
    const lifecycle = await this.findLifecycleById(record.receipt.id);
    if (!lifecycle) throw new ContributionReceiptIntegrityError();
    const latest = lifecycle.at(-1);
    return Object.freeze({
      id: record.receipt.id,
      receiptHash: record.receiptHash,
      kind: record.receipt.kind,
      target: Object.freeze({ ...record.receipt.target }),
      beneficiaryPersonId: record.receipt.beneficiary.personId,
      issuedAt: record.receipt.issuedAt,
      dependencyCount: record.receipt.bundle.dependencyReceipts.length,
      lifecycleStatus: latest?.eventType ?? "issued",
    });
  }
}

export function getContributionReceiptReader(): ContributionReceiptReader {
  return new D1ContributionReceiptReader(getSharedResearchD1());
}

export function getContributionReceiptReaderFor(database: ReturnType<typeof getD1>): ContributionReceiptReader {
  return new D1ContributionReceiptReader(database);
}

function parseStoredReceipt(row: ReceiptRow): PublicContributionReceipt {
  return parseCanonicalReceipt(row.canonical_receipt);
}

async function verifyStoredReceiptRow(
  row: ReceiptRow,
  expectedId: string,
  database: ReturnType<typeof getD1>,
): Promise<PublicContributionReceiptRecord> {
  const receipt = parseStoredReceipt(row);
  try {
    if (
      receipt.id !== expectedId ||
      row.id !== expectedId ||
      row.receipt_hash !== await contributionReceiptHash(receipt) ||
      !await verifyContributionReceiptSignature(receipt)
    ) {
      throw new ContributionReceiptIntegrityError();
    }
    await assertHistoricallyTrustedReceipt(receipt, database);
  } catch {
    throw new ContributionReceiptIntegrityError();
  }
  return Object.freeze({ receipt, receiptHash: row.receipt_hash });
}

async function assertHistoricallyTrustedReceipt(
  receipt: PublicContributionReceipt,
  database: ReturnType<typeof getD1>,
) {
  if (!await verifyContributionReceiptSignature(receipt)) {
    throw new ContributionReceiptIntegrityError();
  }
  await assertHistoricallyTrustedIssuer({
    issuerKeyId: receipt.issuerKeyId,
    issuerPublicKey: receipt.issuerPublicKey,
    occurredAt: receipt.issuedAt,
  }, database);
  assertContributionReceiptPolicy(receipt);
}

async function assertHistoricallyTrustedIssuer({
  issuerKeyId,
  issuerPublicKey,
  occurredAt,
}: Readonly<{ issuerKeyId: string; issuerPublicKey: string; occurredAt: string }>, database: ReturnType<typeof getD1>) {
  await new D1ContributionReceiptIssuerKeyStore(database).assertHistoricallyTrusted({
    issuerKeyId,
    issuerPublicKey,
    occurredAt,
  });
}

function parseCanonicalReceipt(canonicalReceipt: string): PublicContributionReceipt {
  try {
    return normalizeContributionReceipt(
      JSON.parse(canonicalReceipt),
    ) as unknown as PublicContributionReceipt;
  } catch {
    throw new ContributionReceiptIntegrityError();
  }
}

function parseCanonicalLifecycleEvent(canonicalPayload: string): PublicContributionReceiptLifecycleEvent {
  try {
    return normalizeContributionReceiptLifecycleEvent(
      JSON.parse(canonicalPayload),
    ) as unknown as PublicContributionReceiptLifecycleEvent;
  } catch {
    throw new ContributionReceiptIntegrityError();
  }
}

function assertLifecycleSequence(events: readonly PublicContributionReceiptLifecycleEvent[]) {
  let corrected = false;
  let terminal = false;
  for (const event of events) {
    if (terminal) throw new ContributionReceiptIntegrityError();
    if (event.eventType === "corrected") {
      if (corrected) throw new ContributionReceiptIntegrityError();
      corrected = true;
      continue;
    }
    if (event.eventType === "superseded") {
      if (corrected) throw new ContributionReceiptIntegrityError();
      terminal = true;
      continue;
    }
    terminal = true;
  }
}

function isContributionReceiptId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9:._-]{2,239}$/.test(value);
}

function isPersonId(value: string): boolean {
  return /^person:[A-Za-z0-9][A-Za-z0-9:._-]{1,232}$/.test(value);
}
