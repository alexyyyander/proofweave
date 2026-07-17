import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bootstrapTursoControlPlane } from "../scripts/bootstrap-turso-control-plane.mjs";
import { loadEnvironmentFile, updateEnvironmentFile } from "../scripts/lib/environment-file.mjs";

test("bootstrap creates or reuses one Turso database without printing its token", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "proofweave-turso-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const environmentPath = join(root, ".env.local");
  const token = `header.${"x".repeat(64)}.signature`;
  const calls = [];
  let created = false;
  const output = captureOutput();

  const result = await bootstrapTursoControlPlane({
    databaseName: "proofweave-control",
    environment: {},
    environmentPath,
    interactive: true,
    confirm: async () => true,
    output,
    async runCli(args) {
      calls.push(args);
      const command = args.join(" ");
      if (command === "auth whoami") return { stdout: "alice\n", stderr: "" };
      if (command === "db show proofweave-control --url" && !created) throw new Error("not found");
      if (command === "db create proofweave-control --wait") {
        created = true;
        return { stdout: "", stderr: "" };
      }
      if (command === "db show proofweave-control --url") {
        return { stdout: "libsql://proofweave-control-alice.turso.io\n", stderr: "" };
      }
      if (command === "db tokens create proofweave-control --expiration 30d") {
        return { stdout: `${token}\n`, stderr: "" };
      }
      throw new Error(`Unexpected command ${command}`);
    },
    async applyControlPlane({ url, authToken }) {
      assert.equal(url, "libsql://proofweave-control-alice.turso.io");
      assert.equal(authToken, token);
      return { appliedMigrations: 34, latestMigration: "0033_add_external_account_auth.sql" };
    },
  });

  assert.equal(result.created, true);
  assert.equal(result.reusedCredentials, false);
  assert.deepEqual(calls.at(-1), ["db", "tokens", "create", "proofweave-control", "--expiration", "30d"]);
  const source = await readFile(environmentPath, "utf8");
  assert.match(source, /TURSO_DATABASE_URL=libsql:\/\/proofweave-control-alice\.turso\.io/);
  assert.ok(source.includes(`TURSO_AUTH_TOKEN=${token}`));
  assert.equal((await stat(environmentPath)).mode & 0o777, 0o600);
  assert.equal(output.value.includes(token), false);
});

test("bootstrap reuses complete local credentials and preserves unrelated settings", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "proofweave-turso-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const environmentPath = join(root, ".env.local");
  await updateEnvironmentFile(environmentPath, {
    UNRELATED_SETTING: "keep-me",
    TURSO_DATABASE_URL: "libsql://existing.turso.io",
    TURSO_AUTH_TOKEN: "x".repeat(32),
  });
  const environment = {};
  let applied = 0;
  const result = await bootstrapTursoControlPlane({
    environment,
    environmentPath,
    output: captureOutput(),
    async runCli() {
      throw new Error("CLI must not run when credentials already exist");
    },
    async applyControlPlane({ url, authToken }) {
      applied += 1;
      assert.equal(url, "libsql://existing.turso.io");
      assert.equal(authToken, "x".repeat(32));
      return { appliedMigrations: 0, latestMigration: "0033_add_external_account_auth.sql" };
    },
  });
  assert.equal(result.reusedCredentials, true);
  assert.equal(applied, 1);
  assert.equal(environment.UNRELATED_SETTING, "keep-me");
});

test("environment loading does not override process-level secrets", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "proofweave-turso-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const environmentPath = join(root, ".env.local");
  await updateEnvironmentFile(environmentPath, { TURSO_AUTH_TOKEN: "file-token" });
  const target = { TURSO_AUTH_TOKEN: "deployment-token" };
  const result = await loadEnvironmentFile(environmentPath, { target });
  assert.equal(result.exists, true);
  assert.equal(target.TURSO_AUTH_TOKEN, "deployment-token");
});

test("non-interactive bootstrap explains the missing Turso login", async () => {
  await assert.rejects(
    bootstrapTursoControlPlane({
      environment: {},
      environmentPath: join(tmpdir(), `proofweave-absent-${Date.now()}`),
      interactive: false,
      output: captureOutput(),
      async runCli() {
        const error = new Error("not logged in");
        error.code = 1;
        throw error;
      },
    }),
    /turso auth login/,
  );
});

function captureOutput() {
  return {
    value: "",
    write(chunk) {
      this.value += String(chunk);
    },
  };
}
