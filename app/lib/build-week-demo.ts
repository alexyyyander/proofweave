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
  method: string;
  input: string;
  evidence: string;
  result: string;
  durationMs: number;
};

export type DemoVerificationMode = "reference" | "tampered_copy";

export type DemoJourneyStage = {
  id: "delegate" | "bundle" | "lean" | "review" | "receipt";
  number: string;
  title: string;
  actor: string;
  actorMode: "local_reference" | "mock_second_account" | "protocol_issuer";
  detail: string;
  evidence: string;
  passed: boolean;
};

export type BuildWeekDemoVerification = {
  status: "verified" | "failed";
  verificationId: string;
  protocolVersion: string;
  mode: DemoVerificationMode;
  startedAt: string;
  checkedAt: string;
  durationMs: number;
  checks: readonly DemoVerificationCheck[];
  executionBoundary: {
    evidenceSource: "checked_in_reference_fixture";
    signedEvidenceReverified: true;
    leanReplay: "not_run_by_this_request";
    statement: string;
  };
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
  journey: readonly DemoJourneyStage[];
  mockReviewer: {
    personId: string;
    agentId: string;
    mode: "mock_second_account";
    independentFromResearcher: boolean;
    signedClaimCount: number;
  };
  creditPreview: {
    status: "receipt_derived_preview_not_settled";
    unit: "non_transferable_research_credit";
    transferable: false;
    researcher: readonly { label: string; value: number }[];
    mockReviewer: readonly { label: string; value: number }[];
  };
  disclosure: string;
};

