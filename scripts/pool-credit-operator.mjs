#!/usr/bin/env node
import { executePoolCreditOperator, PoolCreditOperatorError } from "./lib/pool-credit-operator.mjs";

try {
  // Do not let an inherited loader replace the compiled owner trust registry.
  if (process.execArgv.length !== 0 || process.env.NODE_OPTIONS) throw new PoolCreditOperatorError("UNSUPPORTED_NODE_OPTIONS");
  const result = await executePoolCreditOperator({ args: process.argv.slice(2), environment: process.env });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  // Do not expose database URLs, credentials, or private database errors.
  const code = error instanceof PoolCreditOperatorError ? error.code : "SETTLEMENT_UNAVAILABLE_OR_NOT_AUTHORIZED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}
