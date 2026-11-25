#!/usr/bin/env node
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { canonicalJson, sha256Canonical } from "../packages/protocol/canonical-json.mjs";
import { normalizePoolFinalityPayload } from "../packages/protocol/pool-finality-adjudication.mjs";

try {
  if (process.execArgv.length !== 0 || process.env.NODE_OPTIONS || process.argv.length !== 3 || process.argv[2].length > 4096) throw new Error("invalid arguments");
  const handle = await open(process.argv[2], constants.O_RDONLY | constants.O_NOFOLLOW);
  let payload;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > 32_768) throw new Error("invalid file");
    payload = normalizePoolFinalityPayload(JSON.parse(await handle.readFile({ encoding: "utf8" })));
  } finally { await handle.close(); }
  process.stdout.write(`${JSON.stringify({ canonicalPayload: canonicalJson(payload), payloadHash: await sha256Canonical(payload) }, null, 2)}\n`);
} catch {
  process.stderr.write("FINALITY_PAYLOAD_INVALID\n");
  process.exitCode = 1;
}
