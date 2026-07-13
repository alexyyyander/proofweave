import assert from "node:assert/strict";
import test from "node:test";
import {
  artifactBundleHash,
  canonicalArtifactBundle,
  normalizeArtifactBundle,
} from "../packages/protocol/artifact-bundle.mjs";

test("canonical artifact bundles are complete and order-independent", async () => {
  const bundle = fixtureBundle();
  assert.equal(normalizeArtifactBundle(bundle).dependencyReceipts.length, 1);
  assert.equal(canonicalArtifactBundle(bundle), canonicalArtifactBundle({ ...bundle }));
  assert.match(await artifactBundleHash(bundle), /^sha256:[a-f0-9]{64}$/);
});

test("artifact bundle rejects shell entrypoints, traversal, and private extra fields", () => {
  assert.throws(
    () => normalizeArtifactBundle({ ...fixtureBundle(), entryCommand: ["sh", "-c", "lake env lean Main.lean"] }),
    /shell-free lake env lean/,
  );
  assert.throws(
    () => normalizeArtifactBundle({ ...fixtureBundle(), source: { ...fixtureBundle().source, archiveKey: "bundles/sha256/../secret" } }),
    /matching SHA-256 hash/,
  );
  assert.throws(
    () => normalizeArtifactBundle({ ...fixtureBundle(), environment: { ...fixtureBundle().environment, lakeManifestKey: `bundles/sha256/${"0".repeat(64)}/lake-manifest.json` } }),
    /matching SHA-256 hash/,
  );
  assert.throws(
    () => normalizeArtifactBundle({ ...fixtureBundle(), privatePrompt: "do not publish" }),
    /unsupported field privatePrompt/,
  );
});

function fixtureBundle() {
  return {
    protocolVersion: "pw-artifact-bundle-v1",
    id: "bundle:fixture-1",
    attemptId: "attempt:fixture-1",
    problemRevisionId: "problem-revision:fixture-1",
    target: {
      declaration: "Proofweave.Fixture.target",
      statementHash: `sha256:${"a".repeat(64)}`,
    },
    source: {
      archiveKey: `bundles/sha256/${"a".repeat(64)}/source.tar.zst`,
      archiveHash: `sha256:${"a".repeat(64)}`,
      treeHash: `sha256:${"b".repeat(64)}`,
      patchKey: `bundles/sha256/${"c".repeat(64)}/normalized.patch`,
      patchHash: `sha256:${"c".repeat(64)}`,
    },
    environment: {
      leanToolchain: "leanprover/lean4:v4.27.0",
      lakeManifestKey: `bundles/sha256/${"d".repeat(64)}/lake-manifest.json`,
      lakeManifestHash: `sha256:${"d".repeat(64)}`,
      mathlibRevision: "a3a10db0e9d6",
    },
    entryCommand: ["lake", "env", "lean", "Proofweave/Fixture.lean"],
    dependencyReceipts: [{ receiptId: "receipt:fixture-1", receiptHash: `sha256:${"e".repeat(64)}` }],
    agentEvent: {
      eventId: "agent-event:fixture-1",
      occurredAt: "2026-07-13T00:00:00Z",
      payloadHash: `sha256:${"f".repeat(64)}`,
      agentPublicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    },
    policy: { requireNoSorry: true, allowedAxioms: [] },
  };
}
