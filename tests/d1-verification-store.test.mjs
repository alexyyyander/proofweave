import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import {
  D1VerificationStore,
  VerificationStoreCapacityError,
  VerificationStoreConflictError,
} from "../services/verification/d1-verification-store.mjs";
import { closedAlphaReviewLimits } from "../packages/domain/attempt-policy.mjs";
import {
  verificationAttestationPayloadHash,
  verificationAttestationSigningPayload,
} from "../packages/protocol/verification-attestation.mjs";
import {
  canonicalVerificationReplayEvidence,
  normalizeVerificationReplayEvidence,
  verificationReplayEvidenceHash,
} from "../packages/protocol/verification-replay-evidence.mjs";
import { canonicalJson, sha256Canonical } from "../packages/protocol/canonical-json.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
let miniflare;
let database;
let reviewerKeyPair;
let reviewerPublicKey;

before(async () => {
  reviewerKeyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  reviewerPublicKey = base64Url(await crypto.subtle.exportKey("raw", reviewerKeyPair.publicKey));
  miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
  });
  database = await miniflare.getD1Database("DB");
  await applyMigrations(database);
  await seedBundle(database, reviewerPublicKey);
});

after(async () => {
  await miniflare?.dispose();
});

test("D1 Verification store enforces different-owner review and persists signed evidence", async () => {
  const store = new D1VerificationStore(database);
  await assert.rejects(
    store.assign({
      id: "assignment:self-review", artifactBundleManifestHash: sha("a"), claimType: "kernel_accepted",
      verifierPersonId: "person:alice", assignedAt: "2026-07-13T00:00:00Z",
    }),
    /cannot independently review their own Attempt/,
  );

  const assigned = await store.assign({
    id: "assignment:bob-review", artifactBundleManifestHash: sha("a"), claimType: "kernel_accepted",
    verifierPersonId: "person:bob", assignedAt: "2026-07-13T00:00:00Z",
  });
  assert.equal(assigned.created, true);
  assert.equal((await store.assign({
    id: "assignment:retry", artifactBundleManifestHash: sha("a"), claimType: "kernel_accepted",
    verifierPersonId: "person:bob", assignedAt: "2026-07-13T00:00:01Z",
  })).created, false);

  const accepted = await store.accept("assignment:bob-review", "person:bob", "2026-07-13T00:00:02Z");
  const replay = await seedReplayEvidence(database, {
    assignmentId: "assignment:bob-review",
    bundleHash: sha("a"),
    tag: "bob-review",
    requestedAt: "2026-07-13T00:00:02Z",
    startedAt: "2026-07-13T00:00:02Z",
    finishedAt: "2026-07-13T00:00:02.500Z",
    recordedAt: "2026-07-13T00:00:02.500Z",
  });
  const attestation = await signedAttestation({ evidenceHash: replay.evidenceHash });
  const recorded = await store.recordAttestation(attestation);
  assert.equal(accepted.status, "accepted");
  assert.equal(recorded.created, true);
  assert.equal((await store.recordAttestation(attestation)).created, false);

  await store.assign({
    id: "assignment:bob-request-changes",
    artifactBundleManifestHash: sha("a"),
    claimType: "statement_faithful",
    verifierPersonId: "person:bob",
    assignedAt: "2026-07-13T00:00:04Z",
  });
  await store.accept("assignment:bob-request-changes", "person:bob", "2026-07-13T00:00:05Z");
  const requestedChanges = await store.recordAttestation(await signedAttestation({
    id: "attestation:bob-request-changes",
    assignmentId: "assignment:bob-request-changes",
    claimType: "statement_faithful",
    decision: "request_changes",
    attestedAt: "2026-07-13T00:00:06Z",
  }));
  assert.equal(requestedChanges.created, true);
  assert.equal(requestedChanges.attestation.decision, "request_changes");
  assert.equal((await store.requireAssignment("assignment:bob-request-changes")).status, "completed");
  const storedRequestChanges = await database
    .prepare("SELECT decision FROM verification_attestations WHERE id = ?")
    .bind("attestation:bob-request-changes")
    .first();
  assert.equal(storedRequestChanges?.decision, "request_changes");

  await store.assign({
    id: "assignment:bob-integrity-flag",
    artifactBundleManifestHash: sha("a"),
    claimType: "bundle_reproducible",
    verifierPersonId: "person:bob",
    assignedAt: "2026-07-13T00:00:07Z",
  });
  await store.accept("assignment:bob-integrity-flag", "person:bob", "2026-07-13T00:00:08Z");
  const integrityFlag = await store.recordAttestation(await signedAttestation({
    id: "attestation:bob-integrity-flag",
    assignmentId: "assignment:bob-integrity-flag",
    claimType: "bundle_reproducible",
    decision: "integrity_flagged",
    attestedAt: "2026-07-13T00:00:09Z",
  }));
  assert.equal(integrityFlag.attestation.decision, "integrity_flagged");
  assert.equal((await store.requireAssignment("assignment:bob-integrity-flag")).status, "completed");

  await database.batch([
    database
      .prepare("INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)")
      .bind(sha("6"), `bundles/sha256/${"6".repeat(64)}/bundle.json`, 2, "application/json"),
    database
      .prepare(
        `INSERT INTO artifact_bundles (
          id, attempt_id, problem_revision_id, manifest_hash, manifest_key,
          canonical_manifest, agent_event_id, agent_event_payload_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        "bundle:verification-positive-replay-required", "attempt:verification", "revision:verification", sha("6"),
        `bundles/sha256/${"6".repeat(64)}/bundle.json`, "{}", "agent-event:verification-positive-replay-required", sha("d"),
      ),
  ]);
  await store.assign({
    id: "assignment:bob-positive-replay-required",
    artifactBundleManifestHash: sha("6"),
    claimType: "bundle_reproducible",
    verifierPersonId: "person:bob",
    assignedAt: "2026-07-13T00:00:10Z",
  });
  await store.accept("assignment:bob-positive-replay-required", "person:bob", "2026-07-13T00:00:11Z");
  await assert.rejects(
    store.recordAttestation(await signedAttestation({
      id: "attestation:bob-positive-replay-required",
      assignmentId: "assignment:bob-positive-replay-required",
      claimType: "bundle_reproducible",
      artifactBundleHash: sha("6"),
      decision: "attested",
      attestedAt: "2026-07-13T00:00:12Z",
    })),
    /bundle_reproducible requires terminal fresh replay evidence/,
  );

  const events = await store.listEvents("assignment:bob-review");
  assert.deepEqual(events.map((event) => event.eventType), [
    "assignment_created",
    "assignment_accepted",
    "attestation_recorded",
  ]);
  await assert.rejects(
    database.prepare("UPDATE verification_assignments SET claim_type = ? WHERE id = ?").bind("novelty_reviewed", "assignment:bob-review").run(),
    /verification assignment identity is immutable/,
  );
  await assert.rejects(
    database.prepare("UPDATE verification_attestations SET decision = ? WHERE id = ?").bind("rejected", attestation.id).run(),
    /verification attestations are immutable/,
  );
});

test("positive kernel acceptance requires this reviewer Agent's successful exact fresh replay", async () => {
  const store = new D1VerificationStore(database);
  const bundleHash = await seedAdditionalBundle(database, "kernel-truth-boundary");
  await store.assign({
    id: "assignment:kernel-truth-boundary",
    artifactBundleManifestHash: bundleHash,
    claimType: "kernel_accepted",
    verifierPersonId: "person:bob",
    assignedAt: "2026-07-13T01:00:00Z",
  });
  await store.accept("assignment:kernel-truth-boundary", "person:bob", "2026-07-13T01:00:01Z");

  await assert.rejects(
    store.recordAttestation(await signedAttestation({
      id: "attestation:kernel-ordinary-artifact",
      assignmentId: "assignment:kernel-truth-boundary",
      artifactBundleHash: bundleHash,
      evidenceHash: sha("b"),
      attestedAt: "2026-07-13T01:00:02Z",
    })),
    /kernel_accepted requires terminal fresh replay evidence/,
  );

  const foreignAssignmentBundle = await seedAdditionalBundle(database, "foreign-assignment-replay");
  await store.assign({
    id: "assignment:foreign-replay-source",
    artifactBundleManifestHash: foreignAssignmentBundle,
    claimType: "project_accepted",
    verifierPersonId: "person:bob",
    assignedAt: "2026-07-13T01:01:00Z",
  });
  await store.accept("assignment:foreign-replay-source", "person:bob", "2026-07-13T01:01:01Z");
  const foreignAssignmentReplay = await seedReplayEvidence(database, {
    assignmentId: "assignment:foreign-replay-source",
    bundleHash: foreignAssignmentBundle,
    tag: "foreign-assignment",
  });
  await assertKernelAttestationRejected(store, {
    id: "attestation:kernel-foreign-assignment",
    bundleHash,
    evidenceHash: foreignAssignmentReplay.evidenceHash,
  }, /kernel_accepted requires terminal fresh replay evidence/);

  const foreignBundle = await seedAdditionalBundle(database, "foreign-bundle-replay");
  const foreignBundleReplay = await seedReplayEvidence(database, {
    assignmentId: "assignment:kernel-truth-boundary",
    bundleHash: foreignBundle,
    tag: "foreign-bundle",
  });
  await assertKernelAttestationRejected(store, {
    id: "attestation:kernel-foreign-bundle",
    bundleHash,
    evidenceHash: foreignBundleReplay.evidenceHash,
  }, /does not match its assigned Bundle/);

  const foreignReviewerReplay = await seedReplayEvidence(database, {
    assignmentId: "assignment:kernel-truth-boundary",
    bundleHash,
    tag: "foreign-reviewer",
    requesterPersonId: "person:charlie",
    requesterAgentId: "agent:charlie-reviewer",
    delegationCertificateId: "delegation:charlie-reviewer",
    installationId: "installation:charlie-reviewer",
  });
  await assertKernelAttestationRejected(store, {
    id: "attestation:kernel-foreign-reviewer",
    bundleHash,
    evidenceHash: foreignReviewerReplay.evidenceHash,
  }, /kernel_accepted requires terminal fresh replay evidence/);

  const failedReplay = await seedReplayEvidence(database, {
    assignmentId: "assignment:kernel-truth-boundary",
    bundleHash,
    tag: "failed-run",
    resultOverrides: {
      status: "failed",
      exitCode: 1,
      kernelStatus: "not_run",
      checks: { network: "passed", noSorry: "not_run", allowedAxioms: "not_run", leanBuild: "failed" },
    },
  });
  await assertKernelAttestationRejected(store, {
    id: "attestation:kernel-failed-run",
    bundleHash,
    evidenceHash: failedReplay.evidenceHash,
  }, /requires a succeeded fresh replay/);

  const rejectedKernelReplay = await seedReplayEvidence(database, {
    assignmentId: "assignment:kernel-truth-boundary",
    bundleHash,
    tag: "kernel-rejected",
    resultOverrides: {
      status: "rejected",
      exitCode: 1,
      kernelStatus: "rejected",
      checks: { network: "passed", noSorry: "failed", allowedAxioms: "passed", leanBuild: "passed" },
    },
  });
  await assertKernelAttestationRejected(store, {
    id: "attestation:kernel-rejected",
    bundleHash,
    evidenceHash: rejectedKernelReplay.evidenceHash,
  }, /requires a succeeded fresh replay/);

  const missingCheckReplay = await seedReplayEvidence(database, {
    assignmentId: "assignment:kernel-truth-boundary",
    bundleHash,
    tag: "missing-check",
    allowMalformedResult: true,
    resultOverrides: {
      checks: { network: "passed", noSorry: "passed", leanBuild: "passed" },
    },
  });
  await assertKernelAttestationRejected(store, {
    id: "attestation:kernel-missing-check",
    bundleHash,
    evidenceHash: missingCheckReplay.evidenceHash,
  }, /Fresh replay evidence is malformed/);

  const validReplay = await seedReplayEvidence(database, {
    assignmentId: "assignment:kernel-truth-boundary",
    bundleHash,
    tag: "valid-kernel-replay",
  });
  const recorded = await store.recordAttestation(await signedAttestation({
    id: "attestation:kernel-valid-replay",
    assignmentId: "assignment:kernel-truth-boundary",
    artifactBundleHash: bundleHash,
    evidenceHash: validReplay.evidenceHash,
    attestedAt: "2026-07-13T01:00:02Z",
  }));
  assert.equal(recorded.created, true);
  assert.equal((await store.requireAssignment("assignment:kernel-truth-boundary")).status, "completed");
});

test("attestation closure is atomic and canonical retries repair only exact legacy partial state", async () => {
  const store = new D1VerificationStore(database);
  const atomicBundleHash = await seedAdditionalBundle(database, "atomic-attestation");
  await store.assign({
    id: "assignment:atomic-attestation",
    artifactBundleManifestHash: atomicBundleHash,
    claimType: "statement_faithful",
    verifierPersonId: "person:bob",
    assignedAt: "2026-07-13T02:00:00Z",
  });
  await store.accept("assignment:atomic-attestation", "person:bob", "2026-07-13T02:00:01Z");
  await database
    .prepare(
      `INSERT INTO verification_assignment_events (
        id, assignment_id, sequence, event_type, status,
        payload_hash, canonical_payload, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      "verification-event:assignment:atomic-attestation:attestation",
      "assignment:atomic-attestation",
      3,
      "fixture_conflict",
      "completed",
      await sha256Canonical({ fixture: "atomic-event-conflict" }),
      canonicalJson({ fixture: "atomic-event-conflict" }),
      "2026-07-13T02:00:02Z",
    )
    .run();
  const atomicAttestation = await signedAttestation({
    id: "attestation:atomic-attestation",
    assignmentId: "assignment:atomic-attestation",
    artifactBundleHash: atomicBundleHash,
    claimType: "statement_faithful",
    evidenceHash: sha("b"),
    attestedAt: "2026-07-13T02:00:02Z",
  });
  await assert.rejects(store.recordAttestation(atomicAttestation));
  assert.equal((await store.requireAssignment("assignment:atomic-attestation")).status, "accepted");
  assert.equal(Number((await database
    .prepare("SELECT COUNT(*) AS count FROM verification_attestations WHERE assignment_id = ?")
    .bind("assignment:atomic-attestation")
    .first())?.count), 0);

  const legacyBundleHash = await seedAdditionalBundle(database, "legacy-partial-attestation");
  await store.assign({
    id: "assignment:legacy-partial-attestation",
    artifactBundleManifestHash: legacyBundleHash,
    claimType: "statement_faithful",
    verifierPersonId: "person:bob",
    assignedAt: "2026-07-13T02:01:00Z",
  });
  await store.accept("assignment:legacy-partial-attestation", "person:bob", "2026-07-13T02:01:01Z");
  const legacyAttestation = await signedAttestation({
    id: "attestation:legacy-partial-attestation",
    assignmentId: "assignment:legacy-partial-attestation",
    artifactBundleHash: legacyBundleHash,
    claimType: "statement_faithful",
    evidenceHash: sha("b"),
    attestedAt: "2026-07-13T02:01:02Z",
  });
  await insertAttestationFixture(database, legacyAttestation);

  const repaired = await store.recordAttestation(legacyAttestation);
  assert.equal(repaired.created, false);
  assert.equal((await store.requireAssignment("assignment:legacy-partial-attestation")).status, "completed");
  assert.deepEqual(
    (await store.listEvents("assignment:legacy-partial-attestation")).map((event) => event.eventType),
    ["assignment_created", "assignment_accepted", "attestation_recorded"],
  );
  assert.equal((await store.recordAttestation(legacyAttestation)).created, false);
  assert.equal(Number((await database
    .prepare("SELECT COUNT(*) AS count FROM verification_assignment_events WHERE assignment_id = ? AND event_type = ?")
    .bind("assignment:legacy-partial-attestation", "attestation_recorded")
    .first())?.count), 1);

  await assert.rejects(
    store.recordAttestation(await signedAttestation({
      id: legacyAttestation.id,
      assignmentId: legacyAttestation.assignmentId,
      artifactBundleHash: legacyAttestation.artifactBundleHash,
      claimType: legacyAttestation.claimType,
      decision: "request_changes",
      evidenceHash: legacyAttestation.evidenceHash,
      attestedAt: legacyAttestation.attestedAt,
    })),
    VerificationStoreConflictError,
  );
});

test("attestation projection races abort the entire batch without orphan evidence", async () => {
  const store = new D1VerificationStore(database);
  const bundleHash = await seedAdditionalBundle(database, "attestation-projection-race");
  const assignmentId = "assignment:attestation-projection-race";
  await store.assign({
    id: assignmentId,
    artifactBundleManifestHash: bundleHash,
    claimType: "statement_faithful",
    verifierPersonId: "person:bob",
    assignedAt: "2026-07-13T02:05:00Z",
  });
  await store.accept(assignmentId, "person:bob", "2026-07-13T02:05:01Z");
  const attestation = await signedAttestation({
    id: "attestation:attestation-projection-race",
    assignmentId,
    artifactBundleHash: bundleHash,
    claimType: "statement_faithful",
    evidenceHash: sha("b"),
    attestedAt: "2026-07-13T02:05:02Z",
  });
  let injectRace = true;
  const racingDatabase = {
    prepare(...args) {
      return database.prepare(...args);
    },
    async batch(statements) {
      if (injectRace) {
        injectRace = false;
        await database
          .prepare(
            `UPDATE verification_assignments
             SET status = 'completed', completed_at = ?, updated_at = ?
             WHERE id = ? AND status = 'accepted'`,
          )
          .bind("2026-07-13T02:05:09Z", "2026-07-13T02:05:09Z", assignmentId)
          .run();
      }
      return database.batch(statements);
    },
  };

  await assert.rejects(
    new D1VerificationStore(racingDatabase).recordAttestation(attestation),
  );
  assert.equal(injectRace, false);
  assert.equal(
    await database
      .prepare("SELECT id FROM verification_attestations WHERE assignment_id = ?")
      .bind(assignmentId)
      .first(),
    null,
  );
  assert.equal(
    await database
      .prepare("SELECT id FROM verification_assignment_events WHERE id = ?")
      .bind(`verification-event:${assignmentId}:attestation`)
      .first(),
    null,
  );
  assert.equal((await store.requireAssignment(assignmentId)).completedAt, "2026-07-13T02:05:09Z");
});

test("unsafe legacy closure races cannot append an immutable attestation event", async () => {
  const store = new D1VerificationStore(database);
  const bundleHash = await seedAdditionalBundle(database, "unsafe-legacy-closure-race");
  const assignmentId = "assignment:unsafe-legacy-closure-race";
  await store.assign({
    id: assignmentId,
    artifactBundleManifestHash: bundleHash,
    claimType: "statement_faithful",
    verifierPersonId: "person:bob",
    assignedAt: "2026-07-13T02:06:00Z",
  });
  await store.accept(assignmentId, "person:bob", "2026-07-13T02:06:01Z");
  const attestation = await signedAttestation({
    id: "attestation:unsafe-legacy-closure-race",
    assignmentId,
    artifactBundleHash: bundleHash,
    claimType: "statement_faithful",
    evidenceHash: sha("b"),
    attestedAt: "2026-07-13T02:06:02Z",
  });
  await insertAttestationFixture(database, attestation);
  let injectRace = true;
  const racingDatabase = {
    prepare(...args) {
      return database.prepare(...args);
    },
    async batch(statements) {
      if (injectRace) {
        injectRace = false;
        await database
          .prepare(
            `UPDATE verification_assignments
             SET status = 'completed', completed_at = ?, updated_at = ?
             WHERE id = ? AND status = 'accepted'`,
          )
          .bind("2026-07-13T02:06:09Z", "2026-07-13T02:06:09Z", assignmentId)
          .run();
      }
      return database.batch(statements);
    },
  };

  await assert.rejects(
    new D1VerificationStore(racingDatabase).recordAttestation(attestation),
    /completion time does not match/,
  );
  assert.equal(injectRace, false);
  assert.equal(
    await database
      .prepare("SELECT id FROM verification_assignment_events WHERE id = ?")
      .bind(`verification-event:${assignmentId}:attestation`)
      .first(),
    null,
  );
});

test("attestation history gates reject extra events before and after completion", async () => {
  const store = new D1VerificationStore(database);
  const acceptedBundleHash = await seedAdditionalBundle(database, "accepted-extra-history");
  const acceptedAssignmentId = "assignment:accepted-extra-history";
  await store.assign({
    id: acceptedAssignmentId,
    artifactBundleManifestHash: acceptedBundleHash,
    claimType: "statement_faithful",
    verifierPersonId: "person:bob",
    assignedAt: "2026-07-13T02:07:00Z",
  });
  await store.accept(acceptedAssignmentId, "person:bob", "2026-07-13T02:07:01Z");
  await insertAssignmentEventFixture(database, {
    id: `verification-event:${acceptedAssignmentId}:unexpected`,
    assignmentId: acceptedAssignmentId,
    sequence: 3,
    eventType: "fixture_later",
    status: "accepted",
    occurredAt: "2026-07-13T02:07:01.500Z",
    tag: "accepted-extra-history",
  });
  await assert.rejects(
    store.recordAttestation(await signedAttestation({
      id: "attestation:accepted-extra-history",
      assignmentId: acceptedAssignmentId,
      artifactBundleHash: acceptedBundleHash,
      claimType: "statement_faithful",
      evidenceHash: sha("b"),
      attestedAt: "2026-07-13T02:07:02Z",
    })),
    /exact immutable \[created, accepted\]/,
  );
  assert.equal(
    await database
      .prepare("SELECT id FROM verification_attestations WHERE assignment_id = ?")
      .bind(acceptedAssignmentId)
      .first(),
    null,
  );

  const completedBundleHash = await seedAdditionalBundle(database, "completed-extra-history");
  const completedAssignmentId = "assignment:completed-extra-history";
  await store.assign({
    id: completedAssignmentId,
    artifactBundleManifestHash: completedBundleHash,
    claimType: "statement_faithful",
    verifierPersonId: "person:bob",
    assignedAt: "2026-07-13T02:08:00Z",
  });
  await store.accept(completedAssignmentId, "person:bob", "2026-07-13T02:08:01Z");
  const completedAttestation = await signedAttestation({
    id: "attestation:completed-extra-history",
    assignmentId: completedAssignmentId,
    artifactBundleHash: completedBundleHash,
    claimType: "statement_faithful",
    evidenceHash: sha("b"),
    attestedAt: "2026-07-13T02:08:02Z",
  });
  await store.recordAttestation(completedAttestation);
  await insertAssignmentEventFixture(database, {
    id: `verification-event:${completedAssignmentId}:unexpected`,
    assignmentId: completedAssignmentId,
    sequence: 4,
    eventType: "fixture_later",
    status: "completed",
    occurredAt: "2026-07-13T02:08:03Z",
    tag: "completed-extra-history",
  });
  await assert.rejects(
    store.recordAttestation(completedAttestation),
    /exact immutable \[created, accepted, attestation\]/,
  );
});

test("assignment transitions roll back their projection when immutable event persistence conflicts", async () => {
  const store = new D1VerificationStore(database);
  for (const transition of ["accepted", "declined"]) {
    const tag = `transition-event-conflict-${transition}`;
    const assignmentId = `assignment:${tag}`;
    const occurredAt = transition === "accepted"
      ? "2026-07-13T02:10:01Z"
      : "2026-07-13T02:11:01Z";
    const bundleHash = await seedAdditionalBundle(database, tag);
    await store.assign({
      id: assignmentId,
      artifactBundleManifestHash: bundleHash,
      claimType: "statement_faithful",
      verifierPersonId: "person:charlie",
      assignedAt: transition === "accepted"
        ? "2026-07-13T02:10:00Z"
        : "2026-07-13T02:11:00Z",
    });
    await insertAssignmentEventFixture(database, {
      id: `verification-event:${assignmentId}:${transition}`,
      assignmentId,
      sequence: 2,
      eventType: "fixture_conflict",
      status: transition,
      occurredAt,
      tag,
    });

    await assert.rejects(
      transition === "accepted"
        ? store.accept(assignmentId, "person:charlie", occurredAt)
        : store.decline(assignmentId, "person:charlie", occurredAt),
      VerificationStoreConflictError,
    );
    const assignment = await store.requireAssignment(assignmentId);
    assert.equal(assignment.status, "assigned");
    assert.equal(assignment.acceptedAt, null);
    assert.equal(assignment.declinedAt, null);
  }

  const raceBundleHash = await seedAdditionalBundle(database, "transition-projection-race");
  const raceAssignmentId = "assignment:transition-projection-race";
  await store.assign({
    id: raceAssignmentId,
    artifactBundleManifestHash: raceBundleHash,
    claimType: "statement_faithful",
    verifierPersonId: "person:charlie",
    assignedAt: "2026-07-13T02:12:00Z",
  });
  let injectRace = true;
  const racingDatabase = {
    prepare(...args) {
      return database.prepare(...args);
    },
    async batch(statements) {
      if (injectRace) {
        injectRace = false;
        await database
          .prepare(
            `UPDATE verification_assignments
             SET status = 'declined', declined_at = ?, updated_at = ?
             WHERE id = ? AND status = 'assigned'`,
          )
          .bind("2026-07-13T02:12:01Z", "2026-07-13T02:12:01Z", raceAssignmentId)
          .run();
      }
      return database.batch(statements);
    },
  };
  const racingStore = new D1VerificationStore(racingDatabase);
  await assert.rejects(
    racingStore.accept(raceAssignmentId, "person:charlie", "2026-07-13T02:12:02Z"),
    VerificationStoreConflictError,
  );
  assert.equal((await store.requireAssignment(raceAssignmentId)).status, "declined");
  assert.equal(Number((await database
    .prepare("SELECT COUNT(*) AS count FROM verification_assignment_events WHERE id = ?")
    .bind(`verification-event:${raceAssignmentId}:accepted`)
    .first())?.count), 0);
});

test("canonical transition retries survive lost responses and repair only safe legacy projections", async () => {
  const store = new D1VerificationStore(database);
  const responseLostBundleHash = await seedAdditionalBundle(database, "transition-response-lost");
  const responseLostAssignmentId = "assignment:transition-response-lost";
  await store.assign({
    id: responseLostAssignmentId,
    artifactBundleManifestHash: responseLostBundleHash,
    claimType: "statement_faithful",
    verifierPersonId: "person:charlie",
    assignedAt: "2026-07-13T02:20:00Z",
  });
  let loseResponse = true;
  const responseLostDatabase = {
    prepare(...args) {
      return database.prepare(...args);
    },
    async batch(statements) {
      const results = await database.batch(statements);
      if (loseResponse) {
        loseResponse = false;
        throw new Error("fixture: response lost after transactional commit");
      }
      return results;
    },
  };
  const responseLostStore = new D1VerificationStore(responseLostDatabase);
  const recovered = await responseLostStore.accept(
    responseLostAssignmentId,
    "person:charlie",
    "2026-07-13T02:20:01Z",
  );
  assert.equal(recovered.status, "accepted");
  assert.equal((await store.accept(
    responseLostAssignmentId,
    "person:charlie",
    "2026-07-13T02:20:01Z",
  )).status, "accepted");
  assert.equal(Number((await database
    .prepare("SELECT COUNT(*) AS count FROM verification_assignment_events WHERE id = ?")
    .bind(`verification-event:${responseLostAssignmentId}:accepted`)
    .first())?.count), 1);

  for (const transition of ["accepted", "declined"]) {
    const tag = `legacy-transition-${transition}`;
    const assignmentId = `assignment:${tag}`;
    const assignedAt = transition === "accepted"
      ? "2026-07-13T02:21:00Z"
      : "2026-07-13T02:22:00Z";
    const occurredAt = transition === "accepted"
      ? "2026-07-13T02:21:01Z"
      : "2026-07-13T02:22:01Z";
    const bundleHash = await seedAdditionalBundle(database, tag);
    await store.assign({
      id: assignmentId,
      artifactBundleManifestHash: bundleHash,
      claimType: "statement_faithful",
      verifierPersonId: "person:charlie",
      assignedAt,
    });
    await database
      .prepare(
        `UPDATE verification_assignments
         SET status = ?, accepted_at = ?, declined_at = ?, updated_at = ?
         WHERE id = ? AND status = 'assigned'`,
      )
      .bind(
        transition,
        transition === "accepted" ? occurredAt : null,
        transition === "declined" ? occurredAt : null,
        occurredAt,
        assignmentId,
      )
      .run();

    const first = transition === "accepted"
      ? await store.accept(assignmentId, "person:charlie", occurredAt)
      : await store.decline(assignmentId, "person:charlie", occurredAt);
    assert.equal(first.status, transition);
    assert.deepEqual(
      (await store.listEvents(assignmentId)).map((event) => event.eventType),
      ["assignment_created", `assignment_${transition}`],
    );
    const retry = transition === "accepted"
      ? await store.accept(assignmentId, "person:charlie", occurredAt)
      : await store.decline(assignmentId, "person:charlie", occurredAt);
    assert.equal(retry.status, transition);
    assert.equal((await store.listEvents(assignmentId)).length, 2);
    await assert.rejects(
      transition === "accepted"
        ? store.accept(assignmentId, "person:charlie", "2026-07-13T02:23:01Z")
        : store.decline(assignmentId, "person:charlie", "2026-07-13T02:23:01Z"),
      VerificationStoreConflictError,
    );
  }
});

test("unsafe legacy acceptance history cannot be repaired or used for an attestation", async () => {
  const store = new D1VerificationStore(database);
  const bundleHash = await seedAdditionalBundle(database, "unsafe-legacy-acceptance");
  const assignmentId = "assignment:unsafe-legacy-acceptance";
  const acceptedAt = "2026-07-13T02:30:01Z";
  await store.assign({
    id: assignmentId,
    artifactBundleManifestHash: bundleHash,
    claimType: "statement_faithful",
    verifierPersonId: "person:bob",
    assignedAt: "2026-07-13T02:30:00Z",
  });
  await database
    .prepare(
      `UPDATE verification_assignments
       SET status = 'accepted', accepted_at = ?, updated_at = ?
       WHERE id = ? AND status = 'assigned'`,
    )
    .bind(acceptedAt, acceptedAt, assignmentId)
    .run();
  await insertAssignmentEventFixture(database, {
    id: `verification-event:${assignmentId}:fixture-later`,
    assignmentId,
    sequence: 2,
    eventType: "fixture_later",
    status: "accepted",
    occurredAt: "2026-07-13T02:30:02Z",
    tag: "unsafe-legacy-acceptance",
  });

  await assert.rejects(
    store.accept(assignmentId, "person:bob", acceptedAt),
    /repair is unsafe/,
  );
  await assert.rejects(
    store.recordAttestation(await signedAttestation({
      id: "attestation:unsafe-legacy-acceptance",
      assignmentId,
      artifactBundleHash: bundleHash,
      claimType: "statement_faithful",
      evidenceHash: sha("b"),
      attestedAt: "2026-07-13T02:30:03Z",
    })),
    /canonical immutable assignment acceptance event/,
  );
  assert.equal(Number((await database
    .prepare("SELECT COUNT(*) AS count FROM verification_attestations WHERE assignment_id = ?")
    .bind(assignmentId)
    .first())?.count), 0);
});

test("rejects a review attestation after its Person signing key is revoked", async () => {
  const store = new D1VerificationStore(database);
  await store.assign({
    id: "assignment:bob-after-key-revocation",
    artifactBundleManifestHash: sha("a"),
    claimType: "novelty_reviewed",
    verifierPersonId: "person:bob",
    assignedAt: "2026-07-13T00:00:04Z",
  });
  await store.accept("assignment:bob-after-key-revocation", "person:bob", "2026-07-13T00:00:05Z");
  await database
    .prepare("INSERT INTO person_key_revocations (id, person_key_id, owner_person_id, revoked_at, reason) VALUES (?, ?, ?, ?, ?)")
    .bind(
      "person-key-revocation:bob-reviewer",
      "person-key:bob",
      "person:bob",
      "2026-07-13T00:00:06Z",
      "Device replaced.",
    )
    .run();
  await assert.rejects(
    store.recordAttestation(await signedAttestation({
      id: "attestation:bob-after-key-revocation",
      assignmentId: "assignment:bob-after-key-revocation",
      claimType: "novelty_reviewed",
      attestedAt: "2026-07-13T00:00:07Z",
    })),
    /outside valid review delegation authority/,
  );
});

test("D1 review capacity is shared by every review Agent owned by the same Person", async () => {
  const store = new D1VerificationStore(database);
  await database
    .prepare("INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind("person:capacity-reviewer", "proofweave", "capacity-reviewer", "Capacity reviewer", "2026-07-13T00:00:00Z")
    .run();

  const bundleHashes = ["c", "d", "e", "f", "0", "1", "2", "3", "4"].map(sha);
  for (const [index, manifestHash] of bundleHashes.entries()) {
    await database.batch([
      database
        .prepare("INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)")
        .bind(manifestHash, `bundles/sha256/${manifestHash.slice("sha256:".length)}/bundle.json`, 2, "application/json"),
      database
        .prepare(
          `INSERT INTO artifact_bundles (
            id, attempt_id, problem_revision_id, manifest_hash, manifest_key,
            canonical_manifest, agent_event_id, agent_event_payload_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          `bundle:capacity-${index}`, "attempt:verification", "revision:verification", manifestHash,
          `bundles/sha256/${manifestHash.slice("sha256:".length)}/bundle.json`, "{}",
          `agent-event:capacity-${index}`, sha("9"),
        ),
    ]);
  }

  for (let index = 0; index < closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson; index += 1) {
    const result = await store.assign({
      id: `assignment:capacity-${index}`,
      artifactBundleManifestHash: bundleHashes[index],
      claimType: "kernel_accepted",
      verifierPersonId: "person:capacity-reviewer",
      assignedAt: `2026-07-13T00:0${index}:00Z`,
    });
    assert.equal(result.created, true);
  }

  await assert.rejects(
    store.assign({
      id: "assignment:capacity-exhausted",
      artifactBundleManifestHash: bundleHashes.at(-1),
      claimType: "kernel_accepted",
      verifierPersonId: "person:capacity-reviewer",
      assignedAt: "2026-07-13T00:09:00Z",
    }),
    VerificationStoreCapacityError,
  );

  const declined = await store.decline(
    "assignment:capacity-0",
    "person:capacity-reviewer",
    "2026-07-13T00:10:00Z",
  );
  assert.equal(declined.status, "declined");
  const released = await store.assign({
    id: "assignment:capacity-released",
    artifactBundleManifestHash: bundleHashes.at(-1),
    claimType: "kernel_accepted",
    verifierPersonId: "person:capacity-reviewer",
    assignedAt: "2026-07-13T00:11:00Z",
  });
  assert.equal(released.created, true);

  const active = await database
    .prepare("SELECT COUNT(*) AS count FROM verification_assignments WHERE verifier_person_id = ? AND status IN ('assigned', 'accepted')")
    .bind("person:capacity-reviewer")
    .first();
  assert.equal(Number(active?.count), closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson);
  const rejectedEvents = await database
    .prepare("SELECT COUNT(*) AS count FROM verification_assignment_events WHERE assignment_id = ?")
    .bind("assignment:capacity-exhausted")
    .first();
  assert.equal(Number(rejectedEvents?.count), 0);
});

async function signedAttestation({
  id = "attestation:bob-review",
  assignmentId = "assignment:bob-review",
  artifactBundleHash = sha("a"),
  claimType = "kernel_accepted",
  decision = "attested",
  evidenceHash = sha("b"),
  attestedAt = "2026-07-13T00:00:03Z",
} = {}) {
  const attestation = {
    protocolVersion: "pw-verification-attestation-v1",
    id,
    assignmentId,
    artifactBundleHash,
    claimType,
    verifierPersonId: "person:bob",
    verifierAgentId: "agent:bob-reviewer",
    delegationCertificateId: "delegation:bob-reviewer",
    verifierAgentPublicKey: reviewerPublicKey,
    decision,
    evidenceHash,
    attestedAt,
    payloadHash: sha("0"),
    signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  };
  attestation.payloadHash = await verificationAttestationPayloadHash(attestation);
  attestation.signature = base64Url(
    await crypto.subtle.sign(
      "Ed25519",
      reviewerKeyPair.privateKey,
      new TextEncoder().encode(canonicalJson(verificationAttestationSigningPayload(attestation))),
    ),
  );
  return attestation;
}

async function assertKernelAttestationRejected(store, { id, bundleHash, evidenceHash }, expected) {
  await assert.rejects(
    store.recordAttestation(await signedAttestation({
      id,
      assignmentId: "assignment:kernel-truth-boundary",
      artifactBundleHash: bundleHash,
      evidenceHash,
      attestedAt: "2026-07-13T01:00:02Z",
    })),
    expected,
  );
}

async function seedAdditionalBundle(d1, tag) {
  const manifestHash = await sha256Canonical({ fixture: "verification-bundle", tag });
  await d1.batch([
    d1
      .prepare("INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)")
      .bind(
        manifestHash,
        `bundles/sha256/${manifestHash.slice("sha256:".length)}/bundle.json`,
        2,
        "application/json",
      ),
    d1
      .prepare(
        `INSERT INTO artifact_bundles (
          id, attempt_id, problem_revision_id, manifest_hash, manifest_key,
          canonical_manifest, agent_event_id, agent_event_payload_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        `bundle:${tag}`,
        "attempt:verification",
        "revision:verification",
        manifestHash,
        `bundles/sha256/${manifestHash.slice("sha256:".length)}/bundle.json`,
        "{}",
        `agent-event:${tag}`,
        await sha256Canonical({ fixture: "agent-event", tag }),
      ),
  ]);
  return manifestHash;
}

async function seedReplayEvidence(d1, {
  assignmentId,
  bundleHash,
  tag,
  requesterPersonId = "person:bob",
  requesterAgentId = "agent:bob-reviewer",
  delegationCertificateId = "delegation:bob-reviewer",
  installationId = "installation:bob-reviewer",
  resultOverrides = {},
  allowMalformedResult = false,
  requestedAt = "2026-07-13T01:00:01Z",
  startedAt = "2026-07-13T01:00:01Z",
  finishedAt = "2026-07-13T01:00:01Z",
  recordedAt = "2026-07-13T01:00:01Z",
}) {
  const runId = `run:verification-replay:${tag}`;
  const replayId = `verification-replay:${tag}`;
  const baseResult = {
    protocolVersion: "pw-lean-runner-v1",
    jobId: runId,
    attemptId: "attempt:verification",
    requestHash: await sha256Canonical({ fixture: "replay-request", tag }),
    runnerKeyId: "runner-key:verification-fixture",
    runnerSignature: base64Url(new Uint8Array(64)),
    status: "succeeded",
    exitCode: 0,
    startedAt,
    finishedAt,
    kernelStatus: "accepted",
    checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
    artifacts: {
      manifestHash: bundleHash,
      stdoutHash: await sha256Canonical({ fixture: "stdout", tag }),
      stderrHash: await sha256Canonical({ fixture: "stderr", tag }),
    },
  };
  const runnerResult = {
    ...baseResult,
    ...resultOverrides,
    checks: resultOverrides.checks ?? baseResult.checks,
    artifacts: { ...baseResult.artifacts, ...(resultOverrides.artifacts ?? {}) },
  };
  const runnerResultHash = await sha256Canonical(runnerResult);
  const rawEvidence = {
    protocolVersion: "pw-verification-replay-evidence-v1",
    id: `verification-replay-evidence:${tag}`,
    replayId,
    assignmentId,
    runId,
    artifactBundleHash: bundleHash,
    runnerResultHash,
    runnerResult,
    recordedAt,
  };
  const evidence = allowMalformedResult
    ? rawEvidence
    : await normalizeVerificationReplayEvidence(rawEvidence);
  const canonicalEvidence = allowMalformedResult
    ? canonicalJson(evidence)
    : await canonicalVerificationReplayEvidence(evidence);
  const evidenceHash = allowMalformedResult
    ? await sha256Canonical(evidence)
    : await verificationReplayEvidenceHash(evidence);
  await d1.batch([
    d1
      .prepare("INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)")
      .bind(
        evidenceHash,
        `bundles/sha256/${evidenceHash.slice("sha256:".length)}/verification-replay-evidence.json`,
        new TextEncoder().encode(canonicalEvidence).byteLength,
        "application/vnd.proofweave.verification-replay-evidence+json",
      ),
    d1
      .prepare(
        `INSERT INTO runs (
          id, attempt_id, artifact_bundle_hash, request_hash, idempotency_key,
          state, queued_at, started_at, finished_at, runner_result_hash, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        runId,
        "attempt:verification",
        bundleHash,
        runnerResult.requestHash,
        `verification-replay:${tag}`,
        runnerResult.status,
        requestedAt,
        runnerResult.startedAt,
        runnerResult.finishedAt,
        runnerResultHash,
        runnerResult.finishedAt,
      ),
    d1
      .prepare("INSERT INTO run_results (run_id, result_hash, canonical_result, received_at) VALUES (?, ?, ?, ?)")
      .bind(runId, runnerResultHash, canonicalJson(runnerResult), recordedAt),
    d1
      .prepare(
        `INSERT INTO verification_replays (
          id, assignment_id, run_id, artifact_bundle_manifest_hash,
          requester_person_id, requester_agent_id, delegation_certificate_id,
          agent_installation_id, idempotency_key, requested_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        replayId,
        assignmentId,
        runId,
        bundleHash,
        requesterPersonId,
        requesterAgentId,
        delegationCertificateId,
        installationId,
        `verification-replay:${tag}`,
        requestedAt,
      ),
    d1
      .prepare(
        `INSERT INTO verification_replay_evidence (
          id, replay_id, assignment_id, run_id, artifact_bundle_manifest_hash,
          runner_result_hash, evidence_hash, canonical_evidence, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        evidence.id,
        replayId,
        assignmentId,
        runId,
        bundleHash,
        runnerResultHash,
        evidenceHash,
        canonicalEvidence,
        recordedAt,
      ),
  ]);
  return Object.freeze({ evidenceHash, replayId, runId, runnerResultHash });
}

async function insertAttestationFixture(d1, attestation) {
  await d1
    .prepare(
      `INSERT INTO verification_attestations (
        id, assignment_id, artifact_bundle_manifest_hash, claim_type,
        verifier_person_id, verifier_agent_id, delegation_certificate_id,
        verifier_agent_public_key, decision, evidence_hash, canonical_payload,
        payload_hash, signature, attested_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      attestation.id,
      attestation.assignmentId,
      attestation.artifactBundleHash,
      attestation.claimType,
      attestation.verifierPersonId,
      attestation.verifierAgentId,
      attestation.delegationCertificateId,
      attestation.verifierAgentPublicKey,
      attestation.decision,
      attestation.evidenceHash,
      canonicalJson(attestation),
      attestation.payloadHash,
      attestation.signature,
      attestation.attestedAt,
    )
    .run();
}

async function insertAssignmentEventFixture(d1, {
  id,
  assignmentId,
  sequence,
  eventType,
  status,
  occurredAt,
  tag,
}) {
  const payload = { fixture: tag };
  await d1
    .prepare(
      `INSERT INTO verification_assignment_events (
        id, assignment_id, sequence, event_type, status,
        payload_hash, canonical_payload, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      assignmentId,
      sequence,
      eventType,
      status,
      await sha256Canonical(payload),
      canonicalJson(payload),
      occurredAt,
    )
    .run();
}

async function seedBundle(d1, publicKey) {
  const manifestHash = sha("a");
  const evidenceHash = sha("b");
  const charliePublicKey = base64Url(new Uint8Array(32).fill(7));
  const statements = [
    ["INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)", ["person:alice", "proofweave", "alice", "Alice", "2026-07-01T00:00:00Z"]],
    ["INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)", ["person:bob", "proofweave", "bob", "Bob", "2026-07-01T00:00:00Z"]],
    [
      `INSERT INTO source_snapshots (id, upstream_name, source_url, revision_tag, revision_commit, retrieved_at, content_hash, manifest_hash, source_license, lean_toolchain, mathlib_revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["snapshot:verification", "fixture", "https://example.test/source", "v1", "abc123", "2026-07-01T00:00:00Z", sha("1"), sha("2"), "MIT", "leanprover/lean4:v4.27.0", "abc123"],
    ],
    ["INSERT INTO projects (id, slug, kind, title, summary) VALUES (?, ?, ?, ?, ?)", ["project:verification", "verification", "frontier", "Verification", "Fixture"]],
    [
      `INSERT INTO problem_revisions (id, project_id, source_snapshot_id, target_key, slug, revision_number, title, domain, research_status, informal_statement, lean_statement)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["revision:verification", "project:verification", "snapshot:verification", "verification-target", "verification-target", 1, "Verification target", "logic", "research_open", "fixture", "theorem fixture : True := by trivial"],
    ],
    [
      "INSERT INTO agent_attempts (id, person_id, problem_revision_id, agent_label, idempotency_key, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["attempt:verification", "person:alice", "revision:verification", "Alice Agent", "attempt-verification", "2026-07-01T00:00:00Z"],
    ],
    ["INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)", [manifestHash, `bundles/sha256/${"a".repeat(64)}/bundle.json`, 2, "application/json"]],
    ["INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)", [evidenceHash, `bundles/sha256/${"b".repeat(64)}/review.json`, 2, "application/json"]],
    [
      `INSERT INTO artifact_bundles (id, attempt_id, problem_revision_id, manifest_hash, manifest_key, canonical_manifest, agent_event_id, agent_event_payload_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["bundle:verification", "attempt:verification", "revision:verification", manifestHash, `bundles/sha256/${"a".repeat(64)}/bundle.json`, "{}", "agent-event:verification", sha("3")],
    ],
    ["INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)", ["agent:bob-reviewer", "person:bob", "Bob reviewer", publicKey, sha("4")]],
    ["INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)", ["person-key:bob", "person:bob", "person-key", sha("5")]],
    [
      `INSERT INTO delegation_certificates (id, owner_person_id, agent_id, person_key_id, agent_public_key, scopes_json, valid_from, valid_until, beneficiary_person_id, protocol_version, payload_hash, canonical_payload, person_signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["delegation:bob-reviewer", "person:bob", "agent:bob-reviewer", "person-key:bob", publicKey, '["review"]', "2026-07-01T00:00:00Z", "2027-07-01T00:00:00Z", "person:bob", "pw-delegation-v1", sha("6"), "{}", "signature"],
    ],
    ["INSERT INTO oauth_clients (id, client_name, redirect_uris_json) VALUES (?, ?, ?)", ["client:bob-reviewer", "Bob reviewer", '["https://codex.example.test/callback"]']],
    ["INSERT INTO agent_installations (id, person_id, agent_id, delegation_certificate_id, client_id, label) VALUES (?, ?, ?, ?, ?, ?)", ["installation:bob-reviewer", "person:bob", "agent:bob-reviewer", "delegation:bob-reviewer", "client:bob-reviewer", "Bob reviewer"]],
    ["INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)", ["person:charlie", "proofweave", "charlie", "Charlie", "2026-07-01T00:00:00Z"]],
    ["INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)", ["person-key:charlie", "person:charlie", "person-key-charlie", await sha256Canonical({ fixture: "charlie-person-key" })]],
    ["INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)", ["agent:charlie-reviewer", "person:charlie", "Charlie reviewer", charliePublicKey, await sha256Canonical({ fixture: "charlie-agent-key" })]],
    [
      `INSERT INTO delegation_certificates (id, owner_person_id, agent_id, person_key_id, agent_public_key, scopes_json, valid_from, valid_until, beneficiary_person_id, protocol_version, payload_hash, canonical_payload, person_signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["delegation:charlie-reviewer", "person:charlie", "agent:charlie-reviewer", "person-key:charlie", charliePublicKey, '["review"]', "2026-07-01T00:00:00Z", "2027-07-01T00:00:00Z", "person:charlie", "pw-delegation-v1", await sha256Canonical({ fixture: "charlie-delegation" }), "{}", "signature"],
    ],
    ["INSERT INTO oauth_clients (id, client_name, redirect_uris_json) VALUES (?, ?, ?)", ["client:charlie-reviewer", "Charlie reviewer", '["https://codex.example.test/callback"]']],
    ["INSERT INTO agent_installations (id, person_id, agent_id, delegation_certificate_id, client_id, label) VALUES (?, ?, ?, ?, ?, ?)", ["installation:charlie-reviewer", "person:charlie", "agent:charlie-reviewer", "delegation:charlie-reviewer", "client:charlie-reviewer", "Charlie reviewer"]],
  ];
  for (const [statement, values] of statements) await d1.prepare(statement).bind(...values).run();
}

async function applyMigrations(d1) {
  const filenames = (await readdir(migrationsRoot)).filter((filename) => filename.endsWith(".sql")).sort();
  for (const filename of filenames) {
    const source = await readFile(new URL(filename, migrationsRoot), "utf8");
    for (const statement of source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await d1.prepare(statement).run();
    }
  }
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}

function base64Url(buffer) {
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
