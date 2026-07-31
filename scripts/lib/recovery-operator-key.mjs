import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
} from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import { normalizeProductionDrillPolicy } from "./production-drill-policy.mjs";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9:._+/-]{0,511}$/;
const publicKeyPattern = /^[A-Za-z0-9_-]{43}$/;
const maximumPrivateJwkBytes = 16 * 1024;
const supportedPlatforms = new Set([
  "aix",
  "darwin",
  "freebsd",
  "linux",
  "openbsd",
  "sunos",
]);

export const recoveryOperatorKeyMaterialSchemaVersion =
  "pw-recovery-operator-key-material-v1";

export class RecoveryOperatorKeyError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = "RecoveryOperatorKeyError";
    this.code = code;
  }
}

export function defaultRecoveryOperatorPrivateKeyPath(keyId) {
  const normalizedKeyId = normalizeKeyId(keyId);
  const filename = `${normalizedKeyId.replace(/[^A-Za-z0-9._-]/g, "-")}.private.jwk`;
  return join(homedir(), ".proofweave", "release-keys", filename);
}

export async function generateRecoveryOperatorKey({
  keyId,
  privateKeyFile = defaultRecoveryOperatorPrivateKeyPath(keyId),
  repositoryRoot,
}) {
  const normalizedKeyId = normalizeKeyId(keyId);
  const pair = generateKeyPairSync("ed25519");
  const privateJwk = pair.privateKey.export({ format: "jwk" });
  return persistPrivateKey({
    operation: "generate",
    keyId: normalizedKeyId,
    privateJwk,
    privateKeyFile,
    repositoryRoot,
  });
}

export async function importRecoveryOperatorKey({
  keyId,
  sourcePrivateKeyFile,
  privateKeyFile = defaultRecoveryOperatorPrivateKeyPath(keyId),
  repositoryRoot,
}) {
  const normalizedKeyId = normalizeKeyId(keyId);
  const privateJwk = await readSecureRecoveryOperatorPrivateKey({
    privateKeyFile: sourcePrivateKeyFile,
    repositoryRoot,
  });
  return persistPrivateKey({
    operation: "import",
    keyId: normalizedKeyId,
    privateJwk,
    privateKeyFile,
    repositoryRoot,
  });
}

export async function inspectRecoveryOperatorKey({
  keyId,
  privateKeyFile,
  repositoryRoot,
}) {
  const normalizedKeyId = normalizeKeyId(keyId);
  const privateJwk = await readSecureRecoveryOperatorPrivateKey({
    privateKeyFile,
    repositoryRoot,
  });
  return publicResult({
    operation: "inspect",
    keyId: normalizedKeyId,
    privateKeyFile: resolve(privateKeyFile),
    privateJwk,
  });
}

export async function verifyRecoveryOperatorKeyEnrollment({
  keyId,
  privateKeyFile,
  repositoryRoot,
  policy,
}) {
  const inspected = await inspectRecoveryOperatorKey({
    keyId,
    privateKeyFile,
    repositoryRoot,
  });
  const normalizedPolicy = normalizeProductionDrillPolicy(policy);
  const enrolled = normalizedPolicy.recoveryOperatorKeys.find(
    (entry) => entry.keyId === inspected.policyEntry.keyId,
  );
  if (
    !enrolled
    || enrolled.publicKey !== inspected.policyEntry.publicKey
    || enrolled.keyFingerprint !== inspected.policyEntry.keyFingerprint
  ) {
    throw keyError("RECOVERY_OPERATOR_KEY_NOT_ENROLLED");
  }
  return Object.freeze({
    ...inspected,
    operation: "verify",
    enrolled: true,
    policyVersion: normalizedPolicy.policyVersion,
  });
}

