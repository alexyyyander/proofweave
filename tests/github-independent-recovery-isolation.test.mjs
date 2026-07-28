import assert from "node:assert/strict";
import { chmod, link, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  assertRecoveryIsolationOperatorKeyFileMetadata,
  beginRecoveryIsolationSnapshot,
  loadRecoveryIsolationOperatorPrivateKey,
  recoveryIsolationReleaseConfiguration,
} from "../scripts/lib/github-independent-recovery-isolation.mjs";
import {
  runtimeRecoveryIsolationKeyFingerprint,
} from "../packages/protocol/runtime-recovery-isolation.mjs";
import {
  loadProductionDrillPolicy,
  productionDrillPolicyHash,
} from "../scripts/lib/production-drill-policy.mjs";

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

test("checked-in production policy fixes resource identity and enrolls only the reviewed operator key", async () => {
  const policy = loadProductionDrillPolicy({ root: process.cwd() });
  assert.equal(policy.githubRepository.fullName, "alexyyyander/proofweave");
  assert.equal(policy.githubRepository.id, 1298911069);
  assert.equal(policy.schemaVersion, "pw-production-drill-policy-v2");
  assert.equal(
    policy.productionAuthorities.site.origin,
    "https://proofweave-research.yualex031821.chatgpt.site",
  );
  assert.equal(
    policy.productionAuthorities.site.projectId,
    "appgprj_6a54400d01a8819199224b722afae056",
  );
  assert.equal(
    policy.productionAuthorities.runner.origin,
    "https://proofweave-trusted-runner.onrender.com",
  );
  assert.equal(
    policy.productionAuthorities.turso.databaseFingerprint,
    "3f9e7934a04a22ec",
  );
  assert.deepEqual(policy.recoveryOperatorKeys, [{
    keyId: "release-operator:alexyu-20260728",
    publicKey: "i-0Y3KVtoeVA8U6F7WX2_jLjNCSTWGRK76-f3K48bsM",
    keyFingerprint: "sha256:f2bbb9b62a10ab014030209be94679aa67d56e00700329e7b60a9686a8e7f162",
  }]);
  const configuration = await recoveryIsolationReleaseConfiguration({
    environment: {},
    root: process.cwd(),
    policyBinding: {
      policy,
      policyHash: productionDrillPolicyHash(policy),
      gitOriginRepositoryFullName: policy.githubRepository.fullName,
    },
  });
  assert.equal(configuration.trustedKeyset.keys.length, 1);
});

