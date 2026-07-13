import { canonicalJson, sha256Canonical } from "./canonical-json.mjs";

export const workspaceTreeProtocolVersion = "pw-tree-v1";

export class WorkspaceTreeProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "WorkspaceTreeProtocolError";
  }
}

/**
 * A portable representation of a reconstructed Lean workspace. Directories
 * are implicit; only regular files are admitted, with normalized executable
 * or non-executable modes. The Runner derives this after applying the v2
 * patch and replacing the root Lake manifest.
 */
export function normalizeWorkspaceTree(entries) {
  if (!Array.isArray(entries) || entries.length > 100_000) {
    throw new WorkspaceTreeProtocolError("Workspace tree entries must be an array of at most 100000 files.");
  }
  const normalized = entries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new WorkspaceTreeProtocolError("Workspace tree entry must be an object.");
    }
    const extras = Object.keys(entry).filter((key) => !["path", "mode", "contentHash"].includes(key));
    if (extras.length > 0) {
      throw new WorkspaceTreeProtocolError(`Workspace tree entry contains unsupported field ${extras[0]}.`);
    }
    requireWorkspacePath(entry.path);
    if (![0o644, 0o755].includes(entry.mode)) {
      throw new WorkspaceTreeProtocolError("Workspace tree entry mode must be 0644 or 0755.");
    }
    requireSha256(entry.contentHash, "Workspace tree entry contentHash");
    return Object.freeze({ path: entry.path, mode: entry.mode, contentHash: entry.contentHash });
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].path === normalized[index].path) {
      throw new WorkspaceTreeProtocolError("Workspace tree paths must be unique.");
    }
  }
  return Object.freeze(normalized);
}

export function workspaceTreeManifest(entries) {
  return Object.freeze({
    protocolVersion: workspaceTreeProtocolVersion,
    entries: normalizeWorkspaceTree(entries),
  });
}

export function canonicalWorkspaceTree(entries) {
  return canonicalJson(workspaceTreeManifest(entries));
}

export async function workspaceTreeHash(entries) {
  return sha256Canonical(workspaceTreeManifest(entries));
}

function requireWorkspacePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024 || value.startsWith("/") || value.includes("\\") || value.includes("\u0000")) {
    throw new WorkspaceTreeProtocolError("Workspace tree path must be a bounded relative POSIX path.");
  }
  const segments = value.split("/");
  if (segments.some((segment) => !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(segment) || segment === "." || segment === "..")) {
    throw new WorkspaceTreeProtocolError("Workspace tree path contains an unsafe segment.");
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new WorkspaceTreeProtocolError(`${label} must be sha256:<hex>.`);
  }
}
