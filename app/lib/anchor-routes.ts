import {
  AnchorAdapterConfigurationError,
  adapterRegistryFromConfig,
  resolveAdapter,
} from "../../services/anchoring/anchor-chain-adapter.mjs";
import { D1AnchorStore } from "../../services/anchoring/d1-anchor-store.mjs";
import { verifyAnchorRecord } from "../../services/anchoring/anchor-verifier.mjs";
import { delegationValidityAt } from "../../packages/domain/delegation.mjs";
import {
  anchorLeafHash,
  anchorLeafProtocolVersion,
  anchorRecordTypes,
} from "../../packages/protocol/anchor-leaf.mjs";
import {
  anchorManifestHash,
  anchorManifestProtocolVersion,
  verifyAnchorManifest,
} from "../../packages/protocol/anchor-manifest.mjs";
import { canonicalUtf8 } from "../../packages/protocol/canonical-json.mjs";
import { verifyAnchorWitnessSignature } from "../../packages/protocol/anchor-witness.mjs";
import type { DelegationProfile, StoredDelegation } from "@/db/repositories/delegation";

export const anchoringDisabledStatus = "anchoring_disabled";

export type AnchorManifestBucket = Readonly<{
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<unknown>;
}>;

export type AnchorBatchRow = Readonly<{
  id: string;
  status: string;
  root: string;
  leaf_count: number;
  manifest_hash: string;
  manifest_key: string;
  prev_batch_id: string | null;
  prev_root: string | null;
  chain: string;
  network: string;
  witness_count: number;
  created_at: string;
  anchored_at: string | null;
}>;

export type AnchorSubmissionRow = Readonly<{
  submitter_kind: string;
  submitter_id: string;
  chain: string;
  network: string;
  tx_ref: string;
  status: string;
  confirmations: number;
  submitted_at: string;
}>;

export type AnchorManifestRecord = Readonly<{
  protocolVersion: string;
  batchId: string;
  root: string;
  leafCount: number;
  prevBatchId: string | null;
  prevRoot: string | null;
  createdAt: string;
  leaves: readonly Readonly<{ recordType: string; recordId: string; recordHash: string }>[];
}>;

export type AnchorBatchSummary = Readonly<{
  id: string;
  status: string;
  root: string;
  leafCount: number;
  manifestHash: string;
  prevBatchId: string | null;
  prevRoot: string | null;
  chain: string;
  network: string;
  witnessCount: number;
  witnessState: "witnessed" | "none";
  createdAt: string;
  anchoredAt: string | null;
}>;

export type AnchorSubmissionSummary = Readonly<{
  submitterKind: string;
  submitterId: string;
  chain: string;
  network: string;
  txRef: string;
  status: string;
  confirmations: number;
  submittedAt: string;
}>;

export type AnchorProofBatch = Readonly<{
  id: string;
  status: string;
  chain: string;
  network: string;
  txRefs: readonly string[];
}>;

export type AnchorLeafView = Readonly<{
  recordType: string;
  recordId: string;
  recordHash: string;
}>;

export type WitnessAuthorityCandidate = Readonly<{
  submitterId: string;
  publicKey: string;
}>;

export type WitnessAuthority = Readonly<{
  submitterId: string;
  publicKey: string;
}>;

export type WitnessAuthorityVerifier = (
  input: Readonly<{ payload: unknown; signature: unknown }>,
) => Promise<WitnessAuthority>;

export type AnchorCoordinatorSettings = Readonly<{
  minLeafCount: number;
  maxIntervalSeconds: number;
  confirmationThreshold: number;
}>;

export type AnchorBatchListPagination = Readonly<{
  limit: number;
  offset: number;
  total: number;
}>;

export type AnchorBatchListResult =
  | Readonly<{ status: typeof anchoringDisabledStatus; batches: readonly AnchorBatchSummary[]; pagination?: undefined }>
  | Readonly<{ status: "ok"; batches: readonly AnchorBatchSummary[]; pagination: AnchorBatchListPagination }>;

export type AnchorManifestResult =
  | Readonly<{ status: typeof anchoringDisabledStatus }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "integrity_error" }>
  | Readonly<{ status: "ok"; manifest: AnchorManifestRecord; source: "bucket" | "rebuilt" }>;

