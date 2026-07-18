import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import {
  delegationSigningPayload,
  verifyDelegationSignature,
} from "../packages/domain/delegation.mjs";
import { canonicalJson } from "../packages/protocol/canonical-json.mjs";
import { LibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import {
  buildWeekLiveReviewer,
  D1BuildWeekLiveClosure,
} from "../services/demo/d1-build-week-live-closure.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);

test("the labelled Build Week reviewer has a real possession proof and signed review delegation", async () => {
  const database = new LibsqlD1Database(createClient({ url: "file::memory:" }));
  try {
    await applyMigrations(database);
    const [personPair, agentPair] = await Promise.all([
      crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]),
      crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]),
    ]);
    const personJwk = await crypto.subtle.exportKey("jwk", personPair.privateKey);
    const agentJwk = await crypto.subtle.exportKey("jwk", agentPair.privateKey);
    const closure = new D1BuildWeekLiveClosure({
      database,
      reviewerPersonPrivateKeyJwk: personJwk,
      reviewerAgentPrivateKeyJwk: agentJwk,
      now: () => new Date("2026-07-18T01:00:00.000Z"),
    });

    const first = await closure.ensureMockReviewer();
    const second = await closure.ensureMockReviewer();
    assert.deepEqual(second, first);
    assert.equal(first.personId, buildWeekLiveReviewer.personId);
    assert.notEqual(first.personId, "person:demo-owner");
    assert.deepEqual(first.principal.scopes, ["verification:replay", "verification:write"]);

    const proof = await database.prepare(
      `SELECT proof.payload_hash, proof.person_signature,
              challenge.canonical_payload AS challenge_payload
       FROM person_key_proof_events AS proof
       INNER JOIN person_key_proof_challenges AS challenge ON challenge.id = proof.challenge_id
       WHERE proof.id = ?`,
    ).bind(buildWeekLiveReviewer.personProofId).first();
    assert.ok(proof?.payload_hash?.startsWith("sha256:"));
    assert.equal(proof.challenge_payload.length > 0, true);
    assert.equal(proof.person_signature.length > 80, true);

    const delegation = await database.prepare(
      `SELECT certificate.*, key.public_key AS person_public_key
       FROM delegation_certificates AS certificate
       INNER JOIN person_keys AS key ON key.id = certificate.person_key_id
       WHERE certificate.id = ?`,
    ).bind(buildWeekLiveReviewer.delegationId).first();
    const certificate = {
      id: delegation.id,
      ownerPersonId: delegation.owner_person_id,
      agentId: delegation.agent_id,
      agentPublicKey: delegation.agent_public_key,
      scopes: JSON.parse(delegation.scopes_json),
      validFrom: delegation.valid_from,
      validUntil: delegation.valid_until,
      attributionPolicy: {
        beneficiaryPersonId: delegation.beneficiary_person_id,
        mode: "agent_delegated",
      },
    };
    assert.equal(delegation.canonical_payload, canonicalJson(delegationSigningPayload(certificate)));
    assert.equal(await verifyDelegationSignature({
      certificate,
      personPublicKey: delegation.person_public_key,
      personSignature: delegation.person_signature,
    }), true);

    const installation = await database.prepare(
      "SELECT status, person_id, agent_id, delegation_certificate_id FROM agent_installations WHERE id = ?",
    ).bind(buildWeekLiveReviewer.installationId).first();
    assert.deepEqual(installation, {
      status: "active",
      person_id: buildWeekLiveReviewer.personId,
      agent_id: buildWeekLiveReviewer.agentId,
      delegation_certificate_id: buildWeekLiveReviewer.delegationId,
    });
  } finally {
    database.close();
  }
});

test("the Build Week closure refuses non-Ed25519 reviewer secrets", async () => {
  assert.throws(() => new D1BuildWeekLiveClosure({
    database: { prepare() {}, batch() {} },
    reviewerPersonPrivateKeyJwk: {},
    reviewerAgentPrivateKeyJwk: {},
  }), /Ed25519 private JWK/);
});

async function applyMigrations(database) {
  const filenames = (await readdir(migrationsRoot)).filter((filename) => filename.endsWith(".sql")).sort();
  for (const filename of filenames) {
    const source = await readFile(new URL(filename, migrationsRoot), "utf8");
    const statements = source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean);
    for (const statement of statements) await database.prepare(statement).run();
  }
}
