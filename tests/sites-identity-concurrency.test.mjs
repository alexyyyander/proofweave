import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";
import { createClient } from "@libsql/client";
import ts from "typescript";
import { LibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";

const repositorySource = (await readFile(new URL("../db/repositories/account-auth.ts", import.meta.url), "utf8"))
  .replace('import { getAccountAuthD1 as getD1 } from "@/db";', 'const getD1 = () => globalThis.__identityConcurrencyDB;');
const compiled = ts.transpileModule(repositorySource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { AccountAuthRepository } = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));
const migrationsRoot = new URL("../drizzle/", import.meta.url);
const migrationNames = (await readdir(migrationsRoot)).filter(name => name.endsWith(".sql")).sort();
const migrationStatements = (await Promise.all(migrationNames.map(name => readFile(new URL(name, migrationsRoot), "utf8"))))
  .flatMap(source => source.split("--> statement-breakpoint").map(sql => sql.trim()).filter(Boolean));

async function fixture(t, backend) {
  let database;
  if (backend === "D1") {
    const worker = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}',
      compatibilityDate: "2026-07-16", d1Databases: ["DB"] });
    t.after(() => worker.dispose());
    database = await worker.getD1Database("DB");
  } else {
    database = new LibsqlD1Database(createClient({ url: "file::memory:" }));
    t.after(() => database.close());
  }
  assert.equal(migrationNames.length, 51);
  for (const sql of migrationStatements) await database.prepare(sql).run();
  globalThis.__identityConcurrencyDB = database;
  t.after(() => { delete globalThis.__identityConcurrencyDB; });
  return database;
}

// Only schedule real SQL reads: every contender sees the unclaimed legacy
// candidate before any contender may write. No database results are mocked.
function synchronizeCandidates(database, contenders) {
  let reads = 0;
  const gate = Promise.withResolvers();
  const originals = new WeakMap();
  const wrap = (statement, sql) => {
    const proxy = new Proxy(statement, { get(target, key) {
      if (key === "bind") return (...args) => wrap(target.bind(...args), sql);
      if (key === "all" && sql.includes("SELECT candidate.person_id")) return async (...args) => {
        const result = await target.all(...args);
        if (++reads === contenders) gate.resolve();
        await gate.promise;
        return result;
      };
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    } });
    originals.set(proxy, statement);
    return proxy;
  };
  globalThis.__identityConcurrencyDB = {
    prepare: sql => wrap(database.prepare(sql), sql),
    batch: statements => database.batch(statements.map(statement => originals.get(statement) ?? statement)),
  };
  return () => assert.equal(reads, contenders, "all contenders reached the real candidate read");
}

async function seedLegacy(database, email) {
  const personId = "person:legacy";
  await database.prepare("INSERT INTO persons (id,identity_provider,provider_subject,display_name,updated_at) VALUES (?, 'chatgpt', ?, 'Legacy owner', ?)")
    .bind(personId, email, new Date().toISOString()).run();
  return personId;
}
const input = (userId, email = "reassigned@example.test") => ({ siteId: "site:original", userId, email, displayName: userId });
async function verifySessions(identities) {
  const repo = new AccountAuthRepository();
  for (const identity of identities) {
    const { token } = await repo.createSession(identity);
    assert.equal((await repo.findSession(token)).personId, identity.personId);
  }
}