export type AnchorProofResult =
  | Readonly<{ status: "invalid_request"; message: string }>
  | Readonly<{ status: typeof anchoringDisabledStatus }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{
      status: "mismatch";
      reason?: string;
      leaf: AnchorLeafView;
      leafHash: string;
      root: string | null;
      batch: AnchorProofBatch | null;
      submissions: readonly AnchorSubmissionSummary[];
    }>
  | Readonly<{
      status: "pending";
      reason?: string;
      leaf: AnchorLeafView;
      leafHash: string;
      root: string | null;
      index?: number;
      proof?: unknown;
      batch: AnchorProofBatch | null;
      submissions: readonly AnchorSubmissionSummary[];
    }>;

export type WitnessSubmissionTarget =
  | Readonly<{ status: "unknown_batch" }>
  | Readonly<{ status: "adapter_not_configured" }>
  | Readonly<{ status: "ok"; batch: AnchorBatchRow; adapter: unknown }>;

export type AnchorAdapterFactories = Record<string, (config: unknown) => unknown>;

export function anchorAdaptersConfigured(configsJson: unknown): boolean {
  return typeof configsJson === "string" && configsJson.trim().length > 0;
}

export async function buildAnchorAdapterRegistry(
  configsJson: unknown,
  factories?: AnchorAdapterFactories,
): Promise<Map<string, unknown> | null> {
  const raw = typeof configsJson === "string" ? configsJson.trim() : "";
  if (!raw) return null;
  let configs: unknown;
  try {
    configs = JSON.parse(raw);
  } catch {
    throw new AnchorAdapterConfigurationError(
      "ANCHOR_ADAPTERS_JSON must be a JSON array of adapter configurations.",
    );
  }
  if (!Array.isArray(configs)) {
    throw new AnchorAdapterConfigurationError(
      "ANCHOR_ADAPTERS_JSON must be a JSON array of adapter configurations.",
    );
  }
  const resolvedFactories = factories ?? await defaultAnchorAdapterFactories(configs);
  const pending = adapterRegistryFromConfig(configs, resolvedFactories);
  const registry = new Map<string, unknown>();
  for (const [key, adapter] of pending) {
    registry.set(key, await adapter);
  }
  return registry;
}

async function defaultAnchorAdapterFactories(configs: readonly unknown[]): Promise<AnchorAdapterFactories> {
  const factories: AnchorAdapterFactories = {};
  if (configs.some((config) => (config as { id?: unknown } | null)?.id === "evm")) {
    const { createEvmAnchorAdapter } = await import("../../services/anchoring/evm-anchor-adapter.mjs");
    factories.evm = createEvmAnchorAdapter as (config: unknown) => unknown;
  }
  if (configs.some((config) => (config as { id?: unknown } | null)?.id === "tron")) {
    const { createTronAnchorAdapter } = await import("../../services/anchoring/tron-anchor-adapter.mjs");
    factories.tron = createTronAnchorAdapter as (config: unknown) => unknown;
  }
  return factories;
}

export async function detectAnchoringState({ store, adaptersConfigured }: Readonly<{
  store: D1AnchorStore;
  adaptersConfigured: boolean;
}>): Promise<"anchoring_disabled" | "enabled"> {
  if (adaptersConfigured) return "enabled";
  const rows = await store.listBatches({ limit: 1 });
  return rows.length === 0 ? "anchoring_disabled" : "enabled";
}

export class AnchorListQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnchorListQueryError";
  }
}

const anchorBatchStatuses = new Set(["built", "submitted", "confirmed", "failed"]);
const anchorWitnessStates = new Set(["witnessed", "none"]);
const anchorListDefaultLimit = 50;
const anchorListMaxLimit = 200;
const anchorWitnessDefaultThreshold = 1;

export type AnchorBatchListQuery = Readonly<{
  limit?: number | string;
  offset?: number | string;
  status?: string;
  witnessState?: string;
}>;

/** Parse ANCHOR_WITNESS_THRESHOLD with a safe fallback (default 1). */
export function witnessThresholdFromSettings(value: unknown): number {
  const threshold = Number(value);
  if (!Number.isInteger(threshold) || threshold < 0) return anchorWitnessDefaultThreshold;
  return threshold;
}

