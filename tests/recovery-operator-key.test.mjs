import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmod,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import {
  generateRecoveryOperatorKey,
  importRecoveryOperatorKey,
  inspectRecoveryOperatorKey,
  verifyRecoveryOperatorKeyEnrollment,
} from "../scripts/lib/recovery-operator-key.mjs";

const repositoryRoot = process.cwd();
const commandPath = resolve("scripts/manage-recovery-operator-key.mjs");

test("generate atomically creates an external mode-0600 Ed25519 key and reports only public material", async () => {
  const directory = await mkdtemp(join(tmpdir(), "proofweave-operator-generate-"));
  const privateKeyFile = join(directory, "operator.private.jwk");
  try {
    const result = await generateRecoveryOperatorKey({
      keyId: "release-operator:test-generate",
      privateKeyFile,
      repositoryRoot,
    });
    const metadata = await stat(privateKeyFile);
    const privateJwk = JSON.parse(await readFile(privateKeyFile, "utf8"));
    const serializedResult = JSON.stringify(result);

    assert.equal(metadata.mode & 0o777, 0o600);
    assert.equal(metadata.nlink, 1);
    assert.equal(result.privateKeyFile, await realpath(privateKeyFile));
    assert.equal(result.policyEntry.keyId, "release-operator:test-generate");
    assert.match(result.policyEntry.publicKey, /^[A-Za-z0-9_-]{43}$/);
    assert.match(result.policyEntry.keyFingerprint, /^sha256:[a-f0-9]{64}$/);
    assert.equal(result.policyEntry.publicKey, privateJwk.x);
    assert.equal(serializedResult.includes(privateJwk.d), false);
    assert.deepEqual(
      (await readdir(directory)).filter((name) => name.endsWith(".tmp")),
      [],
    );

    await assert.rejects(
      generateRecoveryOperatorKey({
        keyId: "release-operator:test-no-clobber",
        privateKeyFile,
        repositoryRoot,
      }),
      (error) => error.code === "RECOVERY_OPERATOR_PRIVATE_KEY_FILE_EXISTS",
    );
    assert.equal(
      JSON.parse(await readFile(privateKeyFile, "utf8")).d,
      privateJwk.d,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("import verifies the private/public pair, never overwrites, and preserves the source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "proofweave-operator-import-"));
  const sourcePrivateKeyFile = join(directory, "source.private.jwk");
  const importedPrivateKeyFile = join(directory, "imported.private.jwk");
  try {
    await generateRecoveryOperatorKey({
      keyId: "release-operator:test-source",
      privateKeyFile: sourcePrivateKeyFile,
      repositoryRoot,
    });
    const sourceBefore = await readFile(sourcePrivateKeyFile, "utf8");
    const result = await importRecoveryOperatorKey({
      keyId: "release-operator:test-imported",
      sourcePrivateKeyFile,
      privateKeyFile: importedPrivateKeyFile,
      repositoryRoot,
    });
    assert.equal(await readFile(sourcePrivateKeyFile, "utf8"), sourceBefore);
    assert.equal(await readFile(importedPrivateKeyFile, "utf8"), sourceBefore);
    assert.equal(
      result.policyEntry.publicKey,
      JSON.parse(sourceBefore).x,
    );

    const invalid = JSON.parse(sourceBefore);
    invalid.x = Buffer.alloc(32, 7).toString("base64url");
    const invalidSource = join(directory, "invalid.private.jwk");
    await writeFile(invalidSource, `${JSON.stringify(invalid)}\n`, { mode: 0o600 });
    await assert.rejects(
      importRecoveryOperatorKey({
        keyId: "release-operator:test-invalid",
        sourcePrivateKeyFile: invalidSource,
        privateKeyFile: join(directory, "must-not-exist.private.jwk"),
        repositoryRoot,
      }),
      (error) => error.code === "RECOVERY_OPERATOR_PRIVATE_KEY_INVALID",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("inspect rejects repository-local and over-permissive private-key files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "proofweave-operator-inspect-"));
  const privateKeyFile = join(directory, "operator.private.jwk");
  const repositoryLocalFile = resolve("operator-test.private.jwk");
  try {
    await generateRecoveryOperatorKey({
      keyId: "release-operator:test-inspect",
      privateKeyFile,
      repositoryRoot,
    });
    await chmod(privateKeyFile, 0o644);
    await assert.rejects(
      inspectRecoveryOperatorKey({
        keyId: "release-operator:test-inspect",
        privateKeyFile,
        repositoryRoot,
      }),
      (error) => error.code === "RECOVERY_OPERATOR_PRIVATE_KEY_FILE_INVALID",
    );
    await assert.rejects(
      generateRecoveryOperatorKey({
        keyId: "release-operator:test-local",
        privateKeyFile: repositoryLocalFile,
        repositoryRoot,
      }),
      (error) => error.code === "RECOVERY_OPERATOR_PRIVATE_KEY_FILE_INSIDE_REPOSITORY",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(repositoryLocalFile, { force: true });
  }
});

test("verify requires the exact reviewed key id, public bytes, and fingerprint", async () => {
  const directory = await mkdtemp(join(tmpdir(), "proofweave-operator-verify-"));
  const privateKeyFile = join(directory, "operator.private.jwk");
  try {
    const generated = await generateRecoveryOperatorKey({
      keyId: "release-operator:test-verify",
      privateKeyFile,
      repositoryRoot,
    });
    const policy = fixturePolicy(generated.policyEntry);
    const verified = await verifyRecoveryOperatorKeyEnrollment({
      keyId: generated.policyEntry.keyId,
      privateKeyFile,
      repositoryRoot,
      policy,
    });
    assert.equal(verified.enrolled, true);
    assert.equal(verified.policyVersion, 99);

    await assert.rejects(
      verifyRecoveryOperatorKeyEnrollment({
        keyId: "release-operator:test-unenrolled",
        privateKeyFile,
        repositoryRoot,
        policy,
      }),
      (error) => error.code === "RECOVERY_OPERATOR_KEY_NOT_ENROLLED",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI stdout contains public enrollment metadata but never private key bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "proofweave-operator-cli-"));
  const privateKeyFile = join(directory, "operator.private.jwk");
  try {
    const command = spawnSync(process.execPath, [
      commandPath,
      "generate",
      "--key-id",
      "release-operator:test-cli",
      "--private-key-file",
      privateKeyFile,
      "--repository-root",
      repositoryRoot,
    ], {
      encoding: "utf8",
    });
    assert.equal(command.status, 0, command.stderr);
    const privateJwk = JSON.parse(await readFile(privateKeyFile, "utf8"));
    const output = JSON.parse(command.stdout);
    assert.equal(output.policyEntry.publicKey, privateJwk.x);
    assert.equal(command.stdout.includes(privateJwk.d), false);
    assert.equal(command.stderr.includes(privateJwk.d), false);
    assert.equal(Object.hasOwn(output, "privateJwk"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("tracked source contains no private-key artifact or literal private Ed25519 JWK", async () => {
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).split("\0").filter(Boolean);
  for (const path of tracked) {
    assert.doesNotMatch(path, /(?:^|\/).*(?:private|operator-private)\.jwk$/i);
    let source;
    try {
      source = await readFile(join(repositoryRoot, path), "utf8");
    } catch {
      continue;
    }
    assert.doesNotMatch(
      source,
      /"kty"\s*:\s*"OKP"[\s\S]{0,1024}"crv"\s*:\s*"Ed25519"[\s\S]{0,1024}"d"\s*:\s*"[A-Za-z0-9_-]{43}"/,
      `${path} must not contain a literal private Ed25519 JWK`,
    );
  }
});

function fixturePolicy(policyEntry) {
  return {
    schemaVersion: "pw-production-drill-policy-v2",
    policyVersion: 99,
    githubRepository: {
      fullName: "example/proofweave",
      id: 123456,
    },
    productionAuthorities: {
      site: {
        origin: "https://proofweave.example",
        projectId: `appgprj_${"f".repeat(32)}`,
      },
      runner: {
        origin: "https://runner.example",
      },
      turso: {
        databaseFingerprint: "0123456789abcdef",
      },
    },
    recoveryOperatorKeys: [policyEntry],
  };
}