for (const backend of ["D1", "libSQL"]) {
  test(`${backend}: different Sites subjects cannot concurrently claim the same legacy Person`, { timeout: 30000 }, async t => {
    const database = await fixture(t, backend);
    const legacy = await seedLegacy(database, "reassigned@example.test");
    const checkReads = synchronizeCandidates(database, 8);
    const identities = await Promise.all(Array.from({ length: 8 }, (_, index) => new AccountAuthRepository().resolveSitesBridgeIdentity(input(`user-${index}`))));
    checkReads();
    assert.equal(identities.filter(identity => identity.personId === legacy).length, 1);
    assert.equal(new Set(identities.map(identity => identity.personId)).size, 8);
    assert.equal(new Set(identities.map(identity => identity.subject)).size, 8);
    await verifySessions(identities);
    for (const [index, identity] of identities.entries()) {
      assert.equal((await new AccountAuthRepository().resolveSitesBridgeIdentity(input(`user-${index}`, `updated-${index}@example.test`))).personId, identity.personId);
    }
  });

  for (const legacy of [true, false]) {
    test(`${backend}: concurrent retries of one Sites subject keep one ${legacy ? "legacy" : "new"} Person and identity`, { timeout: 30000 }, async t => {
      const database = await fixture(t, backend);
      if (legacy) await seedLegacy(database, "reassigned@example.test");
      const checkReads = synchronizeCandidates(database, 8);
      const identities = await Promise.all(Array.from({ length: 8 }, () => new AccountAuthRepository().resolveSitesBridgeIdentity(input("same-user"))));
      checkReads();
      assert.equal(new Set(identities.map(identity => identity.personId)).size, 1);
      assert.equal(new Set(identities.map(identity => identity.identityId)).size, 1);
      assert.equal(await database.prepare("SELECT COUNT(*) AS count FROM persons").first("count"), 1, "no orphan fallback Persons");
      assert.equal(await database.prepare("SELECT COUNT(*) AS count FROM person_identities").first("count"), 1);
      if (legacy) assert.equal(identities[0].personId, "person:legacy");
      await verifySessions(identities);
    });
  }

  test(`${backend}: an existing stable owner remains isolated from concurrent old-email claimants`, { timeout: 30000 }, async t => {
    const database = await fixture(t, backend);
    const repo = new AccountAuthRepository();
    const oldEmail = "reassigned@example.test";
    await repo.resolveIdentity({ provider: "chatgpt", subject: oldEmail, email: oldEmail, emailVerified: true, displayName: "Legacy" });
    const owner = await repo.resolveSitesBridgeIdentity(input("owner"));
    await repo.resolveSitesBridgeIdentity(input("owner", "owner-new@example.test"));
    const checkReads = synchronizeCandidates(database, 4);
    const identities = await Promise.all(Array.from({ length: 4 }, (_, index) => new AccountAuthRepository().resolveSitesBridgeIdentity(input(`other-${index}`))));
    checkReads();
    assert.ok(identities.every(identity => identity.personId !== owner.personId));
    assert.equal(new Set(identities.map(identity => identity.personId)).size, 4);
    assert.equal((await repo.resolveSitesBridgeIdentity(input("owner", "owner-new@example.test"))).personId, owner.personId);
    await verifySessions(identities);
  });

  test(`${backend}: a delayed Google email link cannot claim a Person after Sites migration wins`, { timeout: 30000 }, async t => {
    const database = await fixture(t, backend);
    const repo = new AccountAuthRepository();
    const email = "reassigned@example.test";
    const legacy = await repo.resolveIdentity({ provider: "chatgpt", subject: email, email, emailVerified: true, displayName: "Legacy" });
    const read = Promise.withResolvers(), resume = Promise.withResolvers();
    const originals = new WeakMap();
    const wrap = (statement, sql) => {
      const proxy = new Proxy(statement, { get(target, key) {
        if (key === "bind") return (...args) => wrap(target.bind(...args), sql);
        if (key === "all" && sql.includes("SELECT DISTINCT identity.person_id")) return async () => {
          const rows = await target.all();
          read.resolve(rows);
          await resume.promise;
          return rows;
        };
        const value = target[key];
        return typeof value === "function" ? value.bind(target) : value;
      } });
      originals.set(proxy, statement);
      return proxy;
    };
    globalThis.__identityConcurrencyDB = {
      prepare: sql => wrap(database.prepare(sql), sql),
      batch: statements => database.batch(statements.map(statement => originals.get(statement) ?? statement)),
    };
    const pending = new AccountAuthRepository().resolveIdentity({ provider: "google", subject: "new-google-owner", email, emailVerified: true, displayName: "New owner" });
    try {
      assert.deepEqual((await read.promise).results.map(row => row.person_id), [legacy.personId]);
      const owner = await repo.resolveSitesBridgeIdentity(input("stable-owner"));
      assert.equal(owner.personId, legacy.personId);
    } finally { resume.resolve(); }
    const google = await pending;
    assert.notEqual(google.personId, legacy.personId);
    await verifySessions([google]);
  });

  test(`${backend}: migration preserves an already bound Google subject`, { timeout: 30000 }, async t => {
    await fixture(t, backend);
    const repo = new AccountAuthRepository();
    const email = "reassigned@example.test";
    const legacy = await repo.resolveIdentity({ provider: "chatgpt", subject: email, email, emailVerified: true, displayName: "Legacy" });
    const googleInput = { provider: "google", subject: "existing-google-owner", email, emailVerified: true, displayName: "Owner" };
    const google = await repo.resolveIdentity(googleInput);
    assert.equal(google.personId, legacy.personId);
    assert.equal((await repo.resolveSitesBridgeIdentity(input("owner"))).personId, legacy.personId);
    assert.equal((await repo.resolveIdentity({ ...googleInput, email: "updated@example.test" })).personId, legacy.personId);
    await verifySessions([google]);
  });

  test(`${backend}: a failed identity batch rolls back the legacy claim and fallback rows`, { timeout: 30000 }, async t => {
    const database = await fixture(t, backend);
    const legacy = await seedLegacy(database, "reassigned@example.test");
    globalThis.__identityConcurrencyDB = {
      prepare: sql => database.prepare(sql),
      batch: statements => database.batch([...statements, database.prepare(
        "INSERT INTO persons (id,identity_provider,provider_subject,display_name,updated_at) VALUES (?, 'chatgpt', 'duplicate@example.test', 'Duplicate', ?)",
      ).bind(legacy, new Date().toISOString())]),
    };
    await assert.rejects(new AccountAuthRepository().resolveSitesBridgeIdentity(input("owner")), /UNIQUE constraint failed/);
    assert.equal(await database.prepare("SELECT COUNT(*) AS count FROM persons").first("count"), 1);
    assert.equal(await database.prepare("SELECT COUNT(*) AS count FROM person_identities").first("count"), 0);
    assert.equal(await database.prepare("SELECT COUNT(*) AS count FROM app_sessions").first("count"), 0);
  });

}