function deriveWitnessState(witnessCount: number, witnessThreshold: number): "witnessed" | "none" {
  return witnessCount >= witnessThreshold ? "witnessed" : "none";
}

/** Parse and validate /api/anchors list query params; throws AnchorListQueryError on invalid input. */
export function parseAnchorBatchListQuery(query: AnchorBatchListQuery): Readonly<{
  limit: number;
  offset: number;
  status?: string;
  witnessState?: string;
}> {
  let limit = anchorListDefaultLimit;
  if (query.limit !== undefined) {
    limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > anchorListMaxLimit) {
      throw new AnchorListQueryError(`limit must be an integer between 1 and ${anchorListMaxLimit}.`);
    }
  }
  let offset = 0;
  if (query.offset !== undefined) {
    offset = Number(query.offset);
    if (!Number.isInteger(offset) || offset < 0) {
      throw new AnchorListQueryError("offset must be a non-negative integer.");
    }
  }
  let status: string | undefined;
  if (query.status !== undefined) {
    status = String(query.status);
    if (!anchorBatchStatuses.has(status)) {
      throw new AnchorListQueryError(`status must be one of ${[...anchorBatchStatuses].join(", ")}.`);
    }
  }
  let witnessState: string | undefined;
  if (query.witnessState !== undefined) {
    witnessState = String(query.witnessState);
    if (!anchorWitnessStates.has(witnessState)) {
      throw new AnchorListQueryError(`witnessState must be one of ${[...anchorWitnessStates].join(", ")}.`);
    }
  }
  return Object.freeze({ limit, offset, status, witnessState });
}

export async function listPublicAnchorBatches({ store, adaptersConfigured, query, witnessThreshold = anchorWitnessDefaultThreshold }: Readonly<{
  store: D1AnchorStore;
  adaptersConfigured: boolean;
  query?: AnchorBatchListQuery;
  witnessThreshold?: number;
}>): Promise<AnchorBatchListResult> {
  const state = await detectAnchoringState({ store, adaptersConfigured });
  if (state === "anchoring_disabled") {
    return { status: anchoringDisabledStatus, batches: Object.freeze([]) };
  }
  const parsed = parseAnchorBatchListQuery(query ?? {});
  // 见证状态筛选转成 witness_count 的 min/max（witnessed: >=K；none: <K）
  const witnessMin = parsed.witnessState === "witnessed" ? witnessThreshold : undefined;
  const witnessMax = parsed.witnessState === "none" ? witnessThreshold - 1 : undefined;
  const [rows, total] = await Promise.all([
    store.listBatches({
      limit: parsed.limit, offset: parsed.offset, status: parsed.status, witnessMin, witnessMax,
    }),
    store.countBatches({ status: parsed.status, witnessMin, witnessMax }),
  ]);
  return {
    status: "ok",
    batches: Object.freeze((rows as AnchorBatchRow[]).map((row) => toBatchSummary(row, witnessThreshold))),
    pagination: Object.freeze({ limit: parsed.limit, offset: parsed.offset, total }),
  };
}

export async function loadAnchorManifest({ store, bucket, batchId, adaptersConfigured }: Readonly<{
  store: D1AnchorStore;
  bucket: AnchorManifestBucket | null | undefined;
  batchId: string;
  adaptersConfigured: boolean;
}>): Promise<AnchorManifestResult> {
  const batch = (await store.getBatch(batchId)) as AnchorBatchRow | null;
  if (!batch) {
    const state = await detectAnchoringState({ store, adaptersConfigured });
    return state === "anchoring_disabled" ? { status: anchoringDisabledStatus } : { status: "not_found" };
  }
  if (bucket) {
    const stored = await readStoredManifest(bucket, batch.manifest_key);
    if (stored && await manifestMatchesBatch(stored, batch)) {
      return { status: "ok", manifest: stored, source: "bucket" };
    }
  }
  const manifest = {
    protocolVersion: anchorManifestProtocolVersion,
    batchId: batch.id,
    root: batch.root,
    leafCount: Number(batch.leaf_count),
    prevBatchId: batch.prev_batch_id,
    prevRoot: batch.prev_root,
    createdAt: batch.created_at,
    leaves: await store.listManifestLeaves(batch.id),
  };
  const manifestHash = await anchorManifestHash(manifest);
  if (manifestHash !== batch.manifest_hash || !(await verifyAnchorManifest(manifest))) {
    return { status: "integrity_error" };
  }
  return { status: "ok", manifest, source: "rebuilt" };
}

