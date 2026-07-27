import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bindLiveEvidence,
  fetchCurrentIssuerKeyset,
  normalizeLiveEvidence,
  readLiveClosureEvidence,
  tursoDatabaseFingerprint,
} from "../scripts/lib/github-independent-live-evidence.mjs";
import {
  contributionReceiptHash,
  createContributionReceipt,
} from "../packages/protocol/contribution-receipt.mjs";
import {
  canonicalJson,
  canonicalUtf8,
  sha256Canonical,
} from "../packages/protocol/canonical-json.mjs";
import {
  verificationAttestationPayloadHash,
  verificationAttestationSigningPayload,
} from "../packages/protocol/verification-attestation.mjs";

const createdAt = "2026-07-27T00:00:00.000Z";
const bundleHash = sha("b");
const expectedConsumerId = "consumer:render-hosted-production";

test("fake D1 reconstruction computes canonical attestation hashes and binds exact closure rows", async () => {
  const fixture = await canonicalDatabaseFixture();
  const result = await readLiveClosureEvidence({
    database: fixture.database,
    state: fixture.state,
    evidence: fixture.evidence,
  });
  assert.equal(result.run.id, fixture.evidence.run.id);
  assert.equal(result.run.personId, fixture.state.participant.personId);
  assert.equal(result.queue.consumerId, expectedConsumerId);
  assert.equal(result.queue.leaseId, "lease:production-closure-001");
  assert.deepEqual(result.queue.events.map((event) => event.sequence), [1, 2, 3]);
  assert.equal(result.receipt.hash, fixture.evidence.receipt.hash);
  assert.deepEqual(
    result.reviews.map((review) => review.verificationAttestationHash),
    fixture.attestations.map((entry) => entry.hash),
  );
  assert.notEqual(
    fixture.attestations[0].hash,
    fixture.attestations[0].attestation.payloadHash,
  );
  assert.deepEqual(
    fixture.calls.map((call) => call.kind),
    ["closure", "queue", "queue-events", "attestations"],
  );
});

test("fake D1 lookup cannot let a different Run satisfy the closure", async () => {
  const fixture = await canonicalDatabaseFixture();
  await assert.rejects(
    readLiveClosureEvidence({
      database: fixture.database,
      state: fixture.state,
      evidence: {
        ...fixture.evidence,
        run: { ...fixture.evidence.run, id: "run:production-closure-other" },
      },
    }),
    (error) => error.code === "LIVE_CLOSURE_NOT_FOUND",
  );
});

test("fake D1 queue must be post-0043 consecutive, acknowledged, and consumed by the hosted consumer", async (context) => {
  async function rejects(mutator, expectedCode) {
    const fixture = await canonicalDatabaseFixture();
    mutator(fixture.rows);
    await assert.rejects(
      readLiveClosureEvidence({
        database: fixture.database,
        state: fixture.state,
        evidence: fixture.evidence,
      }),
      (error) => error.code === expectedCode,
    );
  }

  await context.test("wrong consumer", () => rejects(
    (rows) => { rows.queue.lease_consumer_id = "consumer:github-recovery"; },
    "LIVE_QUEUE_BINDING_MISMATCH",
  ));
  await context.test("legacy NULL sequence", () => rejects(
    (rows) => { rows.queueEvents[1].event_sequence = null; },
    "LIVE_QUEUE_SEQUENCE_INVALID",
  ));
  await context.test("sequence gap", () => rejects(
    (rows) => { rows.queueEvents[2].event_sequence = 4; },
    "LIVE_QUEUE_SEQUENCE_INVALID",
  ));
  await context.test("not acknowledged", () => rejects(
    (rows) => { rows.queue.delivery_state = "leased"; },
    "LIVE_QUEUE_NOT_ACKNOWLEDGED",
  ));
  await context.test("acknowledged before the Runner result was persisted", () => rejects(
    (rows) => {
      rows.queue.acknowledged_at = "2026-07-27T00:00:03.500Z";
      rows.queueEvents.at(-1).occurred_at = "2026-07-27T00:00:03.500Z";
    },
    "LIVE_QUEUE_TIME_MISMATCH",
  ));
});

