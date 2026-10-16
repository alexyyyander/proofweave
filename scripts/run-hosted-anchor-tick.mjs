#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

// Credentials stay in an ignored, owner-readable file, never in command arguments.
const { values } = parseArgs({ options: { credentials: { type: "string" } }, strict: true });
try {
  if (!values.credentials) throw new Error("Pass --credentials <private JSON file>.");
  const { url, token } = JSON.parse(await readFile(values.credentials, "utf8"));
  if (url !== "https://proofweave.org/api/internal/anchors/tick" || typeof token !== "string" || token.length < 32) {
    throw new Error("Invalid hosted anchor tick credentials.");
  }
  const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(180_000) });
  const result = await response.json();
  console.log(JSON.stringify({ httpStatus: response.status, ...result }));
  if (!response.ok || !["ok", "busy", "conflict"].includes(result.status)) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Hosted anchor tick failed.");
  process.exitCode = 1;
}
