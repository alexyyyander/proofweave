import { execFile } from "node:child_process";
import { createHash, webcrypto } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import * as zlib from "node:zlib";
import {
  artifactBundleHash,
  artifactBundleSigningPayload,
  artifactBundleSigningPayloadHash,
} from "../packages/protocol/artifact-bundle.mjs";
import { canonicalJson, sha256Canonical } from "../packages/protocol/canonical-json.mjs";
import {
  createContributionReceipt,
  contributionReceiptHash,
} from "../packages/protocol/contribution-receipt.mjs";
import {
  createLeanRunnerRequest,
  leanRunnerRequestHash,
  signLeanRunnerResult,
} from "../packages/protocol/lean-runner.mjs";
import {
  verificationAttestationPayloadHash,
  verificationAttestationSigningPayload,
} from "../packages/protocol/verification-attestation.mjs";
import { workspaceTreeHash } from "../packages/protocol/workspace-tree.mjs";
import {
  delegationPayloadHash,
  delegationSigningPayload,
} from "../packages/domain/delegation.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const fixtureRoot = resolve(repositoryRoot, "tests/fixtures/lean/core-success");
const outputPath = resolve(process.argv[2] ?? resolve(repositoryRoot, "demo/fixtures/build-week-demo.json"));
const crypto = globalThis.crypto ?? webcrypto;

if (typeof zlib.zstdCompressSync !== "function") {
  throw new Error("This fixture generator requires Node.js zstd support.");
}

const [source, lakefile, leanToolchainFile, lakeManifest, commitResult] = await Promise.all([
  readFile(resolve(fixtureRoot, "ProofweaveFixture.lean")),
  readFile(resolve(fixtureRoot, "lakefile.toml")),
  readFile(resolve(fixtureRoot, "lean-toolchain")),
  readFile(resolve(fixtureRoot, "lake-manifest.json")),
  execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot }),
]);
const leanExecution = await execFileAsync("lake", ["env", "lean", "ProofweaveFixture.lean"], {
  cwd: fixtureRoot,
  maxBuffer: 1024 * 1024,
});
const commitSha = commitResult.stdout.trim();
if (!/^[a-f0-9]{40}$/.test(commitSha)) throw new Error("The demo must bind to a full Git commit SHA.");

const initialSource = Buffer.from(source.toString("utf8").replace(
  "theorem true_is_inhabited : True := True.intro",
  "theorem true_is_inhabited : True := by\n  trivial",
));
const archive = zlib.zstdCompressSync(makeTar([
  { path: "ProofweaveFixture.lean", contents: initialSource },
  { path: "lakefile.toml", contents: lakefile },
  { path: "lean-toolchain", contents: leanToolchainFile },
  { path: "lake-manifest.json", contents: Buffer.from("{\"placeholder\":true}\n") },
]));
const patch = Buffer.from([
  "diff --git a/ProofweaveFixture.lean b/ProofweaveFixture.lean",
  "index 1111111..2222222 100644",
  "--- a/ProofweaveFixture.lean",
  "+++ b/ProofweaveFixture.lean",
  "@@ -1,6 +1,5 @@",
  " namespace ProofweaveFixture",
  " ",
  "-theorem true_is_inhabited : True := by",
  "-  trivial",
  "+theorem true_is_inhabited : True := True.intro",
  " ",
  " theorem natural_addition_commutes (left right : Nat) : left + right = right + left :=",
  "",
].join("\n"));

const archiveHash = sha256Bytes(archive);
const patchHash = sha256Bytes(patch);
const lakeManifestHash = sha256Bytes(lakeManifest);
const treeHash = await workspaceTreeHash([
  { path: "ProofweaveFixture.lean", mode: 0o644, contentHash: sha256Bytes(source) },
  { path: "lake-manifest.json", mode: 0o644, contentHash: lakeManifestHash },
  { path: "lakefile.toml", mode: 0o644, contentHash: sha256Bytes(lakefile) },
  { path: "lean-toolchain", mode: 0o644, contentHash: sha256Bytes(leanToolchainFile) },
]);