test("normalized and bound live evidence reject acknowledgement before result persistence", async (context) => {
  const fixture = await canonicalDatabaseFixture();
  const reconstructed = await readLiveClosureEvidence({
    database: fixture.database,
    state: fixture.state,
    evidence: fixture.evidence,
  });
  const staleAcknowledgement = structuredClone(reconstructed);
  staleAcknowledgement.queue.acknowledgedAt = "2026-07-27T00:00:03.500Z";
  staleAcknowledgement.queue.events.at(-1).occurredAt = "2026-07-27T00:00:03.500Z";

  await context.test("normalization", () => {
    assert.throws(
      () => normalizeLiveEvidence(staleAcknowledgement),
      (error) => error.code === "LIVE_QUEUE_TIME_MISMATCH",
    );
  });

  await context.test("binding defense", () => {
    assert.throws(
      () => bindLiveEvidence({
        state: fixture.state,
        evidence: {
          ...fixture.evidence,
          reviews: reconstructed.reviews.map((review) => ({
            verificationAttestationId: review.verificationAttestationId,
            verificationAttestationHash: review.verificationAttestationHash,
            reviewerPersonId: review.reviewerPersonId,
            reviewerAgentId: review.reviewerAgentId,
          })),
        },
        live: staleAcknowledgement,
      }),
      (error) => error.code === "LIVE_QUEUE_TIME_MISMATCH",
    );
  });
});

test("fake D1 rejects stale timestamps and same-owner canonical attestations", async (context) => {
  await context.test("Run predates begin", async () => {
    const fixture = await canonicalDatabaseFixture();
    fixture.rows.closure.queued_at = "2026-07-26T23:59:59Z";
    await assert.rejects(
      readLiveClosureEvidence({
        database: fixture.database,
        state: fixture.state,
        evidence: fixture.evidence,
      }),
      (error) => error.code === "LIVE_RUN_NOT_FRESH",
    );
  });

  await context.test("same owner review", async () => {
    const fixture = await canonicalDatabaseFixture();
    fixture.rows.attestations[0].attempt_owner_person_id =
      fixture.rows.attestations[0].verifier_person_id;
    await assert.rejects(
      readLiveClosureEvidence({
        database: fixture.database,
        state: fixture.state,
        evidence: fixture.evidence,
      }),
      (error) => error.code === "LIVE_ATTESTATION_BINDING_MISMATCH",
    );
  });

  await context.test("Receipt predates begin", async () => {
    const fixture = await canonicalDatabaseFixture({
      issuedAt: "2026-07-26T23:59:59Z",
    });
    await assert.rejects(
      readLiveClosureEvidence({
        database: fixture.database,
        state: fixture.state,
        evidence: fixture.evidence,
      }),
      (error) => error.code === "LIVE_RECEIPT_NOT_FRESH",
    );
  });
});

test("current issuer keyset fetch is fixed-origin, no-redirect, JSON, and bounded", async (context) => {
  const origin = "https://proofweave.example";
  const validSource = JSON.stringify({ issuerKeys: [{ id: "issuer:production" }] });
  const response = (overrides = {}) => ({
    ok: true,
    redirected: false,
    url: `${origin}/api/receipts/issuer-keys`,
    headers: new Headers({
      "content-type": "application/json; charset=utf-8",
      "content-length": String(Buffer.byteLength(validSource)),
    }),
    text: async () => validSource,
    ...overrides,
  });
  const calls = [];
  const keyset = await fetchCurrentIssuerKeyset({
    siteOrigin: origin,
    fetcher: async (url, init) => {
      calls.push({ url: url.toString(), init });
      return response();
    },
  });
  assert.equal(keyset.issuerKeys[0].id, "issuer:production");
  assert.equal(calls[0].url, `${origin}/api/receipts/issuer-keys`);
  assert.equal(calls[0].init.redirect, "error");

  await context.test("redirect", async () => {
    await assert.rejects(
      fetchCurrentIssuerKeyset({
        siteOrigin: origin,
        fetcher: async () => response({ redirected: true }),
      }),
      (error) => error.code === "ISSUER_KEYSET_UNREACHABLE",
    );
  });
  await context.test("cross origin", async () => {
    await assert.rejects(
      fetchCurrentIssuerKeyset({
        siteOrigin: origin,
        fetcher: async () => response({
          url: "https://other.example/api/receipts/issuer-keys",
        }),
      }),
      (error) => error.code === "ISSUER_KEYSET_ORIGIN_INVALID",
    );
  });
  await context.test("non JSON", async () => {
    await assert.rejects(
      fetchCurrentIssuerKeyset({
        siteOrigin: origin,
        fetcher: async () => response({
          headers: new Headers({
            "content-type": "text/plain",
            "content-length": String(Buffer.byteLength(validSource)),
          }),
        }),
      }),
      (error) => error.code === "ISSUER_KEYSET_CONTENT_TYPE_INVALID",
    );
  });
  await context.test("oversized declaration", async () => {
    await assert.rejects(
      fetchCurrentIssuerKeyset({
        siteOrigin: origin,
        fetcher: async () => response({
          headers: new Headers({
            "content-type": "application/json",
            "content-length": String(1024 * 1024 + 1),
          }),
        }),
      }),
      (error) => error.code === "ISSUER_KEYSET_TOO_LARGE",
    );
  });
});

