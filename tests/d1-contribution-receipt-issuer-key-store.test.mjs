import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import {
  ContributionReceiptIssuerKeyStoreConflictError,
  ContributionReceiptIssuerKeyStoreValidationError,
  D1ContributionReceiptIssuerKeyStore,
} from "../services/receipts/d1-contribution-receipt-issuer-key-store.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
let miniflare;
let database;

before(async () => {
  miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
  });
  database = await miniflare.getD1Database("DB");
  await applyMigrations(database);
});

after(async () => {
  await miniflare?.dispose();
});

test("issuer key registry permits one active key, preserves retirement history, and records an emergency revocation", async () => {
  const first = await keyPair();
  const second = await keyPair();
  const store = new D1ContributionReceiptIssuerKeyStore(database);
  const initial = await store.registerInitial({
    id: "issuer:key-one",
    publicKey: first,
    activatedAt: "2026-07-13T00:00:00Z",
  });
  assert.equal(initial.created, true);
  assert.equal((await store.registerInitial({
    id: "issuer:key-one",
    publicKey: first,
    activatedAt: "2026-07-13T00:00:00Z",
  })).created, false);
  await assert.rejects(
    store.registerInitial({
      id: "issuer:key-two",
      publicKey: second,
      activatedAt: "2026-07-13T00:01:00Z",
    }),
    ContributionReceiptIssuerKeyStoreConflictError,
  );

  const rotation = await store.rotate({
    previousKeyId: "issuer:key-one",
    id: "issuer:key-two",
    publicKey: second,
    rotatedAt: "2026-07-13T01:00:00Z",
  });
  assert.deepEqual(rotation.previousKey, {
    id: "issuer:key-one",
    publicKey: first,
    status: "retired",
    validFrom: "2026-07-13T00:00:00Z",
    retiredAt: "2026-07-13T01:00:00Z",
    revokedAt: null,
  });
  assert.equal(rotation.key.id, "issuer:key-two");
  await store.assertHistoricallyTrusted({
    issuerKeyId: "issuer:key-one",
    issuerPublicKey: first,
    occurredAt: "2026-07-13T00:30:00Z",
  });
  await assert.rejects(
    store.assertHistoricallyTrusted({
      issuerKeyId: "issuer:key-one",
      issuerPublicKey: first,
      occurredAt: "2026-07-13T01:00:01Z",
    }),
    ContributionReceiptIssuerKeyStoreValidationError,
  );
  await assert.rejects(
    store.assertCanIssue({
      issuerKeyId: "issuer:key-one",
      issuerPublicKey: first,
      issuedAt: "2026-07-13T01:00:01Z",
    }),
    ContributionReceiptIssuerKeyStoreValidationError,
  );
  await store.assertCanIssue({
    issuerKeyId: "issuer:key-two",
    issuerPublicKey: second,
    issuedAt: "2026-07-13T01:00:01Z",
  });

  const revoked = await store.revoke({ id: "issuer:key-one", revokedAt: "2026-07-13T02:00:00Z" });
  assert.equal(revoked.key.status, "revoked");
  await assert.rejects(
    store.assertHistoricallyTrusted({
      issuerKeyId: "issuer:key-one",
      issuerPublicKey: first,
      occurredAt: "2026-07-13T00:30:00Z",
    }),
    ContributionReceiptIssuerKeyStoreValidationError,
  );
  const events = await database
    .prepare("SELECT event_type, key_id, related_key_id, occurred_at FROM contribution_receipt_issuer_key_events ORDER BY occurred_at ASC, id ASC")
    .all();
  assert.deepEqual(events.results, [
    { event_type: "activated", key_id: "issuer:key-one", related_key_id: null, occurred_at: "2026-07-13T00:00:00Z" },
    { event_type: "activated", key_id: "issuer:key-two", related_key_id: "issuer:key-one", occurred_at: "2026-07-13T01:00:00Z" },
    { event_type: "retired", key_id: "issuer:key-one", related_key_id: "issuer:key-two", occurred_at: "2026-07-13T01:00:00Z" },
    { event_type: "revoked", key_id: "issuer:key-one", related_key_id: null, occurred_at: "2026-07-13T02:00:00Z" },
  ]);
  await assert.rejects(
    database.prepare("UPDATE contribution_receipt_issuer_key_events SET event_type = ? WHERE id = ?").bind("revoked", "issuer-key-event:activated:issuer:key-two").run(),
    /issuer key events are immutable/,
  );
});

async function keyPair() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  return base64Url(await crypto.subtle.exportKey("raw", pair.publicKey));
}

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

async function applyMigrations(d1) {
  const names = (await readdir(migrationsRoot)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names) {
    const statements = (await readFile(new URL(name, migrationsRoot), "utf8"))
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) await d1.prepare(statement).run();
  }
}
