#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

// Credentials stay in an ignored, owner-readable file, never in command arguments.
export async function requestHostedAnchorTick({ url, token }, { fetcher = fetch } = {}) {
  if (url !== "https://proofweave.org/api/internal/anchors/tick" || typeof token !== "string" || token.length < 32) {
    throw new Error("Invalid hosted anchor tick credentials.");
  }
  let response;
  try {
    response = await fetcher(url, { method: "POST", headers: { authorization: `Bearer ${token}` },
      redirect: "manual", signal: AbortSignal.timeout(180_000) });
  } catch {
    // A lost response does not establish whether the server processed the tick.
    return { summary: { httpStatus: null, status: "transport_error", outcome: "unknown" }, exitCode: 1 };
  }
  const contentType = response.headers.get("content-type") ?? "";
  const ray = response.headers.get("cf-ray") ?? "";
  const diagnostic = {
    httpStatus: response.status,
    contentType: contentType.split(";")[0].trim().slice(0,80),
    ...(/^[a-f0-9]+-[A-Za-z0-9]+$/.test(ray) ? { cloudflareRayId: ray } : {}),
  };
  if (response.status >= 300 && response.status < 400) {
    return { summary: { ...diagnostic, status: "unexpected_redirect" }, exitCode: 1 };
  }
  let result;
  try { result = await response.json(); } catch {
    // Do not echo HTML/error bodies: they can contain credentials or private diagnostics.
    const edgeBlocked = response.status === 403 && contentType.includes("text/html") && diagnostic.cloudflareRayId;
    return { summary: { ...diagnostic, status: edgeBlocked ? "edge_blocked" : "invalid_response" }, exitCode: 1 };
  }
  if (!result || typeof result !== "object" || Array.isArray(result) || typeof result.status !== "string") {
    return { summary: { ...diagnostic, status: "invalid_response" }, exitCode: 1 };
  }
  return { summary: { ...result, httpStatus: response.status },
    exitCode: response.ok && ["ok", "busy", "conflict"].includes(result.status) ? 0 : 1 };
}

async function main() {
  const { values } = parseArgs({ options: { credentials: { type: "string" } }, strict: true });
  if (!values.credentials) throw new Error("Pass --credentials <private JSON file>.");
  let credentials;
  try { credentials = JSON.parse(await readFile(values.credentials, "utf8")); }
  catch { throw new Error("Unable to read hosted anchor tick credentials."); }
  const { summary, exitCode } = await requestHostedAnchorTick(credentials ?? {});
  console.log(JSON.stringify(summary));
  process.exitCode = exitCode;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Hosted anchor tick failed.");
    process.exitCode = 1;
  });
}