test("Turso fingerprint accepts only the canonical credential-free libsql origin", () => {
  const value = "libsql://proofweave-production.turso.io";
  assert.match(tursoDatabaseFingerprint(value), /^[a-f0-9]{16}$/);
  for (const invalid of [
    `${value}/`,
    `${value}?authToken=secret`,
    "https://proofweave-production.turso.io",
    "libsql://user:password@proofweave-production.turso.io",
  ]) {
    assert.throws(
      () => tursoDatabaseFingerprint(invalid),
      (error) => error.code === "TURSO_DATABASE_URL_INVALID",
    );
  }
});

async function canonicalDatabaseFixture({
  issuedAt = "2026-07-27T00:00:10Z",
} = {}) {
  const personId = "person:production-owner";
  const agentId = "agent:production-prover";
  const attemptId = "attempt:production-closure-001";
  const runId = "run:production-closure-001";
  const receiptId = "receipt:production-closure-001";
  const resultHash = sha("d");
  const attestations = await Promise.all(
    ["bundle_reproducible", "kernel_accepted", "project_accepted"].map(
      (claimType, index) => signedAttestation({ claimType, index }),
    ),
  );
  const issuerPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  );
  const issuerPublicKey = Buffer.from(
    await crypto.subtle.exportKey("raw", issuerPair.publicKey),
  ).toString("base64url");
  const receipt = await createContributionReceipt({
    receipt: {
      protocolVersion: "pw-contribution-receipt-v1",
      id: receiptId,
      kind: "proof_patch",
      beneficiary: {
        personId,
        agentId,
        delegationCertificateId: "delegation:production-prover",
      },
      attempt: {
        id: attemptId,
        personId,
        agentId,
        delegationCertificateId: "delegation:production-prover",
        problemRevisionId: "revision:production-target",
      },
      target: {
        declaration: "Proofweave.Production.closure",
        statementHash: sha("c"),
      },
      artifactBundleHash: bundleHash,
      bundle: { manifestHash: bundleHash, dependencyReceipts: [] },
      run: {
        id: runId,
        requestHash: sha("a"),
        resultHash,
        status: "succeeded",
        kernelStatus: "accepted",
      },
      claims: attestations.map(({ attestation, hash }) => ({
        claimType: attestation.claimType,
        verificationAttestationId: attestation.id,
        verificationAttestationHash: hash,
        artifactBundleHash: bundleHash,
        reviewerPersonId: attestation.verifierPersonId,
        reviewerAgentId: attestation.verifierAgentId,
        reviewerDelegationCertificateId: attestation.delegationCertificateId,
        decision: "attested",
      })),
      issuedAt,
      policyVersion: "pw-receipt-policy-v1",
      issuerKeyId: "issuer:production-receipts",
      issuerPublicKey,
    },
    issuerPrivateKey: issuerPair.privateKey,
  });
  const receiptHash = await contributionReceiptHash(receipt);
  const rows = {
    closure: {
      run_id: runId,
      attempt_id: attemptId,
      artifact_bundle_hash: bundleHash,
      request_hash: sha("a"),
      run_state: "succeeded",
      queued_at: "2026-07-27T00:00:01Z",
      started_at: "2026-07-27T00:00:02Z",
      finished_at: "2026-07-27T00:00:03Z",
      runner_result_hash: resultHash,
      attempt_person_id: personId,
      attempt_agent_id: agentId,
      result_hash: resultHash,
      received_at: "2026-07-27T00:00:04Z",
      receipt_id: receiptId,
      receipt_attempt_id: attemptId,
      beneficiary_person_id: personId,
      beneficiary_agent_id: agentId,
      receipt_bundle_hash: bundleHash,
      receipt_run_id: runId,
      receipt_hash: receiptHash,
      canonical_receipt: canonicalJson(receipt),
      issued_at: receipt.issuedAt,
    },
    queue: {
      run_id: runId,
      attempt_id: attemptId,
      delivery_state: "acknowledged",
      lease_id: "lease:production-closure-001",
      lease_consumer_id: expectedConsumerId,
      delivery_attempts: 1,
      enqueued_at: "2026-07-27T00:00:01Z",
      acknowledged_at: "2026-07-27T00:00:04Z",
    },
    queueEvents: [
      queueEvent(1, "enqueued", "queued", null, 0, "2026-07-27T00:00:01Z"),
      queueEvent(
        2,
        "lease_claimed",
        "leased",
        "lease:production-closure-001",
        1,
        "2026-07-27T00:00:02Z",
      ),
      queueEvent(
        3,
        "acknowledged",
        "acknowledged",
        "lease:production-closure-001",
        1,
        "2026-07-27T00:00:04Z",
      ),
    ],
    attestations: attestations.map(({ attestation }) => ({
      id: attestation.id,
      assignment_id: attestation.assignmentId,
      artifact_bundle_manifest_hash: attestation.artifactBundleHash,
      claim_type: attestation.claimType,
      verifier_person_id: attestation.verifierPersonId,
      verifier_agent_id: attestation.verifierAgentId,
      delegation_certificate_id: attestation.delegationCertificateId,
      verifier_agent_public_key: attestation.verifierAgentPublicKey,
      decision: attestation.decision,
      evidence_hash: attestation.evidenceHash,
      canonical_payload: canonicalJson(attestation),
      payload_hash: attestation.payloadHash,
      signature: attestation.signature,
      attested_at: attestation.attestedAt,
      attempt_owner_person_id: personId,
      assignment_verifier_person_id: attestation.verifierPersonId,
      assignment_bundle_hash: bundleHash,
      assignment_claim_type: attestation.claimType,
      assignment_status: "completed",
      assignment_completed_at: attestation.attestedAt,
    })),
  };
  const calls = [];
  const database = fakeDatabase({ rows, calls, runId, receiptId });
  return {
    database,
    rows,
    calls,
    attestations: attestations.sort((left, right) => left.attestation.id.localeCompare(right.attestation.id)),
    state: {
      createdAt,
      participant: { personId, agentId },
      artifactBundleHash: bundleHash,
      release: {
        expectedRunnerConsumerId: expectedConsumerId,
        databaseFingerprint: "0123456789abcdef",
      },
    },
    evidence: {
      run: { id: runId, resultHash },
      receipt: { id: receiptId, hash: receiptHash },
    },
  };
}

