import {
  artifactBundleV2ProtocolVersion,
  normalizeArtifactBundleV2Workspace,
} from "../../packages/protocol/artifact-bundle.mjs";

export const runnerWorkspaceIngressProtocolVersion = "pw-runner-workspace-transfer-v1";

export class RunnerWorkspaceIngressError extends Error {
  constructor(message) {
    super(message);
    this.name = "RunnerWorkspaceIngressError";
  }
}

/**
 * Validate the private Worker-to-Container declaration before bytes arrive.
 * A Container HTTP service owns one instance per Run and calls recordArtifact
 * only after it has streamed bytes to disk and independently computed their
 * SHA-256 and exact byte count.
 */
export class RunnerWorkspaceIngress {
  constructor(declaration) {
    this.declaration = normalizeRunnerWorkspaceIngressDeclaration(declaration);
    this.nextArtifactIndex = 0;
    this.received = new Map();
  }

  recordArtifact({ id, contentHash, byteLength }) {
    const expected = artifactOrder[this.nextArtifactIndex];
    if (!expected || id !== expected) {
      throw new RunnerWorkspaceIngressError("Runner workspace artifact arrived out of the required order.");
    }
    const declared = this.declaration.artifacts[id];
    if (contentHash !== declared.contentHash || byteLength !== declared.byteLength) {
      throw new RunnerWorkspaceIngressError(`Runner workspace ${id} bytes do not match the immutable declaration.`);
    }
    this.received.set(id, Object.freeze({ contentHash, byteLength }));
    this.nextArtifactIndex += 1;
    return Object.freeze({ accepted: id, remaining: artifactOrder.length - this.nextArtifactIndex });
  }

  finalize() {
    if (this.nextArtifactIndex !== artifactOrder.length) {
      throw new RunnerWorkspaceIngressError("Runner workspace cannot finalize before every required artifact is verified.");
    }
    return Object.freeze({
      protocolVersion: runnerWorkspaceIngressProtocolVersion,
      jobId: this.declaration.jobId,
      requestHash: this.declaration.requestHash,
      target: this.declaration.target,
      policy: this.declaration.policy,
      bundleProtocolVersion: artifactBundleV2ProtocolVersion,
      workspace: this.declaration.workspace,
      entryCommand: this.declaration.entryCommand,
      artifacts: Object.freeze(Object.fromEntries(this.received)),
    });
  }
}

export function normalizeRunnerWorkspaceIngressDeclaration(value) {
  requireRecord(value, "Runner workspace declaration");
  rejectExtraKeys(value, ["protocolVersion", "jobId", "requestHash", "target", "policy", "workspace", "entryCommand", "artifacts"], "Runner workspace declaration");
  if (value.protocolVersion !== runnerWorkspaceIngressProtocolVersion) {
    throw new RunnerWorkspaceIngressError("Unsupported Runner workspace ingress protocol version.");
  }
  requireIdentifier(value.jobId, "Runner workspace jobId");
  requireSha256(value.requestHash, "Runner workspace requestHash");
  const target = normalizeTarget(value.target);
  const policy = normalizePolicy(value.policy);
  const workspace = normalizeArtifactBundleV2Workspace(value.workspace);
  const entryCommand = normalizeEntryCommand(value.entryCommand);
  const artifacts = normalizeArtifacts(value.artifacts, workspace);
  return Object.freeze({
    protocolVersion: runnerWorkspaceIngressProtocolVersion,
    jobId: value.jobId,
    requestHash: value.requestHash,
    target,
    policy,
    workspace,
    entryCommand: Object.freeze(entryCommand),
    artifacts,
  });
}

function normalizeTarget(value) {
  requireRecord(value, "Runner workspace target");
  rejectExtraKeys(value, ["declaration", "statementHash"], "Runner workspace target");
  requireQualifiedName(value.declaration, "Runner workspace target declaration");
  requireSha256(value.statementHash, "Runner workspace target statementHash");
  return Object.freeze({ declaration: value.declaration, statementHash: value.statementHash });
}

