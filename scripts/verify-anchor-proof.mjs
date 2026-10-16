#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadEnvironmentFile } from "./lib/environment-file.mjs";
import { createRemoteLibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import { D1AnchorStore } from "../services/anchoring/d1-anchor-store.mjs";
import {
  AnchorAdapterConfigurationError,
  adapterRegistryFromConfig,
  resolveAdapter,
} from "../services/anchoring/anchor-chain-adapter.mjs";
import { verifyAnchorRecord } from "../services/anchoring/anchor-verifier.mjs";
import { artifactBundleHash } from "../packages/protocol/artifact-bundle.mjs";
import { contributionReceiptHash } from "../packages/protocol/contribution-receipt.mjs";
import { researchCheckpointHash } from "../packages/protocol/research-checkpoint.mjs";

const recordTypeContracts = {
  contribution_receipt: { anchorType: "contribution_receipt", hasher: contributionReceiptHash },
  research_checkpoint: { anchorType: "research_checkpoint", hasher: researchCheckpointHash },
  artifact_bundle: { anchorType: "evidence_bundle", hasher: artifactBundleHash },
  evidence_bundle: { anchorType: "evidence_bundle", hasher: artifactBundleHash },
};

const usage = `Usage:
  node scripts/verify-anchor-proof.mjs --type <contribution_receipt|research_checkpoint|artifact_bundle> \\
    --record <record.json | - for stdin> [--batch <anchorBatchId>] [--local <dbPath>] [options]

Options:
  --type    Record type: contribution_receipt, research_checkpoint, or
            artifact_bundle (the anchor-leaf spelling evidence_bundle is
            accepted as an alias); selects the matching protocol hash
            function (required). Bundle types map to leaf recordType
            "evidence_bundle" for anchor-store lookups.
  --record  Path to the canonical record JSON (the full object for the given
            type), or "-" to read it from stdin (required).
  --batch   Anchor batch whose chain/network resolves the on-chain adapter;
            defaults to the batch containing the record.
  --local   Path to a local SQLite/libSQL database file. Without it the script
            reads TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) from the process
            environment or .env.local.
  --help    Print this usage text.

On-chain adapters come from ANCHOR_ADAPTERS_JSON (a JSON array of adapter
configurations). When no adapter is configured for the record's chain:network,
a structurally valid anchor is reported as "pending" instead of "verified"
(the record's leaf, batch, and merkle proof are still checked).
Live confirmations must meet ANCHOR_CONFIRMATION_THRESHOLD (default 12) as well
as the adapter's configured threshold. Database confirmation alone is insufficient.

Output: a JSON object { status, reason?, batchId?, root?, txRef? } on stdout.
Exit codes: 0 verified, 1 argument/IO error, 2 mismatch, 3 pending/unanchored.`;

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));

