#!/usr/bin/env node

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { loadEnvironmentFile } from "./lib/environment-file.mjs";
import { createRemoteLibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import { AnchorStoreConflictError, D1AnchorStore } from "../services/anchoring/d1-anchor-store.mjs";
import { createAnchorBatchBuilder } from "../services/anchoring/anchor-batch-builder.mjs";
import { createAnchorCoordinator } from "../services/anchoring/anchor-coordinator.mjs";
import {
  adapterRegistryFromConfig,
} from "../services/anchoring/anchor-chain-adapter.mjs";
import { anchorManifestHash } from "../packages/protocol/anchor-manifest.mjs";
import { canonicalUtf8 } from "../packages/protocol/canonical-json.mjs";

const usage = `Usage:
  node scripts/anchor-tick.mjs [--local <dbPath>] [--help]

One single-shot anchoring tick for deployment-level cron scheduling
(npm run anchor:tick): resumeUnfinishedBatches() → maybeBuildAndSubmit()
→ pollConfirmations(), then a JSON summary on stdout. A batch build that
loses the log-head CAS race (AnchorStoreConflictError) is never retried
in-process: the tick prints a conflict summary and exits 0 — the next
cron run is the retry.

Database: TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) from the environment or
.env.local, or a local SQLite/libSQL file via --local. On-chain adapters
come from ANCHOR_ADAPTERS_JSON (a JSON array of adapter configurations);
when it is absent or blank the tick prints
{ status: "anchoring_disabled" } and exits 0 without touching the store.

Exit codes: 0 the tick ran (including conflict and anchoring_disabled),
1 argument, configuration, or IO error.`;

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
  await loadEnvironmentFile(".env.local");
  const registry = await buildAdapterRegistry();
  if (!registry || registry.size === 0) {
    return emitSummary({ status: "anchoring_disabled" });
  }
  const store = new D1AnchorStore(createDatabase(options.values.local));
  const coordinator = createAnchorCoordinator({
    store,
    builder: createAnchorBatchBuilder({ store, ...platformChainOf(registry) }),
    // The R2 manifest bucket is a Worker binding; a tick keeps manifests
    // reconstructible from the immutable batch projection instead.
    manifestStorage: createVolatileManifestStorage(),
    adapter: firstAdapterOf(registry),
    config: anchorCoordinatorConfigFromEnvironment(),
    // resume/build/poll never verify witness authority; ticks submit none.
    verifyWitnessAuthority: async () => {
      throw new Error("Anchor ticks do not submit witness evidence.");
    },
  });
  let summary;
  try {
    const recoveredBatches = await coordinator.resumeUnfinishedBatches();
    const built = await coordinator.maybeBuildAndSubmit({ lastBatch: await store.getLatestBatch() });
    const { confirmedBatches, failedBatches } = await coordinator.pollConfirmations();
    summary = {
      status: "ok",
      recoveredBatches,
      batchCreated: built.created,
      ...(built.created
        ? {
          batchId: built.batch.id,
          root: built.batch.root,
          leafCount: Number(built.batch.leaf_count),
          txRef: built.txRef,
          manifestKey: built.manifestKey,
        }
        : built.reason ? { reason: built.reason } : {}),
      confirmedBatches,
      failedBatches,
    };
  } catch (error) {
    if (error instanceof AnchorStoreConflictError) {
      return emitSummary({ status: "conflict", reason: error.message });
    }
    throw error;
  }
  emitSummary(summary);
}

function parseArguments() {
  return parseArgs({
    allowPositionals: false,
    strict: true,
    options: {
      local: { type: "string" },
      help: { type: "boolean" },
    },
  });
}

function platformChainOf(registry) {
  const [key] = registry.keys();
  const separator = String(key).indexOf(":");
  if (separator < 1) {
    throw new Error(`ANCHOR_ADAPTERS_JSON produced an invalid adapter registry key ${JSON.stringify(String(key))}.`);
  }
  return { chain: String(key).slice(0, separator), network: String(key).slice(separator + 1) };
}

function firstAdapterOf(registry) {
  const [adapter] = registry.values();
  return adapter;
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
  const pending = adapterRegistryFromConfig(configs, factories);
  const registry = new Map();
  for (const [key, adapter] of pending) registry.set(key, await adapter);
  return registry;
}

function anchorCoordinatorConfigFromEnvironment() {
  return {
    minLeafCount: positiveIntEnvironmentValue("ANCHOR_BATCH_MIN_LEAVES", 100),
    maxIntervalSeconds: positiveIntEnvironmentValue("ANCHOR_BATCH_MAX_INTERVAL_SECONDS", 86_400),
    confirmationThreshold: positiveIntEnvironmentValue("ANCHOR_CONFIRMATION_THRESHOLD", 12),
  };
}

function positiveIntEnvironmentValue(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createVolatileManifestStorage() {
  const entries = new Map();
  return {
    async put(manifest) {
      const manifestHash = await anchorManifestHash(manifest);
      const key = `volatile/${manifestHash}`;
      entries.set(key, canonicalUtf8(manifest));
      return { key, manifestHash };
    },
    async get(key) {
      return entries.get(key) ?? null;
    },
  };
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

function emitSummary(summary) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}
