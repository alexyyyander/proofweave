import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  artifactBundleHash,
  verifyArtifactBundleAgentSignature,
} from "../packages/protocol/artifact-bundle.mjs";
import {
  assertContributionReceiptPolicy,
  contributionReceiptHash,
  verifyContributionReceiptSignature,
} from "../packages/protocol/contribution-receipt.mjs";
import { verifyLeanRunnerResultSignature } from "../packages/protocol/lean-runner.mjs";
import { verifyVerificationAttestationSignature } from "../packages/protocol/verification-attestation.mjs";
import {
  assertDelegationAllows,
  verifyDelegationSignature,
} from "../packages/domain/delegation.mjs";

const fixture = JSON.parse(await readFile(
  new URL("../demo/fixtures/build-week-demo.json", import.meta.url),
  "utf8",
));

test("the Build Week reference fixture verifies across every published trust boundary", async () => {
  assert.equal(fixture.fixtureProtocolVersion, "pw-build-week-demo-v1");
  assert.equal(
    await verifyDelegationSignature({
      certificate: fixture.delegation.certificate,
      personPublicKey: fixture.delegation.personPublicKey,
      personSignature: fixture.delegation.personSignature,
    }),
    true,
  );
  assert.equal(
    assertDelegationAllows(
      fixture.delegation.certificate,
      "prove",
      fixture.bundle.agentEvent.occurredAt,
    ).agentPublicKey,
    fixture.bundle.agentEvent.agentPublicKey,
  );

  const bundleHash = await artifactBundleHash(fixture.bundle);
  assert.equal(bundleHash, fixture.receipt.artifactBundleHash);
  assert.equal(await verifyArtifactBundleAgentSignature(fixture.bundle), true);
  assert.equal(fixture.runner.result.artifacts.manifestHash, bundleHash);
  assert.equal(await verifyLeanRunnerResultSignature({
    result: fixture.runner.result,
    runnerPublicKey: fixture.runner.publicKey,
  }), true);

  for (const object of fixture.objects) {
    const bytes = object.encoding === "base64"
      ? Buffer.from(object.content, "base64")
      : Buffer.from(object.content, "utf8");
    assert.equal(sha256(bytes), object.contentHash);
  }
  assert.equal(sha256(fixture.source.content), fixture.source.contentHash);

  assert.equal(fixture.attestations.length, 3);
  for (const attestation of fixture.attestations) {
    assert.notEqual(attestation.verifierPersonId, fixture.receipt.attempt.personId);
    assert.equal(await verifyVerificationAttestationSignature(attestation), true);
  }

  assert.equal(assertContributionReceiptPolicy(fixture.receipt).id, fixture.receipt.id);
  assert.equal(await verifyContributionReceiptSignature(fixture.receipt), true);
  assert.equal(await contributionReceiptHash(fixture.receipt), fixture.receiptHash);
});

test("tampering with the checked Agent payload invalidates the demo Bundle signature", async () => {
  assert.equal(await verifyArtifactBundleAgentSignature({
    ...fixture.bundle,
    repositorySnapshot: {
      ...fixture.bundle.repositorySnapshot,
      commitSha: "0".repeat(40),
    },
  }), false);
});

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