export async function computeAnchorProof({ store, adaptersConfigured, type, recordId, recordHash }: Readonly<{
  store: D1AnchorStore;
  adaptersConfigured: boolean;
  type: unknown;
  recordId: unknown;
  recordHash: unknown;
}>): Promise<AnchorProofResult> {
  if (typeof type !== "string" || !anchorRecordTypes.includes(type)) {
    return {
      status: "invalid_request",
      message: `type must be one of ${anchorRecordTypes.join(", ")}.`,
    };
  }
  if (typeof recordId !== "string" || recordId.length === 0 || recordId.length > 256) {
    return {
      status: "invalid_request",
      message: "recordId must be a non-empty string of at most 256 characters.",
    };
  }
  if (typeof recordHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(recordHash)) {
    return { status: "invalid_request", message: "recordHash must be sha256:<hex>." };
  }
  const state = await detectAnchoringState({ store, adaptersConfigured });
  if (state === "anchoring_disabled") return { status: anchoringDisabledStatus };

  const leaf: AnchorLeafView = { recordType: type, recordId, recordHash };
  const leafHash = await anchorLeafHash({ protocolVersion: anchorLeafProtocolVersion, ...leaf });
  const result = await verifyAnchorRecord({
    recordType: type,
    record: { id: recordId },
    hasher: async () => recordHash,
    store,
    adapter: undefined,
  });
  if (result.status === "unanchored") return { status: "not_found" };

  const batchId: string | null = result.batchId
    ?? ((await store.findRecord({ recordType: type, recordId, recordHash })) as { batch_id: string | null } | null)?.batch_id
    ?? null;
  const batchRow = batchId ? (await store.getBatch(batchId)) as AnchorBatchRow | null : null;
  const submissionRows = batchRow
    ? (await store.listSubmissions(batchRow.id)) as AnchorSubmissionRow[]
    : [];
  const batch: AnchorProofBatch | null = batchRow
    ? Object.freeze({
        id: batchRow.id,
        status: batchRow.status,
        chain: batchRow.chain,
        network: batchRow.network,
        txRefs: Object.freeze(submissionRows.map((row) => row.tx_ref)),
      })
    : null;
  const submissions = Object.freeze(submissionRows.map(toSubmissionSummary));
  const shared = { leaf, leafHash, root: batchRow?.root ?? null, batch, submissions };
  if (result.status === "mismatch") {
    return {
      status: "mismatch",
      ...(result.reason ? { reason: result.reason } : {}),
      ...shared,
    };
  }
  return {
    status: "pending",
    ...(result.reason ? { reason: result.reason } : {}),
    ...(typeof result.index === "number" ? { index: result.index } : {}),
    ...(result.proof ? { proof: result.proof } : {}),
    ...shared,
  };
}

export async function resolveWitnessSubmissionTarget({ store, registry, batchId }: Readonly<{
  store: D1AnchorStore;
  registry: Map<string, unknown> | null;
  batchId: string;
}>): Promise<WitnessSubmissionTarget> {
  const batch = (await store.getBatch(batchId)) as AnchorBatchRow | null;
  if (!batch) return { status: "unknown_batch" };
  if (!registry) return { status: "adapter_not_configured" };
  try {
    return {
      status: "ok",
      batch,
      adapter: resolveAdapter({ registry, chain: batch.chain, network: batch.network }),
    };
  } catch (error) {
    if (error instanceof AnchorAdapterConfigurationError) return { status: "adapter_not_configured" };
    throw error;
  }
}

export class WitnessAuthorityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WitnessAuthorityError";
  }
}

