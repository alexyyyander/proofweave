import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { sha256Canonical } from "../packages/protocol/canonical-json.mjs";

test("synthetic owner exercises real-byte locking, recovery and missing, tampered and R2 fail-closed cases", { timeout: 240_000 }, async () => {
  const owner = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", owner.privateKey);
  const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", owner.publicKey)).toString("base64url");
  const authority = { projectId: "project:receipt", personId: "person:carol", keyId: "person-key:carol", keyFingerprint: await sha256Canonical({ algorithm: "ed25519", public_key: publicKey }) };
  const loader = fileURLToPath(new URL("./fixtures/pool-finality-test-loader.mjs", import.meta.url));
  const fixture = fileURLToPath(new URL("./pool-credit-signed-e2e.test.mjs", import.meta.url));
  const environment = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR ?? "/tmp", NODE_NO_WARNINGS: "1",
    PROOFWEAVE_TEST_FINALITY_AUTHORITY: JSON.stringify(authority), PROOFWEAVE_TEST_OWNER_JWK: JSON.stringify(jwk), PROOFWEAVE_TEST_EXPECT_ENROLLED: "1" };
  for (const [storageMode, lockMode] of [["inline", "concurrent"], ["inline", "recovery"], ["missing", "concurrent"], ["tampered", "concurrent"], ["remote", "concurrent"]]) {
    const result = await promisify(execFile)(process.execPath, ["--experimental-loader", loader, "--test", fixture], { env: { ...environment, PROOFWEAVE_TEST_STORAGE_MODE: storageMode, PROOFWEAVE_TEST_LOCK_MODE: lockMode }, timeout: 45_000, maxBuffer: 100_000 });
    assert.match(result.stdout, /(?:#|ℹ) pass 1/);
  }
});
