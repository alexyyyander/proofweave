import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  beginRecoveryIsolationSnapshot,
  loadRecoveryIsolationOperatorPrivateKey,
  recoveryIsolationReleaseConfiguration,
} from "../scripts/lib/github-independent-recovery-isolation.mjs";
import {
  runtimeRecoveryIsolationKeyFingerprint,
} from "../packages/protocol/runtime-recovery-isolation.mjs";

const keyPair = await crypto.subtle.generateKey(
  { name: "Ed25519" },
  true,
  ["sign", "verify"],
);
const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
const publicKey = Buffer.from(
  await crypto.subtle.exportKey("raw", keyPair.publicKey),
).toString("base64url");
const keyFingerprint = await runtimeRecoveryIsolationKeyFingerprint(publicKey);

test("release recovery configuration is bounded and requires canonical public keys", async () => {
  const environment = validEnvironment();
  const configuration = await recoveryIsolationReleaseConfiguration(environment);
  assert.equal(configuration.repositoryId, 4242);
  assert.equal(configuration.trustedKeyset.keys[0].publicKey, publicKey);

  await assert.rejects(
    recoveryIsolationReleaseConfiguration({
      ...environment,
      PROOFWEAVE_DRILL_GITHUB_REPOSITORY: " proofweave/research",
    }),
    (error) => error.code === "RECOVERY_REPOSITORY_MISSING",
  );
  await assert.rejects(
    recoveryIsolationReleaseConfiguration({
      ...environment,
      PROOFWEAVE_DRILL_RECOVERY_TRUSTED_KEYS_JSON: "x".repeat((64 * 1024) + 1),
    }),
    (error) => error.code === "RECOVERY_TRUSTED_KEYS_MISSING",
  );
  const nonCanonical = JSON.parse(environment.PROOFWEAVE_DRILL_RECOVERY_TRUSTED_KEYS_JSON);
  nonCanonical.keys[0].publicKey = `${publicKey}=`;
  await assert.rejects(
    recoveryIsolationReleaseConfiguration({
      ...environment,
      PROOFWEAVE_DRILL_RECOVERY_TRUSTED_KEYS_JSON: JSON.stringify(nonCanonical),
    }),
    (error) => error.code === "RECOVERY_TRUSTED_KEYS_INVALID",
  );
});

test("begin rejects oversized or whitespace-bearing GitHub tokens before inspection", async () => {
  for (const token of [" token-with-leading-space", "x".repeat(4_097)]) {
    let inspected = false;
    await assert.rejects(
      beginRecoveryIsolationSnapshot({
        environment: {
          ...validEnvironment(),
          PROOFWEAVE_DRILL_GITHUB_TOKEN: token,
          PROOFWEAVE_DRILL_RECOVERY_OPERATOR_KEY_ID: "release-operator:production-01",
        },
        release: { gitSha: "a".repeat(40) },
        releaseFingerprint: `sha256:${"b".repeat(64)}`,
        correlationId: "correlation:production-01",
        root: process.cwd(),
        inspector: async () => {
          inspected = true;
          throw new Error("must not run");
        },
        operatorPrivateKeyProvider: async () => privateKeyJwk,
      }),
      (error) => error.code === "RECOVERY_GITHUB_TOKEN_MISSING",
    );
    assert.equal(inspected, false);
  }
});

test("production operator private key file must be external, regular, and mode 0600", async () => {
  const directory = await mkdtemp(join(tmpdir(), "proofweave-recovery-key-"));
  const path = join(directory, "operator.jwk");
  try {
    await writeFile(path, JSON.stringify(privateKeyJwk), { mode: 0o600 });
    assert.equal(
      (await loadRecoveryIsolationOperatorPrivateKey({
        environment: {
          PROOFWEAVE_DRILL_RECOVERY_OPERATOR_PRIVATE_KEY_JWK_FILE: path,
        },
        root: process.cwd(),
      })).d,
      privateKeyJwk.d,
    );
    await chmod(path, 0o644);
    await assert.rejects(
      loadRecoveryIsolationOperatorPrivateKey({
        environment: {
          PROOFWEAVE_DRILL_RECOVERY_OPERATOR_PRIVATE_KEY_JWK_FILE: path,
        },
        root: process.cwd(),
      }),
      (error) => error.code === "RECOVERY_OPERATOR_PRIVATE_KEY_FILE_INVALID",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function validEnvironment() {
  return {
    PROOFWEAVE_DRILL_GITHUB_REPOSITORY: "proofweave/research",
    PROOFWEAVE_DRILL_GITHUB_REPOSITORY_ID: "4242",
    PROOFWEAVE_DRILL_RECOVERY_TRUSTED_KEYS_JSON: JSON.stringify({
      schemaVersion: "pw-runtime-recovery-operator-keyset-v1",
      keys: [{
        keyId: "release-operator:production-01",
        publicKey,
        keyFingerprint,
      }],
    }),
  };
}