const keys = {
  person: await keyPair(),
  agent: await keyPair(),
  runner: await keyPair(),
  reviewer: await keyPair(),
  curator: await keyPair(),
  issuer: await keyPair(),
};
const target = {
  declaration: "ProofweaveFixture.true_is_inhabited",
  statementHash: sha256Bytes("theorem true_is_inhabited : True := True.intro"),
};
const delegationCertificate = {
  id: "delegation:demo-prover",
  ownerPersonId: "person:demo-owner",
  agentId: "agent:demo-prover",
  agentPublicKey: keys.agent.publicKey,
  scopes: ["formalize", "prove"],
  validFrom: "2026-07-13T00:00:00Z",
  validUntil: "2027-07-13T00:00:00Z",
  attributionPolicy: {
    beneficiaryPersonId: "person:demo-owner",
    mode: "agent_delegated",
  },
};
const delegation = {
  certificate: delegationCertificate,
  payloadHash: await delegationPayloadHash(delegationCertificate),
  personPublicKey: keys.person.publicKey,
  personSignature: base64Url(await crypto.subtle.sign(
    "Ed25519",
    keys.person.privateKey,
    new TextEncoder().encode(canonicalJson(delegationSigningPayload(delegationCertificate))),
  )),
};
const bundle = {
  protocolVersion: "pw-artifact-bundle-v3",
  id: "bundle:build-week-reference",
  attemptId: "attempt:build-week-reference",
  problemRevisionId: "revision:build-week-reference",
  target,
  workspace: {
    archive: {
      objectKey: objectKey(archiveHash, "source.tar.zst"),
      contentHash: archiveHash,
      format: "tar.zst",
      maxExpandedBytes: 1024 * 1024,
      maxFileCount: 10,
      symlinkPolicy: "forbidden",
    },
    patch: {
      objectKey: objectKey(patchHash, "normalized.patch"),
      contentHash: patchHash,
      format: "unified-diff",
      strip: 1,
      allowFuzz: false,
    },
    tree: { hash: treeHash, algorithm: "pw-tree-v1", state: "after_patch_and_lake_manifest" },
    lakeManifest: {
      objectKey: objectKey(lakeManifestHash, "lake-manifest.json"),
      contentHash: lakeManifestHash,
      destination: "lake-manifest.json",
    },
  },
  repositorySnapshot: {
    provider: "github",
    repository: "alexyyyander/proofweave",
    commitSha,
    visibility: "private",
  },
  environment: {
    leanToolchain: leanToolchainFile.toString("utf8").trim(),
    mathlibRevision: "core-only-no-mathlib",
  },
  entryCommand: ["lake", "env", "lean", "ProofweaveFixture.lean"],
  dependencyReceipts: [],
  agentEvent: {
    eventId: "agent-event:build-week-reference",
    occurredAt: "2026-07-14T06:30:00Z",
    payloadHash: sha256Bytes("placeholder"),
    agentPublicKey: keys.agent.publicKey,
    signature: base64Url(Buffer.alloc(64)),
  },
  policy: { requireNoSorry: true, allowedAxioms: [] },
};
bundle.agentEvent.payloadHash = await artifactBundleSigningPayloadHash(bundle);
bundle.agentEvent.signature = base64Url(await crypto.subtle.sign(
  "Ed25519",
  keys.agent.privateKey,
  new TextEncoder().encode(canonicalJson(artifactBundleSigningPayload(bundle))),
));

