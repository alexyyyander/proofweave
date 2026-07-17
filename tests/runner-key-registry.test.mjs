import assert from "node:assert/strict";
import test from "node:test";
import {
  RunnerKeyRegistryError,
  normalizeRunnerKeyId,
  normalizeRunnerPublicKey,
  runnerKeyFingerprint,
} from "../packages/protocol/runner-key-registry.mjs";

test("Runner key fingerprints are SHA-256 hashes of decoded Ed25519 public keys", async () => {
  const publicKey = "BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ";
  const expectedDigest = await crypto.subtle.digest("SHA-256", Uint8Array.from({ length: 32 }, () => 4));
  const expected = `sha256:${[...new Uint8Array(expectedDigest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;

  assert.equal(await runnerKeyFingerprint(publicKey), expected);
  assert.notEqual(await runnerKeyFingerprint("BQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU"), expected);
  assert.equal(normalizeRunnerPublicKey(publicKey), publicKey);
  assert.equal(normalizeRunnerKeyId("runner:closed-alpha"), "runner:closed-alpha");
});

test("Runner key registry helpers reject placeholder, malformed, and multiline material", async () => {
  await assert.rejects(() => runnerKeyFingerprint("A".repeat(43)), RunnerKeyRegistryError);
  await assert.rejects(() => runnerKeyFingerprint("not-a-key"), RunnerKeyRegistryError);
  await assert.rejects(() => runnerKeyFingerprint("BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAR"), /canonical base64url/);
  assert.throws(() => normalizeRunnerKeyId("runner\nkey"), RunnerKeyRegistryError);
});