function normalizePolicy(value) {
  requireRecord(value, "Runner workspace policy");
  rejectExtraKeys(value, ["requireNoSorry", "allowedAxioms"], "Runner workspace policy");
  if (value.requireNoSorry !== true || !Array.isArray(value.allowedAxioms) || !value.allowedAxioms.every((axiom) => typeof axiom === "string" && /^[A-Za-z_][A-Za-z0-9_'.]*(?:\.[A-Za-z_][A-Za-z0-9_'.]*)*$/.test(axiom))) {
    throw new RunnerWorkspaceIngressError("Runner workspace policy must require a sorry audit and qualified allowed axioms.");
  }
  return Object.freeze({ requireNoSorry: true, allowedAxioms: Object.freeze([...new Set(value.allowedAxioms)].sort()) });
}

const artifactOrder = Object.freeze(["sourceArchive", "sourcePatch", "lakeManifest"]);

function normalizeArtifacts(value, workspace) {
  requireRecord(value, "Runner workspace artifacts");
  rejectExtraKeys(value, artifactOrder, "Runner workspace artifacts");
  const expected = {
    sourceArchive: workspace.archive.contentHash,
    sourcePatch: workspace.patch.contentHash,
    lakeManifest: workspace.lakeManifest.contentHash,
  };
  const normalized = {};
  for (const id of artifactOrder) {
    const artifact = value[id];
    requireRecord(artifact, `Runner workspace ${id}`);
    rejectExtraKeys(artifact, ["contentHash", "byteLength", "contentType"], `Runner workspace ${id}`);
    requireSha256(artifact.contentHash, `Runner workspace ${id} contentHash`);
    if (artifact.contentHash !== expected[id]) {
      throw new RunnerWorkspaceIngressError(`Runner workspace ${id} hash does not match the v2 Bundle.`);
    }
    if (!Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 0 || artifact.byteLength > 32 * 1024 * 1024) {
      throw new RunnerWorkspaceIngressError(`Runner workspace ${id} byteLength is outside the artifact limit.`);
    }
    if (typeof artifact.contentType !== "string" || artifact.contentType.length === 0 || artifact.contentType.length > 255 || /[\r\n]/.test(artifact.contentType)) {
      throw new RunnerWorkspaceIngressError(`Runner workspace ${id} contentType is invalid.`);
    }
    normalized[id] = Object.freeze({ ...artifact });
  }
  return Object.freeze(normalized);
}

function normalizeEntryCommand(value) {
  if (!Array.isArray(value) || value.some((part) => typeof part !== "string" || part.length === 0 || part.length > 512)) {
    throw new RunnerWorkspaceIngressError("Runner workspace entryCommand must be a bounded argument array.");
  }
  if (value[0] !== "lake" || value[1] !== "env" || value[2] !== "lean" || value.some((part) => /[;|&><`$\n\r]/.test(part))) {
    throw new RunnerWorkspaceIngressError("Runner workspace entryCommand must be shell-free lake env lean.");
  }
  if (value.length !== 4) {
    throw new RunnerWorkspaceIngressError("Runner workspace entryCommand must be exactly lake env lean plus one source file.");
  }
  requireLeanSourcePath(value[3], "Runner workspace entryCommand source file");
  return [...value];
}

function requireLeanSourcePath(value, label) {
  if (typeof value !== "string" || !value.endsWith(".lean") || value.length > 1_024 || value.startsWith("/") || value.includes("\\") || value.includes("\0")) {
    throw new RunnerWorkspaceIngressError(`${label} must be a relative .lean source path.`);
  }
  const segments = value.slice(0, -".lean".length).split("/");
  if (segments.some((segment) => !/^[A-Za-z_][A-Za-z0-9_']*$/.test(segment))) {
    throw new RunnerWorkspaceIngressError(`${label} contains an unsafe Lean module path.`);
  }
}

function rejectExtraKeys(value, allowed, label) {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) throw new RunnerWorkspaceIngressError(`${label} contains unsupported field ${extra}.`);
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RunnerWorkspaceIngressError(`${label} must be an object.`);
  }
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 240) {
    throw new RunnerWorkspaceIngressError(`${label} must be a non-empty identifier.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new RunnerWorkspaceIngressError(`${label} must be sha256:<hex>.`);
  }
}

function requireQualifiedName(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_'.]*(?:\.[A-Za-z_][A-Za-z0-9_'.]*)*$/.test(value)) {
    throw new RunnerWorkspaceIngressError(`${label} must be a qualified Lean declaration name.`);
  }
}
