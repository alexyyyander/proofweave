#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultCatalogPath = fileURLToPath(new URL("../open-catalog/catalog/problems.json", import.meta.url));
const defaultConfigPath = fileURLToPath(new URL("../wrangler.cloudflare.jsonc", import.meta.url));

export const schemaVersion = "pw-target-environment-alignment-v1";

/**
 * Compare source-pinned catalog targets with the runner images an operator has
 * approved. A target is executable only when both the Lean toolchain and the
 * Mathlib revision match an approved image exactly.
 */
export function buildTargetEnvironmentAlignment({ records, approvedImages }) {
  if (!Array.isArray(records)) throw new Error("records must be an array");
  if (!Array.isArray(approvedImages) || approvedImages.length === 0) {
    throw new Error("approvedImages must be a non-empty array");
  }
  const approved = approvedImages.map((image, index) => ({
    index,
    imageDigest: requirePin(image?.imageDigest, `approvedImages[${index}].imageDigest`),
    leanToolchain: requirePin(image?.leanToolchain, `approvedImages[${index}].leanToolchain`),
    mathlibRevision: requirePin(image?.mathlibRevision, `approvedImages[${index}].mathlibRevision`),
  }));

  const aligned = records.map((record, index) => {
    const slug = requirePin(record?.slug, `records[${index}].slug`);
    const leanToolchain = record?.source?.leanToolchain ?? null;
    const mathlibRevision = record?.source?.mathlibRevision ?? null;
    if (!leanToolchain || !mathlibRevision) {
      return {
        slug,
        title: record?.title ?? "",
        leanToolchain,
        mathlibRevision,
        status: "unknown",
        reason: "missing_pin",
        approvedImageDigest: null,
      };
    }
    const match = approved.find((image) =>
      image.leanToolchain === leanToolchain && image.mathlibRevision === mathlibRevision,
    );
    return {
      slug,
      title: record?.title ?? "",
      leanToolchain,
      mathlibRevision,
      status: match ? "executable" : "mismatch",
      reason: match ? null : "no_approved_image_matches_pin",
      approvedImageDigest: match?.imageDigest ?? null,
    };
  });

  const groups = new Map();
  for (const entry of aligned) {
    if (entry.status === "executable") continue;
    const key = `${entry.leanToolchain ?? "missing"} | ${entry.mathlibRevision ?? "missing"} | ${entry.status}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }

  return {
    schemaVersion,
    approved: approved.map(({ index, imageDigest, leanToolchain, mathlibRevision }) => ({
      index, imageDigest, leanToolchain, mathlibRevision,
    })),
    totals: {
      records: aligned.length,
      executable: aligned.filter((entry) => entry.status === "executable").length,
      mismatch: aligned.filter((entry) => entry.status === "mismatch").length,
      unknown: aligned.filter((entry) => entry.status === "unknown").length,
    },
    mismatchGroups: [...groups.entries()].map(([key, count]) => ({ key, count })),
    records: aligned,
  };
}

export function parseApprovedImages(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("RUNNER_APPROVED_IMAGES_JSON is missing or not a string");
  }
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("RUNNER_APPROVED_IMAGES_JSON is not valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("RUNNER_APPROVED_IMAGES_JSON must contain at least one approved image");
  }
  return parsed.map((image, index) => ({
    imageDigest: requirePin(image?.imageDigest, `approvedImages[${index}].imageDigest`),
    leanToolchain: requirePin(image?.leanToolchain, `approvedImages[${index}].leanToolchain`),
    mathlibRevision: requirePin(image?.mathlibRevision, `approvedImages[${index}].mathlibRevision`),
  }));
}

export function parseJsonc(text) {
  return JSON.parse(
    String(text)
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/,\s*([}\]])/g, "$1"),
  );
}

export function formatHumanReport(report) {
  const lines = [
    `Target environment alignment (${report.schemaVersion})`,
    `Catalog records: ${report.totals.records}`,
    `Approved images: ${report.approved.map((image) => `${image.leanToolchain} + mathlib:${short(image.mathlibRevision)}`).join(", ")}`,
    `executable ${report.totals.executable} | mismatch ${report.totals.mismatch} | unknown ${report.totals.unknown}`,
  ];
  if (report.mismatchGroups.length) {
    lines.push("", "Non-executable groups:");
    for (const group of report.mismatchGroups) lines.push(`- ${group.key} → ${group.count} targets`);
    const examples = report.records.filter((entry) => entry.status !== "executable").slice(0, 10);
    lines.push("", `Examples: ${examples.map((entry) => entry.slug).join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}

function requirePin(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
  return value;
}

function short(value) {
  return typeof value === "string" && value.length > 12 ? `${value.slice(0, 12)}…` : String(value);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const catalogPath = readFlag("--catalog") ?? defaultCatalogPath;
  const configPath = readFlag("--config") ?? defaultConfigPath;
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  if (!Array.isArray(catalog.records)) throw new Error("catalog.records must be an array");
  const config = parseJsonc(await readFile(configPath, "utf8"));
  const approvedImages = parseApprovedImages(config?.vars?.RUNNER_APPROVED_IMAGES_JSON);
  const report = buildTargetEnvironmentAlignment({ records: catalog.records, approvedImages });
  if (args.has("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatHumanReport(report));
  }
  if (args.has("--strict") && report.totals.mismatch + report.totals.unknown > 0) {
    process.exitCode = 1;
  }
}

function readFlag(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a path`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