export async function verifyBuildWeekDemoFixture(
  options: { mode?: DemoVerificationMode; stableRun?: boolean } = {},
): Promise<BuildWeekDemoVerification> {
  const mode = options.mode ?? "reference";
  const stableRun = options.stableRun === true;
  const checkedFixture = mode === "tampered_copy" ? structuredClone(fixture) : fixture;
  if (mode === "tampered_copy") tamperOneArtifactByte(checkedFixture);

  const startedAt = stableRun ? checkedFixture.runner.result.startedAt : new Date().toISOString();
  const started = preciseNow();
  const verificationId = stableRun
    ? "vrf_reference_fixture"
    : `vrf_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const bundleHash = await artifactBundleHash(checkedFixture.bundle);
  const receiptHash = await contributionReceiptHash(checkedFixture.receipt);
  const references = {
    source_archive: checkedFixture.bundle.workspace.archive.contentHash,
    source_patch: checkedFixture.bundle.workspace.patch.contentHash,
    lake_manifest: checkedFixture.bundle.workspace.lakeManifest.contentHash,
  } as Record<string, string>;

  const measuredChecks = await Promise.all([
    check(
      {
        id: "delegation",
        label: "Person delegation is valid",
        detail: "The Person signature binds this Agent key and grants formalize/prove scope at the event time.",
        method: "Delegation policy + Ed25519 signature",
        input: `${checkedFixture.delegation.certificate.id} · scope prove`,
        evidence: checkedFixture.delegation.payloadHash,
        failureResult: "Delegation scope, validity, Agent binding, or Person signature did not verify.",
      },
      async () => {
        assertDelegationAllows(checkedFixture.delegation.certificate, "prove", checkedFixture.bundle.agentEvent.occurredAt);
        const passed = checkedFixture.delegation.certificate.agentPublicKey === checkedFixture.bundle.agentEvent.agentPublicKey &&
          await verifyDelegationSignature({
            certificate: checkedFixture.delegation.certificate,
            personPublicKey: checkedFixture.delegation.personPublicKey,
            personSignature: checkedFixture.delegation.personSignature,
          });
        return {
          passed,
          result: `Valid at ${checkedFixture.bundle.agentEvent.occurredAt} · scopes ${checkedFixture.delegation.certificate.scopes.join(", ")}`,
        };
      },
    ),
    check(
      {
        id: "bundle",
        label: "Agent bundle signature is valid",
        detail: "The signed payload covers the target, Git commit, Lean environment, workspace hashes, and proof policy.",
        method: "Canonical Bundle hash + Ed25519 signature",
        input: `${checkedFixture.bundle.id} · ${checkedFixture.bundle.repositorySnapshot.commitSha}`,
        evidence: bundleHash,
        failureResult: "The Bundle hash no longer matches the Receipt, or the Agent signature is invalid.",
      },
      async () => {
        const currentBundleHash = await artifactBundleHash(checkedFixture.bundle);
        const passed = currentBundleHash === checkedFixture.receipt.artifactBundleHash &&
          await verifyArtifactBundleAgentSignature(checkedFixture.bundle);
        return { passed, result: "Bundle hash matches Receipt · Agent signature valid." };
      },
    ),
    check(
      {
        id: "objects",
        label: "Artifact bytes match their hashes",
        detail: "The archive, normalized patch, Lake manifest, and Lean source are re-hashed from their current bytes.",
        method: "SHA-256 over stored artifact bytes",
        input: `${checkedFixture.objects.length + 1} payloads · archive, patch, manifest, Lean source`,
        evidence: checkedFixture.bundle.workspace.tree.hash,
        failureResult: "At least one current byte payload does not match its declared SHA-256 hash.",
      },
      async () => {
        const objectHashes = await Promise.all(checkedFixture.objects.map(async (object) => ({
          role: object.role,
          declared: object.contentHash,
          actual: await sha256Bytes(decodeObject(object)),
        })));
        const mismatchedObject = objectHashes.find((object) => (
          object.actual !== object.declared || references[object.role] !== object.declared
        ));
        const sourceMatches = await sha256Bytes(new TextEncoder().encode(checkedFixture.source.content)) === checkedFixture.source.contentHash;
        const passed = !mismatchedObject && sourceMatches;
        return {
          passed,
          result: passed
            ? `${checkedFixture.objects.length + 1}/${checkedFixture.objects.length + 1} current byte payloads match their declared hashes.`
            : `Hash mismatch detected in ${mismatchedObject?.role ?? "Lean source"}; the signed original was not modified.`,
        };
      },
    ),
    check(
      {
        id: "runner",
        label: "Recorded Runner result is valid",
        detail: "This verifies the signed historical Runner result and its kernel policy fields; it does not start Lean again.",
        method: "Runner Ed25519 signature + recorded policy fields",
        input: `${checkedFixture.runner.result.jobId} · ${checkedFixture.bundle.environment.leanToolchain}`,
        evidence: checkedFixture.runner.result.requestHash,
        failureResult: "The recorded Runner signature, Bundle binding, kernel status, or no-sorry policy is invalid.",
      },
      async () => {
        const passed = checkedFixture.runner.result.artifacts.manifestHash === bundleHash &&
          checkedFixture.runner.result.status === "succeeded" &&
          checkedFixture.runner.result.kernelStatus === "accepted" &&
          checkedFixture.runner.result.checks.noSorry === "passed" &&
          await verifyLeanRunnerResultSignature({
            result: checkedFixture.runner.result,
            runnerPublicKey: checkedFixture.runner.publicKey,
          });
        return { passed, result: "Runner signature valid · kernel accepted · no sorry recorded · Lean not rerun now." };
      },
    ),
    check(
      {
        id: "review",
        label: "Independent attestations are signed",
        detail: "Different Person-owned review Agents attest reproducibility, kernel acceptance, and project acceptance separately.",
        method: "Owner separation + attestation Ed25519 signatures",
        input: `${checkedFixture.attestations.length} attestations · ${new Set(checkedFixture.attestations.map((candidate) => candidate.verifierPersonId)).size} reviewer owners`,
        evidence: checkedFixture.attestations[0]?.payloadHash ?? bundleHash,
        failureResult: "A reviewer is not independent, an attestation points to another Bundle, or a signature is invalid.",
      },
      async () => {
        const signatures = await Promise.all(checkedFixture.attestations.map((attestation) => (
          verifyVerificationAttestationSignature(attestation)
        )));
        const passed = checkedFixture.attestations.every((attestation) => (
          attestation.artifactBundleHash === bundleHash &&
          attestation.verifierPersonId !== checkedFixture.receipt.attempt.personId
        )) && signatures.every(Boolean);
        return {
          passed,
          result: `${signatures.filter(Boolean).length}/${signatures.length} signatures valid · every reviewer owner differs from the researcher.`,
        };
      },
    ),
    check(
      {
        id: "receipt",
        label: "Reference receipt satisfies policy",
        detail: "The issuer signature covers attribution, Bundle, Run, and all required independent review claims.",
        method: "Receipt policy + canonical hash + issuer Ed25519 signature",
        input: `${checkedFixture.receipt.id} · beneficiary ${checkedFixture.receipt.beneficiary.personId}`,
        evidence: receiptHash,
        failureResult: "Receipt policy, canonical hash, attribution, or issuer signature did not verify.",
      },
      async () => {
        assertContributionReceiptPolicy(checkedFixture.receipt);
        const currentReceiptHash = await contributionReceiptHash(checkedFixture.receipt);
        const passed = currentReceiptHash === checkedFixture.receiptHash && await verifyContributionReceiptSignature(checkedFixture.receipt);
        return { passed, result: "Receipt hash matches · attribution policy satisfied · issuer signature valid." };
      },
    ),
  ]);
  const checks = stableRun
    ? measuredChecks.map((candidate) => ({ ...candidate, durationMs: 0 }))
    : measuredChecks;

  const checksById = new Map(checks.map((candidate) => [candidate.id, candidate.passed]));
  const mockReviewerAttestations = checkedFixture.attestations.filter((attestation) => (
    attestation.verifierPersonId === "person:demo-reviewer" &&
    attestation.claimType !== "project_accepted"
  ));
  const journey: readonly DemoJourneyStage[] = [
    {
      id: "delegate",
      number: "01",
      title: "Delegate the local research Agent",
      actor: "Reference researcher Person",
      actorMode: "local_reference",
      detail: "A Person signature grants one local Agent formalize and prove scope for a bounded period.",
      evidence: checkedFixture.delegation.payloadHash,
      passed: checksById.get("delegation") === true,
    },
    {
      id: "bundle",
      number: "02",
      title: "Package the minimum reproducible workspace",
      actor: "Local Codex Agent",
      actorMode: "local_reference",
      detail: "The Agent signs the target, Git commit, Lean environment, patch, file tree and no-sorry policy.",
      evidence: bundleHash,
      passed: checksById.get("bundle") === true && checksById.get("objects") === true,
    },
    {
      id: "lean",
      number: "03",
      title: "Replay the exact Lean entry file",
      actor: "Local Lean fixture",
      actorMode: "local_reference",
      detail: "The checked fixture was executed by Lean locally; this request verifies the signed result but does not start Lean again.",
      evidence: checkedFixture.runner.result.requestHash,
      passed: checksById.get("runner") === true,
    },
    {
      id: "review",
      number: "04",
      title: "Review from a different owner",
      actor: "Mock Reviewer Person",
      actorMode: "mock_second_account",
      detail: "The second account is simulated for the demo, but owns a distinct Ed25519 review key and signs real protocol attestations.",
      evidence: mockReviewerAttestations[0]?.payloadHash ?? bundleHash,
      passed: checksById.get("review") === true,
    },
    {
      id: "receipt",
      number: "05",
      title: "Issue an attributable Receipt",
      actor: "Proofweave reference issuer",
      actorMode: "protocol_issuer",
      detail: "Receipt policy binds the Person, Agent, Bundle, kernel result and different-owner claims into one signed record.",
      evidence: receiptHash,
      passed: checksById.get("receipt") === true,
    },
  ];

  const checkedAt = stableRun ? checkedFixture.receipt.issuedAt : new Date().toISOString();
  const durationMs = stableRun ? 0 : roundDuration(preciseNow() - started);

  return {
    status: checks.every((candidate) => candidate.passed) ? "verified" : "failed",
    verificationId,
    protocolVersion: checkedFixture.fixtureProtocolVersion,
    mode,
    startedAt,
    checkedAt,
    durationMs,
    checks,
    executionBoundary: {
      evidenceSource: "checked_in_reference_fixture",
      signedEvidenceReverified: true,
      leanReplay: "not_run_by_this_request",
      statement: "This request re-hashes current evidence bytes and re-verifies signatures and policy. It verifies the recorded Runner result; it does not execute Lean again.",
    },
    record: {
      target: checkedFixture.bundle.target.declaration,
      source: checkedFixture.source.content,
      leanVersion: checkedFixture.source.leanVersion,
      repository: checkedFixture.bundle.repositorySnapshot.repository,
      commitSha: checkedFixture.bundle.repositorySnapshot.commitSha,
      bundleHash,
      receiptHash,
      owner: checkedFixture.receipt.beneficiary.personId,
      agent: checkedFixture.receipt.beneficiary.agentId,
      reviewers: [...new Set(checkedFixture.attestations.map((attestation) => attestation.verifierPersonId))],
    },
    journey,
    mockReviewer: {
      personId: "person:demo-reviewer",
      agentId: "agent:demo-reviewer",
      mode: "mock_second_account",
      independentFromResearcher: "person:demo-reviewer" !== fixture.receipt.attempt.personId,
      signedClaimCount: mockReviewerAttestations.length,
    },
    creditPreview: {
      status: "receipt_derived_preview_not_settled",
      unit: "non_transferable_research_credit",
      transferable: false,
      researcher: [{ label: "Certified lemma", value: checksById.get("receipt") === true ? 1 : 0 }],
      mockReviewer: [{ label: "Independent verification claims", value: checksById.get("receipt") === true ? mockReviewerAttestations.length : 0 }],
    },
    disclosure: `${checkedFixture.disclosure} The second reviewer account is a labeled deterministic mock; its key separation and signatures are checked by the real protocol.`,
  };
}

async function check(
  descriptor: Omit<DemoVerificationCheck, "passed" | "result" | "durationMs"> & { failureResult: string },
  verify: () => Promise<{ passed: boolean; result: string }>,
): Promise<DemoVerificationCheck> {
  const started = preciseNow();
  try {
    const evaluation = await verify();
    return {
      id: descriptor.id,
      label: descriptor.label,
      detail: descriptor.detail,
      method: descriptor.method,
      input: descriptor.input,
      evidence: descriptor.evidence,
      passed: evaluation.passed,
      result: evaluation.passed ? evaluation.result : descriptor.failureResult,
      durationMs: roundDuration(preciseNow() - started),
    };
  } catch {
    return {
      id: descriptor.id,
      label: descriptor.label,
      detail: descriptor.detail,
      method: descriptor.method,
      input: descriptor.input,
      evidence: descriptor.evidence,
      passed: false,
      result: descriptor.failureResult,
      durationMs: roundDuration(preciseNow() - started),
    };
  }
}

function tamperOneArtifactByte(target: typeof fixture) {
  const artifact = target.objects.find((candidate) => candidate.role === "source_patch");
  if (!artifact || artifact.content.length === 0) throw new Error("Demo tamper target is unavailable.");
  const finalCharacter = artifact.content.at(-1);
  artifact.content = `${artifact.content.slice(0, -1)}${finalCharacter === "\n" ? " " : "\n"}`;
}

function preciseNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function roundDuration(value: number) {
  return Math.max(0, Math.round(value * 10) / 10);
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