const manifestHash = await artifactBundleHash(bundle);
const runnerRequest = await createLeanRunnerRequest({
  jobId: "run:build-week-reference",
  idempotencyKey: "build-week-reference-v1",
  artifactBundle: bundle,
  imageDigest: `registry.example/proofweave/lean@sha256:${"7".repeat(64)}`,
  limits: { cpuSeconds: 10, wallSeconds: 30, memoryMiB: 512, diskMiB: 128, outputBytes: 1_000_000 },
});
const requestHash = await leanRunnerRequestHash(runnerRequest);
const stdout = Buffer.from(leanExecution.stdout);
const stderr = Buffer.from(leanExecution.stderr);
const runnerResult = await signLeanRunnerResult({
  result: {
    protocolVersion: "pw-lean-runner-v1",
    jobId: runnerRequest.jobId,
    attemptId: runnerRequest.attemptId,
    requestHash,
    runnerKeyId: "runner-key:build-week-reference",
    status: "succeeded",
    exitCode: 0,
    startedAt: "2026-07-14T06:31:00Z",
    finishedAt: "2026-07-14T06:31:01Z",
    kernelStatus: "accepted",
    checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
    artifacts: {
      manifestHash,
      stdoutHash: sha256Bytes(stdout),
      stderrHash: sha256Bytes(stderr),
    },
  },
  runnerPrivateKey: keys.runner.privateKey,
});
const runnerResultHash = await sha256Canonical(runnerResult);

const attestations = await Promise.all([
  signedAttestation({
    claimType: "bundle_reproducible",
    evidenceHash: manifestHash,
    key: keys.reviewer,
    reviewer: "reviewer",
  }),
  signedAttestation({
    claimType: "kernel_accepted",
    evidenceHash: runnerResultHash,
    key: keys.reviewer,
    reviewer: "reviewer",
  }),
  signedAttestation({
    claimType: "project_accepted",
    evidenceHash: sha256Bytes("Reference fixture accepted for protocol demonstration only."),
    key: keys.curator,
    reviewer: "curator",
  }),
]);
const claims = await Promise.all(attestations.map(async (attestation) => ({
  claimType: attestation.claimType,
  verificationAttestationId: attestation.id,
  verificationAttestationHash: await sha256Canonical(attestation),
  artifactBundleHash: manifestHash,
  reviewerPersonId: attestation.verifierPersonId,
  reviewerAgentId: attestation.verifierAgentId,
  reviewerDelegationCertificateId: attestation.delegationCertificateId,
  decision: "attested",
})));
const receipt = await createContributionReceipt({
  receipt: {
    protocolVersion: "pw-contribution-receipt-v1",
    id: "receipt:build-week-reference",
    kind: "lemma",
    beneficiary: {
      personId: "person:demo-owner",
      agentId: "agent:demo-prover",
      delegationCertificateId: "delegation:demo-prover",
    },
    attempt: {
      id: bundle.attemptId,
      personId: "person:demo-owner",
      agentId: "agent:demo-prover",
      delegationCertificateId: "delegation:demo-prover",
      problemRevisionId: bundle.problemRevisionId,
    },
    target,
    artifactBundleHash: manifestHash,
    bundle: { manifestHash, dependencyReceipts: [] },
    run: {
      id: runnerResult.jobId,
      requestHash,
      resultHash: runnerResultHash,
      status: runnerResult.status,
      kernelStatus: runnerResult.kernelStatus,
    },
    claims,
    issuedAt: "2026-07-14T06:33:00Z",
    policyVersion: "pw-receipt-policy-v1",
    issuerKeyId: "issuer:build-week-reference",
    issuerPublicKey: keys.issuer.publicKey,
  },
  issuerPrivateKey: keys.issuer.privateKey,
});