function fakeDatabase({ rows, calls, runId, receiptId }) {
  return {
    prepare(sql) {
      let kind;
      if (sql.includes("FROM runs AS run")) kind = "closure";
      else if (sql.includes("FROM runner_queue_messages")) kind = "queue";
      else if (sql.includes("FROM runner_queue_events")) kind = "queue-events";
      else if (sql.includes("FROM verification_attestations")) kind = "attestations";
      else throw new Error(`Unexpected fake query: ${sql}`);
      return {
        bind(...args) {
          calls.push({ kind, args });
          return {
            async first() {
              if (kind === "closure") {
                return args[0] === receiptId && args[1] === runId ? rows.closure : null;
              }
              if (kind === "queue") return args[0] === runId ? rows.queue : null;
              throw new Error(`first() not supported for ${kind}`);
            },
            async all() {
              if (kind === "queue-events") {
                return { results: args[0] === runId ? rows.queueEvents : [] };
              }
              if (kind === "attestations") return { results: rows.attestations };
              throw new Error(`all() not supported for ${kind}`);
            },
          };
        },
      };
    },
  };
}

async function signedAttestation({ claimType, index }) {
  const pair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  );
  const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey))
    .toString("base64url");
  const draft = {
    protocolVersion: "pw-verification-attestation-v1",
    id: `attestation:production-review-${index + 1}`,
    assignmentId: `assignment:production-review-${index + 1}`,
    artifactBundleHash: bundleHash,
    claimType,
    verifierPersonId: `person:production-reviewer-${index + 1}`,
    verifierAgentId: `agent:production-reviewer-${index + 1}`,
    delegationCertificateId: `delegation:production-reviewer-${index + 1}`,
    verifierAgentPublicKey: publicKey,
    decision: "attested",
    evidenceHash: sha(String(index + 5)),
    attestedAt: `2026-07-27T00:00:0${index + 6}Z`,
    payloadHash: sha("0"),
    signature: Buffer.alloc(64).toString("base64url"),
  };
  draft.payloadHash = await verificationAttestationPayloadHash(draft);
  draft.signature = Buffer.from(await crypto.subtle.sign(
    "Ed25519",
    pair.privateKey,
    canonicalUtf8(verificationAttestationSigningPayload(draft)),
  )).toString("base64url");
  return {
    attestation: draft,
    hash: await sha256Canonical(draft),
  };
}

function queueEvent(sequence, eventType, deliveryState, leaseId, deliveryAttempt, occurredAt) {
  return {
    id: `queue-event:production-${sequence}`,
    event_type: eventType,
    delivery_state: deliveryState,
    lease_id: leaseId,
    delivery_attempt: deliveryAttempt,
    occurred_at: occurredAt,
    event_sequence: sequence,
  };
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}