async function main() {
  let options;
  try {
    options = parseArguments();
  } catch (error) {
    return fail(`${error instanceof Error ? error.message : String(error)}\n\n${usage}`);
  }
  if (options.values.help) {
    process.stdout.write(`${usage}\n`);
    process.exitCode = 1;
    return;
  }
  const recordType = options.values.type;
  if (!recordType) {
    return fail(`--type is required (one of contribution_receipt, research_checkpoint, artifact_bundle or evidence_bundle).\n\n${usage}`);
  }
  const contract = recordTypeContracts[recordType];
  if (!contract) {
    return fail(`Unknown --type ${JSON.stringify(recordType)}; expected one of contribution_receipt, research_checkpoint, artifact_bundle (or its alias evidence_bundle).\n\n${usage}`);
  }
  if (!options.values.record) {
    return fail(`--record is required (a JSON file path or "-" for stdin).\n\n${usage}`);
  }
  await loadEnvironmentFile(".env.local");
  const record = await readRecord(options.values.record);
  const recordHash = await contract.hasher(record);
  const store = new D1AnchorStore(createDatabase(options.values.local));
  const row = await store.findRecord({ recordType: contract.anchorType, recordId: record.id, recordHash });
  const adapter = row
    ? await resolveConfiguredAdapter(store, options.values.batch ?? row.batch_id)
    : undefined;
  const configuredThreshold = Number.parseInt(process.env.ANCHOR_CONFIRMATION_THRESHOLD ?? "", 10);
  const confirmationThreshold = Number.isSafeInteger(configuredThreshold) && configuredThreshold > 0 ? configuredThreshold : 12;
  const result = await verifyAnchorRecord({ recordType: contract.anchorType, record, hasher: contract.hasher, store, adapter, confirmationThreshold });
  const output = {};
  if (result.status !== undefined) output.status = result.status;
  if (result.reason !== undefined) output.reason = result.reason;
  if (result.batchId !== undefined) output.batchId = result.batchId;
  if (result.root !== undefined) output.root = result.root;
  if (result.txRef !== undefined) output.txRef = result.txRef;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = result.status === "verified" ? 0 : result.status === "mismatch" ? 2 : 3;
}

function parseArguments() {
  return parseArgs({
    allowPositionals: false,
    strict: true,
    options: {
      type: { type: "string" },
      record: { type: "string" },
      batch: { type: "string" },
      local: { type: "string" },
      help: { type: "boolean" },
    },
  });
}

async function readRecord(recordOption) {
  const source = recordOption === "-"
    ? await readStdin()
    : await readFile(recordOption, "utf8");
  let record;
  try {
    record = JSON.parse(source);
  } catch (cause) {
    throw new Error("--record must contain valid JSON.", { cause });
  }
  if (!record || typeof record !== "object" || Array.isArray(record) || typeof record.id !== "string" || !record.id) {
    throw new Error("--record JSON must be an object with a non-empty string id.");
  }
  return record;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function createDatabase(localPath) {
  if (localPath) {
    return createRemoteLibsqlD1Database({ url: `file:${resolve(localPath)}`, allowLocal: true });
  }
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error("TURSO_DATABASE_URL is required (or pass --local <database path>) to reach the anchor store.");
  }
  return createRemoteLibsqlD1Database({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
    allowLocal: false,
  });
}

async function resolveConfiguredAdapter(store, batchId) {
  const registry = await buildAdapterRegistry();
  if (!registry || !batchId) return undefined;
  const batch = await store.getBatch(batchId);
  if (!batch?.chain || !batch?.network) return undefined;
  try {
    return resolveAdapter({ registry, chain: batch.chain, network: batch.network });
  } catch (error) {
    if (error instanceof AnchorAdapterConfigurationError) return undefined;
    throw error;
  }
}

async function buildAdapterRegistry() {
  const raw = process.env.ANCHOR_ADAPTERS_JSON;
  if (!raw || !raw.trim()) return null;
  let configs;
  try {
    configs = JSON.parse(raw);
  } catch (cause) {
    throw new Error("ANCHOR_ADAPTERS_JSON must be a JSON array of adapter configurations.", { cause });
  }
  if (!Array.isArray(configs)) {
    throw new Error("ANCHOR_ADAPTERS_JSON must be a JSON array of adapter configurations.");
  }
  const factories = {};
  if (configs.some((config) => config?.id === "evm")) {
    const { createEvmAnchorAdapter } = await import("../services/anchoring/evm-anchor-adapter.mjs");
    factories.evm = createEvmAnchorAdapter;
  }
  if (configs.some((config) => config?.id === "tron")) {
    const { createTronAnchorAdapter } = await import("../services/anchoring/tron-anchor-adapter.mjs");
    factories.tron = createTronAnchorAdapter;
  }
  const pending = adapterRegistryFromConfig(configs, factories);
  const registry = new Map();
  for (const [key, adapter] of pending) registry.set(key, await adapter);
  return registry;
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}