const fixture = {
  fixtureProtocolVersion: "pw-build-week-demo-v1",
  label: "Build Week reference proof",
  generatedAt: "2026-07-14T06:33:00Z",
  objects: [
    {
      role: "source_archive",
      filename: "source.tar.zst",
      contentHash: archiveHash,
      encoding: "base64",
      content: archive.toString("base64"),
    },
    {
      role: "source_patch",
      filename: "normalized.patch",
      contentHash: patchHash,
      encoding: "utf8",
      content: patch.toString("utf8"),
    },
    {
      role: "lake_manifest",
      filename: "lake-manifest.json",
      contentHash: lakeManifestHash,
      encoding: "utf8",
      content: lakeManifest.toString("utf8"),
    },
  ],
  source: {
    path: "tests/fixtures/lean/core-success/ProofweaveFixture.lean",
    content: source.toString("utf8"),
    contentHash: sha256Bytes(source),
    compilerStdout: stdout.toString("utf8"),
    compilerStderr: stderr.toString("utf8"),
    leanVersion: (await execFileAsync("lean", ["--version"], { cwd: fixtureRoot })).stdout.trim(),
  },
  delegation,
  bundle,
  runner: { request: runnerRequest, result: runnerResult, publicKey: keys.runner.publicKey },
  attestations,
  receipt,
  receiptHash: await contributionReceiptHash(receipt),
  disclosure: "This is a checked reference fixture generated by the local Lean runner path. It is not a live network contribution or evidence that the hosted Runner is deployed.",
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
process.stdout.write(`Generated ${outputPath}\n`);

async function keyPair() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  return {
    privateKey: pair.privateKey,
    publicKey: base64Url(await crypto.subtle.exportKey("raw", pair.publicKey)),
  };
}

async function signedAttestation({ claimType, evidenceHash, key, reviewer }) {
  const role = reviewer === "curator" ? "curator" : "reviewer";
  const attestation = {
    protocolVersion: "pw-verification-attestation-v1",
    id: `attestation:build-week:${claimType}`,
    assignmentId: `assignment:build-week:${claimType}`,
    artifactBundleHash: manifestHash,
    claimType,
    verifierPersonId: `person:demo-${reviewer}`,
    verifierAgentId: `agent:demo-${role}`,
    delegationCertificateId: `delegation:demo-${role}`,
    verifierAgentPublicKey: key.publicKey,
    decision: "attested",
    evidenceHash,
    attestedAt: reviewer === "curator" ? "2026-07-14T06:32:30Z" : "2026-07-14T06:32:00Z",
    payloadHash: sha256Bytes("placeholder"),
    signature: base64Url(Buffer.alloc(64)),
  };
  attestation.payloadHash = await verificationAttestationPayloadHash(attestation);
  attestation.signature = base64Url(await crypto.subtle.sign(
    "Ed25519",
    key.privateKey,
    new TextEncoder().encode(canonicalJson(verificationAttestationSigningPayload(attestation))),
  ));
  return attestation;
}

function objectKey(contentHash, filename) {
  return `bundles/sha256/${contentHash.slice("sha256:".length)}/${filename}`;
}

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function makeTar(entries) {
  const blocks = [];
  for (const entry of entries) {
    const contents = Buffer.from(entry.contents);
    const header = Buffer.alloc(512);
    writeTarString(header, 0, 100, entry.path);
    writeTarOctal(header, 100, 8, 0o644);
    writeTarOctal(header, 108, 8, 0);
    writeTarOctal(header, 116, 8, 0);
    writeTarOctal(header, 124, 12, contents.length);
    writeTarOctal(header, 136, 12, 0);
    header.fill(32, 148, 156);
    header[156] = "0".charCodeAt(0);
    writeTarString(header, 257, 6, "ustar");
    writeTarString(header, 263, 2, "00");
    const checksum = header.reduce((total, byte) => total + byte, 0);
    writeTarString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
    blocks.push(header, contents);
    const padding = (512 - (contents.length % 512)) % 512;
    if (padding) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function writeTarString(target, offset, length, value) {
  const bytes = Buffer.from(value, "ascii");
  if (bytes.length > length) throw new Error("Tar fixture field is too long.");
  bytes.copy(target, offset);
}

function writeTarOctal(target, offset, length, value) {
  writeTarString(target, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
}
