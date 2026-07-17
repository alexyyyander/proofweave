import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRemoteLibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import {
  applyProofweaveMigrations,
  loadProofweaveMigrations,
  planProofweaveMigrations,
  verifyProofweaveControlPlane,
} from "../services/database/libsql-migrations.mjs";
import { loadEnvironmentFile } from "./lib/environment-file.mjs";

const localEnvironmentPath = fileURLToPath(new URL("../.env.local", import.meta.url));
const validCommands = new Set(["plan", "apply", "verify"]);

export async function runTursoControlPlaneCommand({
  command,
  environment = process.env,
  output = process.stdout,
  loadLocalEnvironment = true,
  now,
} = {}) {
  if (!validCommands.has(command)) {
    throw new Error("Usage: node scripts/manage-turso-control-plane.mjs <plan|apply|verify>");
  }
  if (loadLocalEnvironment) await loadEnvironmentFile(localEnvironmentPath, { target: environment });
  const url = requiredSetting(environment, "TURSO_DATABASE_URL");
  const authToken = requiredSetting(environment, "TURSO_AUTH_TOKEN");
  const migrations = await loadProofweaveMigrations();
  const database = createRemoteLibsqlD1Database({ url, authToken });
  try {
    if (command === "plan") {
      const plan = await planProofweaveMigrations({ database, migrations });
      output.write(`${JSON.stringify(renderPlan(plan, url), null, 2)}\n`);
      return plan;
    }
    if (command === "apply") {
      const result = await applyProofweaveMigrations({
        database,
        migrations,
        ...(now ? { now } : {}),
        onApplied(migration) {
          output.write(`Applied ${migration.name}\n`);
        },
      });
      output.write(`Turso control plane is current at ${result.plan.latestApplied}; ${result.applied.length} migration(s) applied in this run.\n`);
      return result;
    }
    const result = await verifyProofweaveControlPlane({ database, migrations });
    output.write(`Turso control plane verified: ${result.migrationCount} migrations, latest ${result.latestMigration}.\n`);
    return result;
  } catch (error) {
    throw new Error(redactError(error, { url, authToken }), { cause: error });
  } finally {
    database.close();
  }
}

function renderPlan(plan, url) {
  return {
    database_fingerprint: createHash("sha256").update(url).digest("hex").slice(0, 16),
    fresh_database: plan.fresh,
    ledger_present: plan.ledgerPresent,
    total_migrations: plan.total,
    applied_migrations: plan.applied.length,
    pending_migrations: plan.pending.map((migration) => migration.name),
    latest_available: plan.latestAvailable,
    latest_applied: plan.latestApplied,
    mutates_database: false,
  };
}

function requiredSetting(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || !value) {
    throw new Error(`${name} is required. Run npm run turso:bootstrap or store it in the ignored .env.local file.`);
  }
  return value;
}

function redactError(error, { url, authToken }) {
  let message = error instanceof Error ? error.message : "Turso control-plane command failed.";
  for (const secret of [url, authToken]) {
    if (secret) message = message.split(secret).join("[redacted]");
  }
  return message;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runTursoControlPlaneCommand({ command: process.argv[2] }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Turso control-plane command failed."}\n`);
    process.exitCode = 1;
  });
}