test("release recovery configuration is fixed by policy and environment is assertion-only", async () => {
  const environment = validEnvironment();
  const configuration = await recoveryIsolationReleaseConfiguration(configurationInput(environment));
  assert.equal(configuration.repositoryId, 4242);
  assert.equal(configuration.trustedKeyset.keys[0].publicKey, publicKey);

  await assert.rejects(
    recoveryIsolationReleaseConfiguration(configurationInput({
      ...environment,
      PROOFWEAVE_DRILL_GITHUB_REPOSITORY: "attacker/fork",
    })),
    (error) => error.code === "RECOVERY_REPOSITORY_ASSERTION_MISMATCH",
  );
  const selfSelected = structuredClone(trustedKeyset());
  selfSelected.keys[0].keyId = "attacker:self-selected";
  await assert.rejects(
    recoveryIsolationReleaseConfiguration(configurationInput({
      ...environment,
      PROOFWEAVE_DRILL_RECOVERY_TRUSTED_KEYS_JSON: JSON.stringify(selfSelected),
    })),
    (error) => error.code === "RECOVERY_TRUSTED_KEYS_ASSERTION_MISMATCH",
  );
  const noKeys = { ...fixturePolicy(), recoveryOperatorKeys: [] };
  await assert.rejects(
    recoveryIsolationReleaseConfiguration(configurationInput({}, noKeys)),
    (error) => error.code === "RECOVERY_OPERATOR_KEYS_NOT_ENROLLED",
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
        release: {
          gitSha: "a".repeat(40),
          productionDrillPolicy: fixturePolicy(),
          productionDrillPolicyHash: productionDrillPolicyHash(fixturePolicy()),
          gitOriginRepositoryFullName: "proofweave/research",
        },
        releaseFingerprint: `sha256:${"b".repeat(64)}`,
        correlationId: "correlation:production-01",
        subject: {
          personId: "person:production-owner",
          agentId: "agent:production-prover",
          artifactBundleHash: `sha256:${"c".repeat(64)}`,
        },
        root: process.cwd(),
        policyProvider: async () => fixturePolicy(),
        gitOriginProvider: async () => "https://github.com/proofweave/research.git",
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

test("same-SHA fork origin and policy drift cannot reuse an unchanged manifest binding", async () => {
  await assert.rejects(
    recoveryIsolationReleaseConfiguration({
      ...configurationInput(validEnvironment()),
      gitOriginProvider: async () => "https://github.com/attacker/proofweave.git",
    }),
    (error) => error.code === "PRODUCTION_DRILL_GIT_ORIGIN_POLICY_MISMATCH",
  );
  const drifted = { ...fixturePolicy(), policyVersion: 3 };
  await assert.rejects(
    recoveryIsolationReleaseConfiguration({
      ...configurationInput(validEnvironment()),
      policyProvider: async () => drifted,
    }),
    (error) => error.code === "RECOVERY_POLICY_MANIFEST_MISMATCH",
  );
});

test("operator key id and derived public key must both be enrolled by policy", async () => {
  const base = {
    environment: {
      ...validEnvironment(),
      PROOFWEAVE_DRILL_GITHUB_TOKEN: "github-read-token",
    },
    release: {
      gitSha: "a".repeat(40),
      productionDrillPolicy: fixturePolicy(),
      productionDrillPolicyHash: productionDrillPolicyHash(fixturePolicy()),
      gitOriginRepositoryFullName: "proofweave/research",
    },
    releaseFingerprint: `sha256:${"b".repeat(64)}`,
    correlationId: "correlation:production-01",
    root: process.cwd(),
    policyProvider: async () => fixturePolicy(),
    gitOriginProvider: async () => "https://github.com/proofweave/research.git",
    inspector: async () => {
      throw new Error("inspector must not run for an untrusted operator");
    },
  };
  await assert.rejects(
    beginRecoveryIsolationSnapshot({
      ...base,
      environment: {
        ...base.environment,
        PROOFWEAVE_DRILL_RECOVERY_OPERATOR_KEY_ID: "release-operator:unknown",
      },
      operatorPrivateKeyProvider: async () => privateKeyJwk,
    }),
    (error) => error.code === "RECOVERY_OPERATOR_KEY_ID_NOT_ENROLLED",
  );

  const otherPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  );
  const otherPrivateKey = await crypto.subtle.exportKey("jwk", otherPair.privateKey);
  await assert.rejects(
    beginRecoveryIsolationSnapshot({
      ...base,
      environment: {
        ...base.environment,
        PROOFWEAVE_DRILL_RECOVERY_OPERATOR_KEY_ID: "release-operator:production-01",
      },
      operatorPrivateKeyProvider: async () => otherPrivateKey,
    }),
    (error) => error.code === "RECOVERY_OPERATOR_KEY_NOT_ENROLLED",
  );
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

test("production operator private key file rejects hardlinks and wrong ownership metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "proofweave-recovery-key-hardlink-"));
  const path = join(directory, "operator.jwk");
  const alias = join(directory, "operator-alias.jwk");
  try {
    await writeFile(path, JSON.stringify(privateKeyJwk), { mode: 0o600 });
    await link(path, alias);
    await assert.rejects(
      loadRecoveryIsolationOperatorPrivateKey({
        environment: {
          PROOFWEAVE_DRILL_RECOVERY_OPERATOR_PRIVATE_KEY_JWK_FILE: path,
        },
        root: process.cwd(),
      }),
      (error) => error.code === "RECOVERY_OPERATOR_PRIVATE_KEY_FILE_INVALID",
    );
    assert.throws(
      () => assertRecoveryIsolationOperatorKeyFileMetadata({
        isFile: () => true,
        isSymbolicLink: () => false,
        uid: 1001,
        nlink: 1,
        mode: 0o100600,
      }, { currentUid: 1000 }),
      /invalid recovery operator key file metadata/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function validEnvironment() {
  return {
    PROOFWEAVE_DRILL_GITHUB_REPOSITORY: "proofweave/research",
    PROOFWEAVE_DRILL_GITHUB_REPOSITORY_ID: "4242",
    PROOFWEAVE_DRILL_RECOVERY_TRUSTED_KEYS_JSON: JSON.stringify(trustedKeyset()),
  };
}

function fixturePolicy() {
  return {
    schemaVersion: "pw-production-drill-policy-v2",
    policyVersion: 2,
    githubRepository: { fullName: "proofweave/research", id: 4242 },
    productionAuthorities: {
      site: {
        origin: "https://proofweave.example",
        projectId: `appgprj_${"f".repeat(32)}`,
      },
      runner: { origin: "https://runner.example" },
      turso: { databaseFingerprint: "0123456789abcdef" },
    },
    recoveryOperatorKeys: [{
      keyId: "release-operator:production-01",
      publicKey,
      keyFingerprint,
    }],
  };
}

function trustedKeyset() {
  return {
    schemaVersion: "pw-runtime-recovery-operator-keyset-v1",
    keys: fixturePolicy().recoveryOperatorKeys,
  };
}

function configurationInput(environment, policy = fixturePolicy()) {
  return {
    environment,
    root: process.cwd(),
    policyBinding: {
      policy,
      policyHash: productionDrillPolicyHash(policy),
      gitOriginRepositoryFullName: policy.githubRepository.fullName,
    },
    policyProvider: async () => policy,
    gitOriginProvider: async () => `https://github.com/${policy.githubRepository.fullName}.git`,
  };
}
