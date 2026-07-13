import { artifactBundleV2ProtocolVersion } from "../../packages/protocol/artifact-bundle.mjs";
import { leanRunnerRequestHash } from "../../packages/protocol/lean-runner.mjs";
import { runnerWorkspaceIngressProtocolVersion } from "./container-workspace-ingress.mjs";

export const runnerWorkspaceTransferProtocolVersion = runnerWorkspaceIngressProtocolVersion;

export class RunnerWorkspaceTransferError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RunnerWorkspaceTransferError";
  }
}

/**
 * Trusted Worker-side transfer adapter. The Container receives three bounded
 * byte streams and immutable expected hashes, never R2, D1, or signing
 * credentials. Its private ingress must make each step idempotent because a
 * Queue delivery may be retried after an interrupted transfer.
 */
export class RunnerWorkspaceTransfer {
  constructor({ bucket }) {
    if (!bucket || typeof bucket.get !== "function") {
      throw new TypeError("RunnerWorkspaceTransfer requires an R2 bucket binding with get().");
    }
    this.bucket = bucket;
  }

  async stage({ run, resolvedBundle, container }) {
    await assertRunAndResolvedBundle(run, resolvedBundle);
    if (!container || typeof container.fetch !== "function") {
      throw new RunnerWorkspaceTransferError("Runner workspace transfer requires a private Container fetch stub.");
    }

    const baseUrl = `https://proofweave-runner.internal/v1/runs/${encodeURIComponent(run.id)}`;
    const workspace = resolvedBundle.bundle.workspace;
    const transfers = transfersFor(resolvedBundle.objects);
    await expectAccepted(
      await container.fetch(jsonRequest(`${baseUrl}/workspace`, {
        protocolVersion: runnerWorkspaceTransferProtocolVersion,
        jobId: run.id,
        requestHash: run.requestHash,
        target: resolvedBundle.bundle.target,
        policy: resolvedBundle.request.policy,
        workspace,
        entryCommand: resolvedBundle.request.bundle.entryCommand,
        artifacts: Object.fromEntries(transfers.map((transfer) => [transfer.id, {
          contentHash: transfer.object.contentHash,
          byteLength: transfer.object.byteLength,
          contentType: transfer.object.contentType,
        }])),
      })),
      "workspace declaration",
    );

    const uploaded = [];
    for (const transfer of transfers) {
      const object = await this.bucket.get(transfer.object.objectKey);
      if (!object) {
        throw new RunnerWorkspaceTransferError(`Runner workspace ${transfer.label} is missing from R2 at transfer time.`);
      }
      assertR2Object(object, transfer.object, transfer.label);
      if (!object.body) {
        throw new RunnerWorkspaceTransferError(`Runner workspace ${transfer.label} has no readable R2 body.`);
      }
      await expectAccepted(
        await container.fetch(streamRequest(`${baseUrl}/artifacts/${transfer.endpoint}`, object.body, {
          "content-type": transfer.object.contentType,
          "content-length": String(transfer.object.byteLength),
          "x-proofweave-artifact-role": transfer.id,
          "x-proofweave-content-sha256": transfer.object.contentHash,
        })),
        `${transfer.label} upload`,
      );
      uploaded.push(transfer.id);
    }

    await expectAccepted(
      await container.fetch(new Request(`${baseUrl}/workspace/finalize`, { method: "POST" })),
      "workspace finalization",
    );
    return Object.freeze({
      protocolVersion: runnerWorkspaceTransferProtocolVersion,
      runId: run.id,
      uploaded: Object.freeze(uploaded),
    });
  }
}

async function assertRunAndResolvedBundle(run, resolvedBundle) {
  if (!run || typeof run !== "object") {
    throw new RunnerWorkspaceTransferError("Runner workspace transfer requires a claimed Run.");
  }
  if (!resolvedBundle || typeof resolvedBundle !== "object" || !resolvedBundle.bundle || !resolvedBundle.request || !resolvedBundle.objects) {
    throw new RunnerWorkspaceTransferError("Runner workspace transfer requires a resolved Artifact Bundle.");
  }
  if (
    run.state !== "preparing" ||
    run.id !== resolvedBundle.request.jobId ||
    run.attemptId !== resolvedBundle.request.attemptId ||
    run.artifactBundleHash !== resolvedBundle.manifest?.contentHash ||
    run.requestHash !== await leanRunnerRequestHash(resolvedBundle.request)
  ) {
    throw new RunnerWorkspaceTransferError("Claimed Run does not match the resolved Runner request.");
  }
  if (resolvedBundle.bundle.protocolVersion !== artifactBundleV2ProtocolVersion) {
    throw new RunnerWorkspaceTransferError("Runner workspace transfer requires pw-artifact-bundle-v2.");
  }
}

function transfersFor(objects) {
  const roles = [
    ["sourceArchive", "source archive", "source-archive"],
    ["sourcePatch", "source patch", "source-patch"],
    ["lakeManifest", "Lake manifest", "lake-manifest"],
  ];
  return roles.map(([id, label, endpoint]) => {
    const object = objects[id];
    if (!object || typeof object !== "object") {
      throw new RunnerWorkspaceTransferError(`Resolved Artifact Bundle is missing ${label} metadata.`);
    }
    return { id, label, endpoint, object };
  });
}

function assertR2Object(object, expected, label) {
  if (
    object.customMetadata?.sha256 !== expected.contentHash ||
    Number(object.size) !== expected.byteLength
  ) {
    throw new RunnerWorkspaceTransferError(`Runner workspace ${label} R2 metadata no longer matches immutable evidence.`);
  }
}

async function expectAccepted(response, label) {
  if (!response || !Number.isInteger(response.status) || response.status < 200 || response.status > 299) {
    throw new RunnerWorkspaceTransferError(`Runner Container rejected ${label}.`);
  }
}

function jsonRequest(url, payload) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function streamRequest(url, body, headers) {
  try {
    return new Request(url, { method: "PUT", headers, body, duplex: "half" });
  } catch {
    return new Request(url, { method: "PUT", headers, body });
  }
}