export function witnessAuthorityCandidatesFromProfile({ profile, now = defaultNow }: Readonly<{
  profile: DelegationProfile;
  now?: () => string;
}>): readonly WitnessAuthorityCandidate[] {
  const eventTime = now();
  const validDelegations = profile.delegations.filter((delegation) =>
    isDelegationCurrentlyValid(delegation, eventTime));
  const candidates: WitnessAuthorityCandidate[] = [];
  if (validDelegations.length > 0) {
    for (const key of profile.signingKeys) {
      if (key.algorithm === "ed25519" && !key.revokedAt) {
        candidates.push({ submitterId: profile.person.id, publicKey: key.publicKey });
      }
    }
  }
  for (const agent of profile.agents) {
    if (agent.status !== "active" || agent.revokedAt) continue;
    const boundByValidDelegation = validDelegations.some((delegation) =>
      delegation.agentId === agent.id && delegation.agentPublicKey === agent.publicKey);
    if (boundByValidDelegation) {
      candidates.push({ submitterId: agent.id, publicKey: agent.publicKey });
    }
  }
  return Object.freeze(candidates);
}

export function createWitnessAuthorityVerifier({ candidates }: Readonly<{
  candidates: readonly WitnessAuthorityCandidate[];
}>): WitnessAuthorityVerifier {
  const verificationKeys = new Map<string, Promise<CryptoKey | null>>();
  return async function verifyWitnessAuthority({ payload, signature }) {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new WitnessAuthorityError("The witness payload must be a plain JSON object.");
    }
    if (typeof signature !== "string" || signature.length === 0) {
      throw new WitnessAuthorityError("The witness signature must be a non-empty base64url string.");
    }
    for (const candidate of candidates) {
      const key = await witnessVerificationKey(candidate.publicKey, verificationKeys);
      if (!key) continue;
      if (await verifyAnchorWitnessSignature(payload, signature, key)) {
        return { submitterId: candidate.submitterId, publicKey: candidate.publicKey };
      }
    }
    throw new WitnessAuthorityError(
      "The witness signature does not verify against a registered Person/Agent key with a valid delegation.",
    );
  };
}

export const witnessRateLimitPolicies = Object.freeze({
  submit_anchor_witness: Object.freeze({ maxRequests: 6, windowSeconds: 60 }),
});

const witnessRejectionStatusByReason = Object.freeze({
  unknown_batch: 404,
  batch_failed: 404,
  payload_mismatch: 400,
  invalid_signature: 400,
  invalid_txref: 400,
  network_mismatch: 400,
  chain_truth_mismatch: 400,
  not_independent: 403,
});

const witnessRejectionCodeByReason = Object.freeze({
  unknown_batch: "unknown_batch",
  batch_failed: "batch_failed",
  payload_mismatch: "payload_mismatch",
  invalid_signature: "invalid_signature",
  invalid_txref: "invalid_txref",
  network_mismatch: "chain_mismatch",
  chain_truth_mismatch: "chain_truth_mismatch",
  not_independent: "not_independent",
});

export function witnessRejectionHttpStatus(reason: string | undefined): number {
  return witnessRejectionStatusByReason[reason as keyof typeof witnessRejectionStatusByReason] ?? 400;
}

export function witnessRejectionErrorCode(reason: string | undefined): string {
  return witnessRejectionCodeByReason[reason as keyof typeof witnessRejectionCodeByReason] ?? "invalid_request";
}

export function anchorCoordinatorConfigFromSettings(settings: Readonly<Record<string, unknown>>): AnchorCoordinatorSettings {
  return {
    minLeafCount: positiveInt(settings.ANCHOR_BATCH_MIN_LEAVES, 100),
    maxIntervalSeconds: positiveInt(settings.ANCHOR_BATCH_MAX_INTERVAL_SECONDS, 86_400),
    confirmationThreshold: positiveInt(settings.ANCHOR_CONFIRMATION_THRESHOLD, 12),
  };
}

export function createVolatileManifestStorage(): Readonly<{
  put(manifest: unknown): Promise<{ key: string; manifestHash: string }>;
  get(key: string): Promise<unknown>;
}> {
  const entries = new Map<string, Uint8Array>();
  return {
    async put(manifest: unknown) {
      const manifestHash = await anchorManifestHash(manifest as AnchorManifestRecord);
      const key = `volatile/${manifestHash}`;
      entries.set(key, canonicalUtf8(manifest));
      return { key, manifestHash };
    },
    async get(key: string) {
      return entries.get(key) ?? null;
    },
  };
}