export async function readSecureRecoveryOperatorPrivateKey({
  privateKeyFile,
  repositoryRoot,
}) {
  assertSupportedSecurityPlatform();
  const path = await normalizeExternalPath({
    path: privateKeyFile,
    repositoryRoot,
    createParent: false,
  });
  let before;
  let handle;
  try {
    before = await lstat(path);
    assertSecurePrivateKeyMetadata(before);
    handle = await open(
      path,
      constants.O_RDONLY | platformNoFollowFlag(),
    );
    const after = await handle.stat();
    assertSecurePrivateKeyMetadata(after);
    if (
      before.dev !== after.dev
      || before.ino !== after.ino
      || after.size <= 0
      || after.size > maximumPrivateJwkBytes
    ) {
      throw keyError("RECOVERY_OPERATOR_PRIVATE_KEY_FILE_INVALID");
    }
    const source = await handle.readFile("utf8");
    return normalizePrivateJwk(JSON.parse(source));
  } catch (cause) {
    if (cause instanceof RecoveryOperatorKeyError) throw cause;
    throw keyError("RECOVERY_OPERATOR_PRIVATE_KEY_FILE_INVALID", { cause });
  } finally {
    await handle?.close().catch(() => {});
  }
}

export function recoveryOperatorPublicMetadata({ keyId, privateJwk }) {
  const normalizedKeyId = normalizeKeyId(keyId);
  const normalizedPrivateJwk = normalizePrivateJwk(privateJwk);
  const publicKey = normalizedPrivateJwk.x;
  return Object.freeze({
    keyId: normalizedKeyId,
    publicKey,
    keyFingerprint: `sha256:${createHash("sha256")
      .update(Buffer.from(publicKey, "base64url"))
      .digest("hex")}`,
  });
}

