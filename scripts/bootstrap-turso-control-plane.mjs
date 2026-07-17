import { execFile } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createRemoteLibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import {
  applyProofweaveMigrations,
  loadProofweaveMigrations,
} from "../services/database/libsql-migrations.mjs";
import { loadEnvironmentFile, updateEnvironmentFile } from "./lib/environment-file.mjs";

const executeFile = promisify(execFile);
const defaultEnvironmentPath = fileURLToPath(new URL("../.env.local", import.meta.url));

/**
 * One-command free-tier bootstrap. Turso account authentication remains in
 * Turso's browser flow; Proofweave receives only a database-scoped token and
 * writes it to the gitignored local environment file with mode 0600.
 */
export async function bootstrapTursoControlPlane({
  databaseName = "proofweave-control",
  environment = process.env,
  environmentPath = defaultEnvironmentPath,
  assumeYes = false,
  rotateToken = false,
  interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
  runCli = runTursoCli,
  confirm = promptForConfirmation,
  applyControlPlane = migrateControlPlane,
  output = process.stdout,
} = {}) {
  requireDatabaseName(databaseName);
  await loadEnvironmentFile(environmentPath, { target: environment });
  const configuredUrl = environment.TURSO_DATABASE_URL;
  const configuredToken = environment.TURSO_AUTH_TOKEN;
  if (Boolean(configuredUrl) !== Boolean(configuredToken)) {
    throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must either both be configured or both be absent.");
  }
  if (configuredUrl && configuredToken && !rotateToken) {
    const result = await applyControlPlane({ url: configuredUrl, authToken: configuredToken, output });
    output.write("Reused the Turso credentials already stored in .env.local; no new database token was minted.\n");
    return Object.freeze({ created: false, reusedCredentials: true, ...result });
  }

  await ensureTursoLogin({ runCli, interactive, output });
  let url;
  let created = false;
  try {
    url = cleanCliValue((await runCli(["db", "show", databaseName, "--url"])).stdout, "database URL");
  } catch {
    if (rotateToken) {
      throw new Error(`Cannot rotate the token because Turso database '${databaseName}' was not found.`);
    }
    const approved = assumeYes || (interactive && await confirm(
      `Create the Turso database '${databaseName}' on the current free account?`,
    ));
    if (!approved) throw new Error("Turso bootstrap cancelled before creating a database.");
    await runCli(["db", "create", databaseName, "--wait"]);
    created = true;
    url = cleanCliValue((await runCli(["db", "show", databaseName, "--url"])).stdout, "database URL");
  }

  const authToken = cleanCliValue(
    (await runCli(["db", "tokens", "create", databaseName, "--expiration", "30d"])).stdout,
    "database token",
  );
  if (authToken.length < 16 || authToken.length > 16_384 || /\s/.test(authToken)) {
    throw new Error("Turso returned an invalid database token.");
  }
  const validatedConnection = createRemoteLibsqlD1Database({ url, authToken });
  validatedConnection.close();
  await updateEnvironmentFile(environmentPath, {
    TURSO_DATABASE_URL: url,
    TURSO_AUTH_TOKEN: authToken,
  });
  environment.TURSO_DATABASE_URL = url;
  environment.TURSO_AUTH_TOKEN = authToken;
  output.write("Saved the database URL and 30-day database-scoped token to the ignored .env.local file (mode 0600).\n");

  const result = await applyControlPlane({ url, authToken, output });
  output.write("Turso is ready as the external Proofweave control-plane database. Sites D1 was not changed.\n");
  return Object.freeze({ created, reusedCredentials: false, ...result });
}

async function ensureTursoLogin({ runCli, interactive, output }) {
  try {
    await runCli(["auth", "whoami"]);
    return;
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("Turso CLI is not installed. On macOS run: brew install tursodatabase/tap/turso");
    }
    if (!interactive) {
      throw new Error("Turso CLI is not authenticated. Run 'turso auth login' once, then retry npm run turso:bootstrap.");
    }
  }
  output.write("Opening Turso's browser login. Proofweave never receives your Turso account password.\n");
  await runCli(["auth", "login"]);
  await runCli(["auth", "whoami"]);
}

async function migrateControlPlane({ url, authToken, output }) {
  const migrations = await loadProofweaveMigrations();
  const database = createRemoteLibsqlD1Database({ url, authToken });
  try {
    const result = await applyProofweaveMigrations({
      database,
      migrations,
      onApplied(migration) {
        output.write(`Applied ${migration.name}\n`);
      },
    });
    return Object.freeze({
      appliedMigrations: result.applied.length,
      latestMigration: result.plan.latestApplied,
    });
  } finally {
    database.close();
  }
}

async function runTursoCli(args) {
  try {
    const result = await executeFile("turso", args, {
      encoding: "utf8",
      maxBuffer: 1_048_576,
      timeout: 180_000,
      windowsHide: true,
    });
    return Object.freeze({ stdout: result.stdout, stderr: result.stderr });
  } catch (error) {
    if (error?.code === "ENOENT") throw error;
    const wrapped = new Error(`Turso CLI command failed: turso ${args.join(" ")}`);
    wrapped.code = error?.code;
    throw wrapped;
  }
}

async function promptForConfirmation(question) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`${question} [y/N] `);
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    prompt.close();
  }
}

function cleanCliValue(value, label) {
  if (typeof value !== "string") throw new Error(`Turso did not return a ${label}.`);
  const normalized = value.trim();
  if (!normalized || /[\0\r\n]/.test(normalized)) throw new Error(`Turso returned an invalid ${label}.`);
  return normalized;
}

function requireDatabaseName(value) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{2,62}$/.test(value)) {
    throw new Error("Turso database name must be 3-63 lowercase letters, numbers, or hyphens and start with a letter.");
  }
}

function parseArguments(args) {
  let databaseName = "proofweave-control";
  let assumeYes = false;
  let rotateToken = false;
  for (const argument of args) {
    if (argument === "--yes") assumeYes = true;
    else if (argument === "--rotate-token") rotateToken = true;
    else if (argument.startsWith("--database=")) databaseName = argument.slice("--database=".length);
    else throw new Error("Usage: npm run turso:bootstrap -- [--database=proofweave-control] [--rotate-token] [--yes]");
  }
  return { databaseName, assumeYes, rotateToken };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
  if (options) {
    bootstrapTursoControlPlane(options).catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : "Turso bootstrap failed."}\n`);
      process.exitCode = 1;
    });
  }
}
