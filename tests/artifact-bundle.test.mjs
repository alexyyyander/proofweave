import assert from "node:assert/strict";
import test from "node:test";
import {
  artifactBundleHash,
  artifactBundleSigningPayload,
  artifactBundleSigningPayloadHash,
  artifactBundleObjectReferences,
  canonicalArtifactBundle,
  normalizeArtifactBundle,
  isExecutableArtifactBundle,
  verifyArtifactBundleAgentSignature,
} from "../packages/protocol/artifact-bundle.mjs";
import { canonicalJson } from "../packages/protocol/canonical-json.mjs";

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

test("an Artifact Bundle binds a valid Agent signature to the full evidence payload", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = base64Url(await crypto.subtle.exportKey("raw", pair.publicKey));
  const bundle = fixtureBundle();
  bundle.agentEvent.agentPublicKey = publicKey;
  bundle.agentEvent.payloadHash = await artifactBundleSigningPayloadHash(bundle);
  bundle.agentEvent.signature = base64Url(
    await crypto.subtle.sign(
      "Ed25519",
      pair.privateKey,
      new TextEncoder().encode(canonicalJson(artifactBundleSigningPayload(bundle))),
    ),
  );

  assert.equal(await verifyArtifactBundleAgentSignature(bundle), true);
  assert.equal(await verifyArtifactBundleAgentSignature({
    ...bundle,
    target: { ...bundle.target, declaration: "Proofweave.Fixture.tampered" },
  }), false);
});

test("v2 fixes the safe workspace reconstruction contract and its object references", async () => {
  const bundle = fixtureBundleV2();
  const normalized = normalizeArtifactBundle(bundle);
  assert.equal(normalized.protocolVersion, "pw-artifact-bundle-v2");
  assert.equal(normalized.workspace.archive.symlinkPolicy, "forbidden");
  assert.deepEqual(
    artifactBundleObjectReferences(bundle).map((reference) => reference.id),
    ["sourceArchive", "sourcePatch", "lakeManifest"],
  );

  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  bundle.agentEvent.agentPublicKey = base64Url(await crypto.subtle.exportKey("raw", pair.publicKey));
  bundle.agentEvent.payloadHash = await artifactBundleSigningPayloadHash(bundle);
  bundle.agentEvent.signature = base64Url(await crypto.subtle.sign(
    "Ed25519",
    pair.privateKey,
    new TextEncoder().encode(canonicalJson(artifactBundleSigningPayload(bundle))),
  ));
  assert.equal(await verifyArtifactBundleAgentSignature(bundle), true);
});

test("v2 rejects archive and patch semantics that would make execution ambiguous", () => {
  assert.throws(
    () => normalizeArtifactBundle({
      ...fixtureBundleV2(),
      workspace: { ...fixtureBundleV2().workspace, archive: { ...fixtureBundleV2().workspace.archive, symlinkPolicy: "allowed" } },
    }),
    /symlinkPolicy must be forbidden/,
  );
  assert.throws(
    () => normalizeArtifactBundle({
      ...fixtureBundleV2(),
      workspace: { ...fixtureBundleV2().workspace, patch: { ...fixtureBundleV2().workspace.patch, allowFuzz: true } },
    }),
    /no-fuzz unified diff/,
  );
  assert.throws(
    () => normalizeArtifactBundle({
      ...fixtureBundleV2(),
      workspace: { ...fixtureBundleV2().workspace, lakeManifest: { ...fixtureBundleV2().workspace.lakeManifest, destination: "nested/lake-manifest.json" } },
    }),
    /destination must be lake-manifest.json/,
  );
});

test("v3 signs an immutable GitHub snapshot without giving the Runner repository credentials", async () => {
  const bundle = {
    ...fixtureBundleV2(),
    protocolVersion: "pw-artifact-bundle-v3",
    id: "bundle:fixture-v3",
    repositorySnapshot: {
      provider: "github",
      repository: "proofweave-labs/formalization-fixture",
      commitSha: "a".repeat(40),
      visibility: "private",
    },
  };
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  bundle.agentEvent.agentPublicKey = base64Url(await crypto.subtle.exportKey("raw", pair.publicKey));
  bundle.agentEvent.payloadHash = await artifactBundleSigningPayloadHash(bundle);
  bundle.agentEvent.signature = base64Url(await crypto.subtle.sign(
    "Ed25519",
    pair.privateKey,
    new TextEncoder().encode(canonicalJson(artifactBundleSigningPayload(bundle))),
  ));

  assert.equal(normalizeArtifactBundle(bundle).repositorySnapshot.commitSha, "a".repeat(40));
  assert.equal(isExecutableArtifactBundle(bundle), true);
  assert.equal(await verifyArtifactBundleAgentSignature(bundle), true);
  assert.equal(await verifyArtifactBundleAgentSignature({
    ...bundle,
    repositorySnapshot: { ...bundle.repositorySnapshot, commitSha: "b".repeat(40) },
  }), false);
  assert.throws(
    () => normalizeArtifactBundle({
      ...bundle,
      repositorySnapshot: { ...bundle.repositorySnapshot, commitSha: "main" },
    }),
    /immutable 40-character Git commit SHA/,
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

function fixtureBundleV2() {
  return {
    protocolVersion: "pw-artifact-bundle-v2",
    id: "bundle:fixture-v2",
    attemptId: "attempt:fixture-v2",
    problemRevisionId: "problem-revision:fixture-v2",
    target: {
      declaration: "Proofweave.FixtureV2.target",
      statementHash: `sha256:${"1".repeat(64)}`,
    },
    workspace: {
      archive: {
        objectKey: `bundles/sha256/${"2".repeat(64)}/source.tar.zst`,
        contentHash: `sha256:${"2".repeat(64)}`,
        format: "tar.zst",
        maxExpandedBytes: 128 * 1024 * 1024,
        maxFileCount: 10_000,
        symlinkPolicy: "forbidden",
      },
      patch: {
        objectKey: `bundles/sha256/${"3".repeat(64)}/normalized.patch`,
        contentHash: `sha256:${"3".repeat(64)}`,
        format: "unified-diff",
        strip: 1,
        allowFuzz: false,
      },
      tree: {
        hash: `sha256:${"4".repeat(64)}`,
        algorithm: "pw-tree-v1",
        state: "after_patch_and_lake_manifest",
      },
      lakeManifest: {
        objectKey: `bundles/sha256/${"5".repeat(64)}/lake-manifest.json`,
        contentHash: `sha256:${"5".repeat(64)}`,
        destination: "lake-manifest.json",
      },
    },
    environment: {
      leanToolchain: "leanprover/lean4:v4.27.0",
      mathlibRevision: "a3a10db0e9d6",
    },
    entryCommand: ["lake", "env", "lean", "Proofweave/FixtureV2.lean"],
    dependencyReceipts: [],
    agentEvent: {
      eventId: "agent-event:fixture-v2",
      occurredAt: "2026-07-13T00:00:00Z",
      payloadHash: `sha256:${"6".repeat(64)}`,
      agentPublicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    },
    policy: { requireNoSorry: true, allowedAxioms: [] },
  };
}

function base64Url(buffer) {
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
