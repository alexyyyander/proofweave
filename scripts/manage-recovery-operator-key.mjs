#!/usr/bin/env node

import {
  defaultRecoveryOperatorPrivateKeyPath,
  generateRecoveryOperatorKey,
  importRecoveryOperatorKey,
  inspectRecoveryOperatorKey,
  verifyRecoveryOperatorKeyEnrollment,
} from "./lib/recovery-operator-key.mjs";
import { loadProductionDrillPolicy } from "./lib/production-drill-policy.mjs";

const [command, ...argv] = process.argv.slice(2);

try {
  const options = parseArguments(argv);
  const keyId = required(options, "key-id");
  const repositoryRoot = options["repository-root"] ?? process.cwd();
  const privateKeyFile = options["private-key-file"]
    ?? defaultRecoveryOperatorPrivateKeyPath(keyId);
  let result;
  if (command === "generate") {
    result = await generateRecoveryOperatorKey({
      keyId,
      privateKeyFile,
      repositoryRoot,
    });
  } else if (command === "import") {
    result = await importRecoveryOperatorKey({
      keyId,
      sourcePrivateKeyFile: required(options, "source-private-key-file"),
      privateKeyFile,
      repositoryRoot,
    });
  } else if (command === "inspect") {
    result = await inspectRecoveryOperatorKey({
      keyId,
      privateKeyFile,
      repositoryRoot,
    });
  } else if (command === "verify") {
    result = await verifyRecoveryOperatorKeyEnrollment({
      keyId,
      privateKeyFile,
      repositoryRoot,
      policy: loadProductionDrillPolicy({ root: repositoryRoot }),
    });
  } else {
    throw new Error("usage: manage-recovery-operator-key.mjs <generate|import|inspect|verify> --key-id <id> [--private-key-file <absolute path>] [--source-private-key-file <absolute path>] [--repository-root <path>]");
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const code = typeof error?.code === "string"
    ? error.code
    : "RECOVERY_OPERATOR_KEY_COMMAND_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      typeof name !== "string"
      || !name.startsWith("--")
      || name.length <= 2
      || typeof value !== "string"
      || value.startsWith("--")
      || Object.hasOwn(options, name.slice(2))
    ) {
      throw new Error("invalid command arguments");
    }
    options[name.slice(2)] = value;
  }
  return options;
}

function required(options, name) {
  const value = options[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing --${name}`);
  }
  return value;
}
