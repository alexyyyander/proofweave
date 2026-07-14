import fixture from "@/demo/fixtures/build-week-demo.json";
import {
  artifactBundleHash,
  verifyArtifactBundleAgentSignature,
} from "@/packages/protocol/artifact-bundle.mjs";
import {
  assertContributionReceiptPolicy,
  contributionReceiptHash,
  verifyContributionReceiptSignature,
} from "@/packages/protocol/contribution-receipt.mjs";
import { verifyLeanRunnerResultSignature } from "@/packages/protocol/lean-runner.mjs";
import { verifyVerificationAttestationSignature } from "@/packages/protocol/verification-attestation.mjs";
import {
  assertDelegationAllows,
  verifyDelegationSignature,
} from "@/packages/domain/delegation.mjs";

export type DemoVerificationCheck = {
  id: string;
  label: string;
  detail: string;
  passed: boolean;
};

export type BuildWeekDemoVerification = {
  status: "verified" | "failed";
  checkedAt: string;
  checks: readonly DemoVerificationCheck[];
  record: {
    target: string;
    source: string;
    leanVersion: string;
    repository: string;
    commitSha: string;
    bundleHash: string;
    receiptHash: string;
    owner: string;
    agent: string;
    reviewers: readonly string[];
  };
  disclosure: string;
};

export async function verifyBuildWeekDemoFixture(): Promise<BuildWeekDemoVerification> {
  const bundleHash = await artifactBundleHash(fixture.bundle);
  const receiptHash = await contributionReceiptHash(fixture.receipt);
  const objectHashes = await Promise.all(fixture.objects.map(async (object) => ({
    role: object.role,
    declared: object.contentHash,
    actual: await sha256Bytes(decodeObject(object)),
  })));
  const references = {
    source_archive: fixture.bundle.workspace.archive.contentHash,
    source_patch: fixture.bundle.workspace.patch.contentHash,
    lake_manifest: fixture.bundle.workspace.lakeManifest.contentHash,
  } as Record<string, string>;

  const checks = await Promise.all([
    check(
      "delegation",
      "Person delegation is valid",
      "The Person signature binds this Agent key and grants formalize/prove scope at the event time.",
      async () => {
        assertDelegationAllows(fixture.delegation.certificate, "prove", fixture.bundle.agentEvent.occurredAt);
        return fixture.delegation.certificate.agentPublicKey === fixture.bundle.agentEvent.agentPublicKey &&
          await verifyDelegationSignature({
            certificate: fixture.delegation.certificate,
            personPublicKey: fixture.delegation.personPublicKey,
            personSignature: fixture.delegation.personSignature,
          });
      },
    ),
    check(
      "bundle",
      "Agent bundle signature is valid",
      "The signed payload covers the target, Git commit, Lean environment, workspace hashes, and proof policy.",
      async () => bundleHash === fixture.receipt.artifactBundleHash &&
        await verifyArtifactBundleAgentSignature(fixture.bundle),
    ),
    check(
      "objects",
      "Artifact bytes match their hashes",
      "The archive, normalized patch, and Lake manifest re-hash to the content-addressed Bundle references.",
      async () => objectHashes.every((object) => (
        object.actual === object.declared && references[object.role] === object.declared
      )) && await sha256Bytes(new TextEncoder().encode(fixture.source.content)) === fixture.source.contentHash,
    ),
    check(
      "runner",
      "Runner result signature is valid",
      "The signed result binds the exact request and reports Lean success, kernel acceptance, no sorry, and bounded outputs.",
      async () => fixture.runner.result.artifacts.manifestHash === bundleHash &&
        fixture.runner.result.status === "succeeded" &&
        fixture.runner.result.kernelStatus === "accepted" &&
        fixture.runner.result.checks.noSorry === "passed" &&
        await verifyLeanRunnerResultSignature({
          result: fixture.runner.result,
          runnerPublicKey: fixture.runner.publicKey,
        }),
    ),
    check(
      "review",
      "Independent attestations are signed",
      "Different Person-owned review Agents attest reproducibility, kernel acceptance, and project acceptance separately.",
      async () => fixture.attestations.every((attestation) => (
        attestation.artifactBundleHash === bundleHash &&
        attestation.verifierPersonId !== fixture.receipt.attempt.personId
      )) && (await Promise.all(fixture.attestations.map((attestation) => (
        verifyVerificationAttestationSignature(attestation)
      )))).every(Boolean),
    ),
    check(
      "receipt",
      "Reference receipt satisfies policy",
      "The issuer signature covers attribution, Bundle, Run, and all required independent review claims.",
      async () => {
        assertContributionReceiptPolicy(fixture.receipt);
        return receiptHash === fixture.receiptHash && await verifyContributionReceiptSignature(fixture.receipt);
      },
    ),
  ]);

  return {
    status: checks.every((candidate) => candidate.passed) ? "verified" : "failed",
    checkedAt: new Date().toISOString(),
    checks,
    record: {
      target: fixture.bundle.target.declaration,
      source: fixture.source.content,
      leanVersion: fixture.source.leanVersion,
      repository: fixture.bundle.repositorySnapshot.repository,
      commitSha: fixture.bundle.repositorySnapshot.commitSha,
      bundleHash,
      receiptHash,
      owner: fixture.receipt.beneficiary.personId,
      agent: fixture.receipt.beneficiary.agentId,
      reviewers: [...new Set(fixture.attestations.map((attestation) => attestation.verifierPersonId))],
    },
    disclosure: fixture.disclosure,
  };
}

async function check(
  id: string,
  label: string,
  detail: string,
  verify: () => Promise<boolean>,
): Promise<DemoVerificationCheck> {
  try {
    return { id, label, detail, passed: await verify() };
  } catch {
    return { id, label, detail, passed: false };
  }
}

function decodeObject(object: (typeof fixture.objects)[number]): Uint8Array {
  if (object.encoding === "base64") {
    const binary = atob(object.content);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  return new TextEncoder().encode(object.content);
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer));
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
