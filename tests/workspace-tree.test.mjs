import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalWorkspaceTree,
  normalizeWorkspaceTree,
  workspaceTreeHash,
  workspaceTreeManifest,
} from "../packages/protocol/workspace-tree.mjs";

test("workspace tree hashes are deterministic regardless of input entry order", async () => {
  const entries = [
    { path: "Proofweave/Main.lean", mode: 0o644, contentHash: sha("a") },
    { path: "lakefile.lean", mode: 0o644, contentHash: sha("b") },
  ];
  assert.deepEqual(normalizeWorkspaceTree([...entries].reverse()), entries);
  assert.equal(canonicalWorkspaceTree(entries), canonicalWorkspaceTree([...entries].reverse()));
  assert.match(await workspaceTreeHash(entries), /^sha256:[a-f0-9]{64}$/);
  assert.equal(workspaceTreeManifest(entries).protocolVersion, "pw-tree-v1");
});

test("workspace tree admits only the allowlisted root project dotfiles", () => {
  assert.deepEqual(normalizeWorkspaceTree([
    { path: ".gitignore", mode: 0o644, contentHash: sha("a") },
    { path: "Main.lean", mode: 0o644, contentHash: sha("b") },
  ]).map((entry) => entry.path), [".gitignore", "Main.lean"]);
  assert.throws(
    () => normalizeWorkspaceTree([{ path: ".env", mode: 0o644, contentHash: sha("a") }]),
    /unsafe segment/,
  );
  assert.throws(
    () => normalizeWorkspaceTree([{ path: ".gitignore/secret", mode: 0o644, contentHash: sha("a") }]),
    /unsafe segment/,
  );
  assert.throws(
    () => normalizeWorkspaceTree([{ path: "Proofweave/.gitignore", mode: 0o644, contentHash: sha("a") }]),
    /unsafe segment/,
  );
});

test("workspace tree rejects traversal, links, duplicate paths, and unsupported modes", () => {
  assert.throws(
    () => normalizeWorkspaceTree([{ path: "../secret", mode: 0o644, contentHash: sha("a") }]),
    /unsafe segment/,
  );
  assert.throws(
    () => normalizeWorkspaceTree([{ path: "Proofweave\\Main.lean", mode: 0o644, contentHash: sha("a") }]),
    /relative POSIX path/,
  );
  assert.throws(
    () => normalizeWorkspaceTree([
      { path: "Main.lean", mode: 0o644, contentHash: sha("a") },
      { path: "Main.lean", mode: 0o755, contentHash: sha("b") },
    ]),
    /paths must be unique/,
  );
  assert.throws(
    () => normalizeWorkspaceTree([{ path: "Main.lean", mode: 0o600, contentHash: sha("a") }]),
    /0644 or 0755/,
  );
});

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}
