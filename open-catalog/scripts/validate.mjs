import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const path = resolve(import.meta.dirname, "../catalog/problems.json");
const catalog = JSON.parse(await readFile(path, "utf8"));
const errors = [];
const slugs = new Set();
const sha256 = /^sha256:[a-f0-9]{64}$/;
const commit = /^[a-f0-9]{40}$/;

if (catalog.schemaVersion !== 1) errors.push("schemaVersion must equal 1");
if (!Array.isArray(catalog.records) || catalog.records.length === 0) errors.push("records must be a non-empty array");
if (catalog.catalog?.recordCount !== catalog.records?.length) errors.push("catalog.recordCount must match records.length");
if (!catalog.catalog?.boundary?.includes("not a claim")) errors.push("catalog boundary must preserve the source-pinned review disclaimer");

for (const [index, record] of (catalog.records ?? []).entries()) {
  const at = `records[${index}]`;
  if (!record.id || !record.slug || !record.title) errors.push(`${at} requires id, slug, and title`);
  if (slugs.has(record.slug)) errors.push(`${at}.slug duplicates ${record.slug}`);
  slugs.add(record.slug);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.slug)) errors.push(`${at}.slug is not canonical`);
  if (!commit.test(record.source?.revision ?? "")) errors.push(`${at}.source.revision must be a full Git commit`);
  if (!sha256.test(record.source?.contentHash ?? "")) errors.push(`${at}.source.contentHash must be SHA-256`);
  if (!record.source?.leanToolchain || !record.source?.mathlibRevision) errors.push(`${at} must pin Lean and mathlib`);
  if (!record.formalization?.qualifiedName || !record.formalization?.statement) errors.push(`${at} must identify the formal declaration`);
  if (!record.researchStatus?.value || typeof record.researchStatus.proofweaveAttested !== "boolean") errors.push(`${at} must expose the authority and attestation boundary for research status`);
  if (record.researchStatus?.authority === "upstream_import" && record.researchStatus.proofweaveAttested !== false) errors.push(`${at} cannot attest an imported research status`);
  if (!record.frontierAudit || !Array.isArray(record.frontierAudit.priorWork)) errors.push(`${at} must expose frontierAudit`);
  if (record.frontierAudit?.status === "reviewed" && (!record.frontierAudit.literatureCheckedThrough || !record.frontierAudit.reviewedBy || record.frontierAudit.priorWork.length === 0)) {
    errors.push(`${at} cannot be reviewed without a date, reviewer, and prior work`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${catalog.records.length} source-pinned records with explicit frontier-audit boundaries.`);
}
