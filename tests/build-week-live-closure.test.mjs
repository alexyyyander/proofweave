import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import {
  delegationSigningPayload,
  verifyDelegationSignature,
} from "../packages/domain/delegation.mjs";
import { canonicalJson } from "../packages/protocol/canonical-json.mjs";
import { verifyPersonKeyProofChallengeSignature } from "../packages/protocol/person-key-proof.mjs";
import { verifyVerificationAttestationSignature } from "../packages/protocol/verification-attestation.mjs";
import { LibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import {
  buildWeekLiveClaimOwnership,
  buildWeekLiveReviewers,
  D1BuildWeekLiveClosure,
} from "../services/demo/d1-build-week-live-closure.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);

test("the labelled Build Week mockers are distinct owners with real possession proofs and delegations", async () => {
  const database = new LibsqlD1Database(createClient({ url: "file::memory:" }));
  try {
    await applyMigrations(database);
    const keys = await generateMockerKeys();
    const closure = new D1BuildWeekLiveClosure({
      database,
      ...keys,
      now: () => new Date("2026-07-18T01:00:00.000Z"),
    });

    const first = await closure.ensureMockReviewers();
    const second = await closure.ensureMockReviewers();
    assert.deepEqual(second, first);
    assert.equal(first.length, 2);
    assert.equal(new Set(first.map((reviewer) => reviewer.personId)).size, 2);
    assert.equal(new Set(first.map((reviewer) => reviewer.agentId)).size, 2);
    assert.equal(new Set(first.map((reviewer) => reviewer.agentPublicKey)).size, 2);
    assert.deepEqual(first.map((reviewer) => reviewer.ordinal), ["1st", "2nd"]);
    assert.deepEqual(first[0].principal.scopes, ["verification:replay", "verification:write"]);
    assert.deepEqual(buildWeekLiveClaimOwnership, {
      bundle_reproducible: buildWeekLiveReviewers[0].personId,
      kernel_accepted: buildWeekLiveReviewers[1].personId,
      project_accepted: buildWeekLiveReviewers[1].personId,
    });

    const artifactBundleHash = `sha256:${"a".repeat(64)}`;
    const evidenceHash = `sha256:${"b".repeat(64)}`;
    for (const [claimType, expectedPersonId] of Object.entries(buildWeekLiveClaimOwnership)) {
      const reviewer = first.find((candidate) => candidate.personId === expectedPersonId);
      const attestation = await closure.signedAttestation({
        assignment: { id: `assignment:${claimType}`, claimType },
        reviewer,
        artifactBundleHash,
        evidenceHash,
        attestedAt: "2026-07-18T01:01:00.000Z",
      });
      assert.equal(attestation.verifierPersonId, expectedPersonId);
      assert.equal(attestation.verifierAgentId, reviewer.agentId);
      assert.equal(await verifyVerificationAttestationSignature(attestation), true);

      const otherReviewer = first.find((candidate) => candidate.personId !== expectedPersonId);
      assert.equal(await verifyVerificationAttestationSignature({
        ...attestation,
        verifierAgentPublicKey: otherReviewer.agentPublicKey,
      }), false);
    }

    for (const [index, identity] of buildWeekLiveReviewers.entries()) {
      const proof = await database.prepare(
        `SELECT proof.payload_hash, proof.person_signature,
                challenge.id AS challenge_id, challenge.person_id, challenge.person_key_id,
                challenge.nonce, challenge.issued_at, challenge.expires_at,
                key.public_key AS person_public_key
         FROM person_key_proof_events AS proof
         INNER JOIN person_key_proof_challenges AS challenge ON challenge.id = proof.challenge_id
         INNER JOIN person_keys AS key ON key.id = proof.person_key_id
         WHERE proof.id = ?`,
      ).bind(identity.personProofId).first();
      const challenge = {
        protocolVersion: "pw-person-key-proof-challenge-v1",
        id: proof.challenge_id,
        personId: proof.person_id,
        personKeyId: proof.person_key_id,
        personPublicKey: proof.person_public_key,
        nonce: proof.nonce,
        issuedAt: proof.issued_at,
        expiresAt: proof.expires_at,
      };
      assert.ok(proof.payload_hash.startsWith("sha256:"));
      assert.equal(await verifyPersonKeyProofChallengeSignature({
        challenge,
        personPublicKey: proof.person_public_key,
        personSignature: proof.person_signature,
      }), true);

      const delegation = await database.prepare(
        `SELECT certificate.*, key.public_key AS person_public_key
         FROM delegation_certificates AS certificate
         INNER JOIN person_keys AS key ON key.id = certificate.person_key_id
         WHERE certificate.id = ?`,
      ).bind(identity.delegationId).first();
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
      ).bind(identity.installationId).first();
      assert.deepEqual(installation, {
        status: "active",
        person_id: identity.personId,
        agent_id: identity.agentId,
        delegation_certificate_id: identity.delegationId,
      });
      assert.equal(first[index].personId, identity.personId);
      assert.notEqual(first[index].personId, "person:demo-owner");
    }
  } finally {
    database.close();
  }
});