function toBatchSummary(row: AnchorBatchRow, witnessThreshold: number): AnchorBatchSummary {
  return {
    id: row.id,
    status: row.status,
    root: row.root,
    leafCount: Number(row.leaf_count),
    manifestHash: row.manifest_hash,
    prevBatchId: row.prev_batch_id,
    prevRoot: row.prev_root,
    chain: row.chain,
    network: row.network,
    witnessCount: Number(row.witness_count),
    witnessState: deriveWitnessState(Number(row.witness_count), witnessThreshold),
    createdAt: row.created_at,
    anchoredAt: row.anchored_at,
  };
}

function toSubmissionSummary(row: AnchorSubmissionRow): AnchorSubmissionSummary {
  return {
    submitterKind: row.submitter_kind,
    submitterId: row.submitter_id,
    chain: row.chain,
    network: row.network,
    txRef: row.tx_ref,
    status: row.status,
    confirmations: Number(row.confirmations),
    submittedAt: row.submitted_at,
  };
}

async function readStoredManifest(
  bucket: AnchorManifestBucket,
  key: string,
): Promise<AnchorManifestRecord | null> {
  let stored: unknown;
  try {
    stored = await bucket.get(key);
  } catch {
    return null;
  }
  if (stored === null || stored === undefined) return null;
  const candidate = await unwrapStoredManifest(stored);
  if (!isManifestShape(candidate)) return null;
  return candidate;
}

async function unwrapStoredManifest(stored: unknown): Promise<unknown> {
  if (typeof stored === "string") return parseJsonOrNull(stored);
  if (stored instanceof ArrayBuffer) return parseJsonOrNull(new TextDecoder().decode(new Uint8Array(stored)));
  if (stored instanceof Uint8Array) return parseJsonOrNull(new TextDecoder().decode(stored));
  const withJson = stored as { json?: unknown } | null;
  if (withJson && typeof withJson.json === "function") {
    try {
      return await (withJson.json as () => Promise<unknown>)();
    } catch {
      return null;
    }
  }
  return stored;
}

function parseJsonOrNull(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isManifestShape(value: unknown): value is AnchorManifestRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as { batchId?: unknown; root?: unknown; leaves?: unknown };
  return typeof candidate.batchId === "string"
    && typeof candidate.root === "string"
    && Array.isArray(candidate.leaves);
}

async function manifestMatchesBatch(manifest: AnchorManifestRecord, batch: AnchorBatchRow): Promise<boolean> {
  if (manifest.batchId !== batch.id) return false;
  try {
    return await anchorManifestHash(manifest) === batch.manifest_hash
      && await verifyAnchorManifest(manifest);
  } catch {
    return false;
  }
}

function isDelegationCurrentlyValid(delegation: StoredDelegation, eventTime: string): boolean {
  try {
    const certificate = {
      id: delegation.id,
      ownerPersonId: delegation.beneficiaryPersonId,
      agentId: delegation.agentId,
      agentPublicKey: delegation.agentPublicKey,
      scopes: [...delegation.scopes],
      validFrom: delegation.validFrom,
      validUntil: delegation.validUntil,
      attributionPolicy: {
        beneficiaryPersonId: delegation.beneficiaryPersonId,
        mode: "agent_delegated" as const,
      },
    };
    return delegationValidityAt(
      certificate,
      eventTime,
      earliestRevocation(delegation.revokedAt, delegation.signerKeyRevokedAt),
    ).valid;
  } catch {
    return false;
  }
}

function earliestRevocation(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

async function witnessVerificationKey(
  publicKey: string,
  cache: Map<string, Promise<CryptoKey | null>>,
): Promise<CryptoKey | null> {
  let cached = cache.get(publicKey);
  if (!cached) {
    cached = importEd25519VerificationKey(publicKey).catch(() => null);
    cache.set(publicKey, cached);
  }
  return cached;
}

async function importEd25519VerificationKey(publicKey: string): Promise<CryptoKey | null> {
  const raw = base64UrlToBytes(publicKey);
  if (raw.byteLength !== 32) return null;
  const buffer = new ArrayBuffer(raw.byteLength);
  new Uint8Array(buffer).set(raw);
  return crypto.subtle.importKey("raw", buffer, { name: "Ed25519" }, false, ["verify"]);
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultNow(): string {
  return new Date().toISOString();
}