async function persistPrivateKey({
  operation,
  keyId,
  privateJwk,
  privateKeyFile,
  repositoryRoot,
}) {
  assertSupportedSecurityPlatform();
  const normalizedPrivateJwk = normalizePrivateJwk(privateJwk);
  const path = await normalizeExternalPath({
    path: privateKeyFile,
    repositoryRoot,
    createParent: true,
  });
  const source = `${JSON.stringify(normalizedPrivateJwk)}\n`;
  let temporaryPath;
  let handle;
  try {
    temporaryPath = join(
      dirname(path),
      `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
    );
    handle = await open(
      temporaryPath,
      constants.O_CREAT
        | constants.O_EXCL
        | constants.O_WRONLY
        | platformNoFollowFlag(),
      0o600,
    );
    await handle.chmod(0o600);
    await handle.writeFile(source, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;

    // link(2) is the no-clobber commit point: it atomically creates the final
    // name and fails with EEXIST rather than replacing an enrolled key.
    await link(temporaryPath, path);
    await unlink(temporaryPath);
    temporaryPath = undefined;
    await chmod(path, 0o600);
    await syncParentDirectory(dirname(path));

    // Read the committed inode through the same strict loader before reporting
    // any public material.
    const committed = await readSecureRecoveryOperatorPrivateKey({
      privateKeyFile: path,
      repositoryRoot,
    });
    if (
      committed.d !== normalizedPrivateJwk.d
      || committed.x !== normalizedPrivateJwk.x
    ) {
      throw keyError("RECOVERY_OPERATOR_PRIVATE_KEY_COMMIT_MISMATCH");
    }
    return publicResult({
      operation,
      keyId,
      privateKeyFile: path,
      privateJwk: committed,
    });
  } catch (cause) {
    if (cause?.code === "EEXIST") {
      throw keyError("RECOVERY_OPERATOR_PRIVATE_KEY_FILE_EXISTS", { cause });
    }
    if (cause instanceof RecoveryOperatorKeyError) throw cause;
    throw keyError("RECOVERY_OPERATOR_PRIVATE_KEY_WRITE_FAILED", { cause });
  } finally {
    await handle?.close().catch(() => {});
    if (temporaryPath) await unlink(temporaryPath).catch(() => {});
  }
}

function publicResult({ operation, keyId, privateKeyFile, privateJwk }) {
  return Object.freeze({
    schemaVersion: recoveryOperatorKeyMaterialSchemaVersion,
    operation,
    privateKeyFile,
    policyEntry: recoveryOperatorPublicMetadata({ keyId, privateJwk }),
    environment: Object.freeze({
      PROOFWEAVE_DRILL_RECOVERY_OPERATOR_KEY_ID: keyId,
      PROOFWEAVE_DRILL_RECOVERY_OPERATOR_PRIVATE_KEY_JWK_FILE: privateKeyFile,
    }),
  });
}

function normalizePrivateJwk(value) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.kty !== "OKP"
    || value.crv !== "Ed25519"
    || typeof value.x !== "string"
    || typeof value.d !== "string"
    || !publicKeyPattern.test(value.x)
    || !publicKeyPattern.test(value.d)
    || Buffer.from(value.x, "base64url").length !== 32
    || Buffer.from(value.d, "base64url").length !== 32
    || Buffer.from(value.x, "base64url").toString("base64url") !== value.x
    || Buffer.from(value.d, "base64url").toString("base64url") !== value.d
  ) {
    throw keyError("RECOVERY_OPERATOR_PRIVATE_KEY_INVALID");
  }
  try {
    const privateKey = createPrivateKey({ key: value, format: "jwk" });
    const derivedPublicJwk = createPublicKey(privateKey).export({ format: "jwk" });
    if (
      derivedPublicJwk.kty !== "OKP"
      || derivedPublicJwk.crv !== "Ed25519"
      || derivedPublicJwk.x !== value.x
    ) {
      throw new Error("private and public Ed25519 key material do not match");
    }
  } catch (cause) {
    throw keyError("RECOVERY_OPERATOR_PRIVATE_KEY_INVALID", { cause });
  }
  return Object.freeze({
    kty: "OKP",
    crv: "Ed25519",
    x: value.x,
    d: value.d,
  });
}

function normalizeKeyId(value) {
  if (
    typeof value !== "string"
    || !identifierPattern.test(value)
    || value.trim() !== value
  ) {
    throw keyError("RECOVERY_OPERATOR_KEY_ID_INVALID");
  }
  return value;
}

async function normalizeExternalPath({
  path,
  repositoryRoot,
  createParent,
}) {
  if (
    typeof path !== "string"
    || !isAbsolute(path)
    || path.length > 1_024
    || path.trim() !== path
    || /[\0\r\n]/.test(path)
    || typeof repositoryRoot !== "string"
  ) {
    throw keyError("RECOVERY_OPERATOR_PRIVATE_KEY_PATH_INVALID");
  }
  const root = resolve(repositoryRoot);
  const target = resolve(path);
  if (isInside(root, target)) {
    throw keyError("RECOVERY_OPERATOR_PRIVATE_KEY_FILE_INSIDE_REPOSITORY");
  }
  const parent = dirname(target);
  if (createParent) await mkdir(parent, { recursive: true, mode: 0o700 });
  let canonicalRoot;
  let canonicalParent;
  try {
    [canonicalRoot, canonicalParent] = await Promise.all([
      realpath(root),
      realpath(parent),
    ]);
  } catch (cause) {
    throw keyError("RECOVERY_OPERATOR_PRIVATE_KEY_PATH_INVALID", { cause });
  }
  // Resolve the parent once and write through that canonical directory. macOS
  // commonly exposes /var as a system symlink to /private/var; canonicalizing
  // it is safe, while reusing the caller's unresolved path would permit a
  // parent-link swap between validation and creation.
  if (isInside(canonicalRoot, join(canonicalParent, basename(target)))) {
    throw keyError("RECOVERY_OPERATOR_PRIVATE_KEY_PATH_INVALID");
  }
  return join(canonicalParent, basename(target));
}

function assertSecurePrivateKeyMetadata(metadata) {
  const currentUid = process.getuid();
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || metadata.uid !== currentUid
    || metadata.nlink !== 1
    || (metadata.mode & 0o777) !== 0o600
  ) {
    throw keyError("RECOVERY_OPERATOR_PRIVATE_KEY_FILE_INVALID");
  }
}

function assertSupportedSecurityPlatform() {
  if (
    !supportedPlatforms.has(process.platform)
    || typeof process.getuid !== "function"
  ) {
    throw keyError("RECOVERY_OPERATOR_PRIVATE_KEY_PLATFORM_UNSUPPORTED");
  }
}

function platformNoFollowFlag() {
  return constants.O_NOFOLLOW ?? 0;
}

function isInside(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function syncParentDirectory(parent) {
  let handle;
  try {
    handle = await open(parent, constants.O_RDONLY);
    await handle.sync();
  } catch {
    // Some supported filesystems do not allow fsync on directories. The key
    // inode is already fsynced and atomically linked; inability to sync the
    // directory is not permission to expose or rewrite it.
  } finally {
    await handle?.close().catch(() => {});
  }
}

function keyError(code, options) {
  return new RecoveryOperatorKeyError(code, options);
}
