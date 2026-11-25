import fixture from "@/demo/fixtures/build-week-demo.json";
import type { BuildWeekDemoVerification, DemoJourneyStage } from "@/app/lib/build-week-demo";

export type JourneyNode = {
  id: "frontier" | DemoJourneyStage["id"];
  passed: boolean;
  excerpt: string;
};

// Project only public example fields into the interactive preview.
export function journeyEvidence(verification: BuildWeekDemoVerification): JourneyNode[] {
  const { record } = verification;
  const { delegation, bundle, runner, attestations, receipt } = fixture;
  const excerpt = {
    delegate: [
      `ownerPersonId = ${delegation.certificate.ownerPersonId}`,
      `agentId = ${delegation.certificate.agentId}`,
      `scopes = ${delegation.certificate.scopes.join(", ")}`,
      `personSignature = ${delegation.personSignature}`,
    ],
    bundle: [
      `id = ${bundle.id}`, `commit = ${record.commitSha}`,
      `bundleHash = ${record.bundleHash}`, `signature = ${bundle.agentEvent.signature}`,
    ],
    lean: [
      `kernelStatus = ${runner.result.kernelStatus}`, `exitCode = ${runner.result.exitCode}`,
      `requestHash = ${runner.result.requestHash}`, `runnerSignature = ${runner.result.runnerSignature}`,
    ],
    review: attestations.map(attestation =>
      `${attestation.verifierPersonId}\n  ${attestation.claimType} = ${attestation.decision}\n  signature = ${attestation.signature}`
    ),
    receipt: [
      `id = ${receipt.id}`, `issuedAt = ${receipt.issuedAt}`,
      `artifactBundleHash = ${receipt.artifactBundleHash}`, `issuerSignature = ${receipt.issuerSignature}`,
    ],
  };
  return [
    { id: "frontier", passed: true, excerpt: record.source.trim() },
    ...verification.journey.map(stage => ({
      id: stage.id, passed: stage.passed, excerpt: excerpt[stage.id].join("\n"),
    })),
  ];
}