test("the Build Week closure refuses missing or non-Ed25519 mocker secrets", async () => {
  assert.throws(() => new D1BuildWeekLiveClosure({
    database: { prepare() {}, batch() {} },
    mocker1PersonPrivateKeyJwk: {},
    mocker1AgentPrivateKeyJwk: {},
    mocker2PersonPrivateKeyJwk: {},
    mocker2AgentPrivateKeyJwk: {},
  }), /Ed25519 private JWK/);
});

test("the Build Week closure rejects key reuse across mock Person and Agent identities", async () => {
  const keys = await generateMockerKeys();
  assert.throws(() => new D1BuildWeekLiveClosure({
    database: { prepare() {}, batch() {} },
    ...keys,
    mocker2AgentPrivateKeyJwk: keys.mocker1PersonPrivateKeyJwk,
  }), /must be distinct/);
});

test("the live closure queues a primary Run before opening independent review work", async () => {
  const keys = await generateMockerKeys();
  const queued = [];
  const closure = new D1BuildWeekLiveClosure({
    database: { prepare() {}, batch() {} },
    ...keys,
    runnerDispatcher: {
      async queueBundle(input) {
        queued.push(input);
        return { run: { id: "run:primary", state: "queued" }, runCreated: true };
      },
    },
  });
  closure.requireEligibleBundle = async () => ({
    attemptId: "attempt:primary",
    problemRevisionId: "revision:primary",
    attemptOwnerPersonId: "person:primary",
  });
  closure.findAcceptedPrimaryRun = async () => null;
  const result = await closure.prime({ artifactBundleHash: `sha256:${"a".repeat(64)}` });
  assert.equal(result.state, "primary_run_queued");
  assert.equal(result.runId, "run:primary");
  assert.equal(queued.length, 1);
  assert.deepEqual(queued[0].attempt, { id: "attempt:primary", problemRevisionId: "revision:primary" });

  closure.findAcceptedPrimaryRun = async () => ({ id: "run:already-accepted" });
  const replay = await closure.prime({ artifactBundleHash: `sha256:${"a".repeat(64)}` });
  assert.equal(replay.state, "primary_run_succeeded");
  assert.equal(replay.runId, "run:already-accepted");
  assert.equal(queued.length, 1, "an accepted primary Run must not be queued again");
});

async function generateMockerKeys() {
  const pairs = await Promise.all(Array.from({ length: 4 }, () => (
    crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
  )));
  const privateJwks = await Promise.all(pairs.map((pair) => crypto.subtle.exportKey("jwk", pair.privateKey)));
  return {
    mocker1PersonPrivateKeyJwk: privateJwks[0],
    mocker1AgentPrivateKeyJwk: privateJwks[1],
    mocker2PersonPrivateKeyJwk: privateJwks[2],
    mocker2AgentPrivateKeyJwk: privateJwks[3],
  };
}

async function applyMigrations(database) {
  const filenames = (await readdir(migrationsRoot)).filter((filename) => filename.endsWith(".sql")).sort();
  for (const filename of filenames) {
    const source = await readFile(new URL(filename, migrationsRoot), "utf8");
    const statements = source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean);
    for (const statement of statements) await database.prepare(statement).run();
  }
}
