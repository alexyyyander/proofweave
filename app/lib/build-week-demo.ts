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
import { defaultLocale, type Locale } from "@/app/i18n/config";
import { getDictionary } from "@/app/i18n/dictionaries";
import { createTranslator } from "@/app/i18n/translate";

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
  options: { mode?: DemoVerificationMode; stableRun?: boolean; locale?: Locale } = {},
): Promise<BuildWeekDemoVerification> {
  const mode = options.mode ?? "reference";
  const stableRun = options.stableRun === true;
  const locale = options.locale ?? defaultLocale;
  const t = createTranslator(getDictionary(locale));
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
        label: t("demo.check.delegation.label"),
        detail: t("demo.check.delegation.detail"),
        method: t("demo.check.delegation.method"),
        input: `${checkedFixture.delegation.certificate.id} · scope prove`,
        evidence: checkedFixture.delegation.payloadHash,
        failureResult: t("demo.check.delegation.result.failed"),
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
          result: t("demo.check.delegation.result.passed", {
            date: checkedFixture.bundle.agentEvent.occurredAt,
            scopes: checkedFixture.delegation.certificate.scopes.join(", "),
          }),
        };
      },
    ),
    check(
      {
        id: "bundle",
        label: t("demo.check.bundle.label"),
        detail: t("demo.check.bundle.detail"),
        method: t("demo.check.bundle.method"),
        input: `${checkedFixture.bundle.id} · ${checkedFixture.bundle.repositorySnapshot.commitSha}`,
        evidence: bundleHash,
        failureResult: t("demo.check.bundle.result.failed"),
      },
      async () => {
        const currentBundleHash = await artifactBundleHash(checkedFixture.bundle);
        const passed = currentBundleHash === checkedFixture.receipt.artifactBundleHash &&
          await verifyArtifactBundleAgentSignature(checkedFixture.bundle);
        return { passed, result: t("demo.check.bundle.result.passed") };
      },
    ),
    check(
      {
        id: "objects",
        label: t("demo.check.objects.label"),
        detail: t("demo.check.objects.detail"),
        method: t("demo.check.objects.method"),
        input: `${checkedFixture.objects.length + 1} payloads · archive, patch, manifest, Lean source`,
        evidence: checkedFixture.bundle.workspace.tree.hash,
        failureResult: t("demo.check.objects.result.failed", { role: t("demo.role.leanSource") }),
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
        const total = checkedFixture.objects.length + 1;
        const role = mismatchedObject?.role ?? t("demo.role.leanSource");
        return {
          passed,
          result: passed
            ? t("demo.check.objects.result.passed", { matched: total, total })
            : t("demo.check.objects.result.failed", { role }),
          failureResult: t("demo.check.objects.result.failed", { role }),
        };
      },
    ),
    check(
      {
        id: "runner",
        label: t("demo.check.runner.label"),
        detail: t("demo.check.runner.detail"),
        method: t("demo.check.runner.method"),
        input: `${checkedFixture.runner.result.jobId} · ${checkedFixture.bundle.environment.leanToolchain}`,
        evidence: checkedFixture.runner.result.requestHash,
        failureResult: t("demo.check.runner.result.failed"),
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
        return { passed, result: t("demo.check.runner.result.passed") };
      },
    ),
    check(
      {
        id: "review",
        label: t("demo.check.review.label"),
        detail: t("demo.check.review.detail"),
        method: t("demo.check.review.method"),
        input: `${checkedFixture.attestations.length} attestations · ${new Set(checkedFixture.attestations.map((candidate) => candidate.verifierPersonId)).size} reviewer owners`,
        evidence: checkedFixture.attestations[0]?.payloadHash ?? bundleHash,
        failureResult: t("demo.check.review.result.failed"),
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
          result: t("demo.check.review.result.passed", {
            valid: signatures.filter(Boolean).length,
            total: signatures.length,
          }),
        };
      },
    ),
    check(
      {
        id: "receipt",
        label: t("demo.check.receipt.label"),
        detail: t("demo.check.receipt.detail"),
        method: t("demo.check.receipt.method"),
        input: `${checkedFixture.receipt.id} · beneficiary ${checkedFixture.receipt.beneficiary.personId}`,
        evidence: receiptHash,
        failureResult: t("demo.check.receipt.result.failed"),
      },
      async () => {
        assertContributionReceiptPolicy(checkedFixture.receipt);
        const currentReceiptHash = await contributionReceiptHash(checkedFixture.receipt);
        const passed = currentReceiptHash === checkedFixture.receiptHash && await verifyContributionReceiptSignature(checkedFixture.receipt);
        return { passed, result: t("demo.check.receipt.result.passed") };
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
      title: t("demo.journey.delegate.title"),
      actor: t("demo.journey.delegate.actor"),
      actorMode: "local_reference",
      detail: t("demo.journey.delegate.detail"),
      evidence: checkedFixture.delegation.payloadHash,
      passed: checksById.get("delegation") === true,
    },
    {
      id: "bundle",
      number: "02",
      title: t("demo.journey.bundle.title"),
      actor: t("demo.journey.bundle.actor"),
      actorMode: "local_reference",
      detail: t("demo.journey.bundle.detail"),
      evidence: bundleHash,
      passed: checksById.get("bundle") === true && checksById.get("objects") === true,
    },
    {
      id: "lean",
      number: "03",
      title: t("demo.journey.lean.title"),
      actor: t("demo.journey.lean.actor"),
      actorMode: "local_reference",
      detail: t("demo.journey.lean.detail"),
      evidence: checkedFixture.runner.result.requestHash,
      passed: checksById.get("runner") === true,
    },
    {
      id: "review",
      number: "04",
      title: t("demo.journey.review.title"),
      actor: t("demo.journey.review.actor"),
      actorMode: "mock_second_account",
      detail: t("demo.journey.review.detail"),
      evidence: mockReviewerAttestations[0]?.payloadHash ?? bundleHash,
      passed: checksById.get("review") === true,
    },
    {
      id: "receipt",
      number: "05",
      title: t("demo.journey.receipt.title"),
      actor: t("demo.journey.receipt.actor"),
      actorMode: "protocol_issuer",
      detail: t("demo.journey.receipt.detail"),
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
      statement: t("demo.executionBoundary"),
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
      researcher: [{ label: t("demo.credit.certifiedLemma"), value: checksById.get("receipt") === true ? 1 : 0 }],
      mockReviewer: [{ label: t("demo.credit.independentClaims"), value: checksById.get("receipt") === true ? mockReviewerAttestations.length : 0 }],
    },
    disclosure: locale === "en"
      ? `${checkedFixture.disclosure} The second reviewer account is a labeled deterministic mock; its key separation and signatures are checked by the real protocol.`
      : t("demo.disclosure"),
  };
}

async function check(
  descriptor: Omit<DemoVerificationCheck, "passed" | "result" | "durationMs"> & { failureResult: string },
  verify: () => Promise<{ passed: boolean; result: string; failureResult?: string }>,
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
      result: evaluation.passed ? evaluation.result : (evaluation.failureResult ?? descriptor.failureResult),
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
