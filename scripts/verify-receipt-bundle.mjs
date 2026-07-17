#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import {
  contributionReceiptVerificationBundleHash,
  verifyContributionReceiptVerificationBundle,
  verifyContributionReceiptVerificationBundleWithIssuerKeyset,
} from "../packages/protocol/contribution-receipt-verification-bundle.mjs";

const [inputPath, ...options] = process.argv.slice(2);
const issuerKeysetPath = options.length === 2 && options[0] === "--issuer-keyset" ? options[1] : null;

if (!inputPath || (options.length !== 0 && !issuerKeysetPath)) {
  console.error("Usage: node scripts/verify-receipt-bundle.mjs /path/to/verification-bundle.json [--issuer-keyset /path/to/issuer-keys.json]");
  process.exitCode = 64;
} else {
  try {
    const source = await readFile(inputPath, "utf8");
    const bundle = JSON.parse(source);
    const verified = issuerKeysetPath
      ? await verifyContributionReceiptVerificationBundleWithIssuerKeyset(bundle, JSON.parse(await readFile(issuerKeysetPath, "utf8")))
      : await verifyContributionReceiptVerificationBundle(bundle);
    const bundleHash = await contributionReceiptVerificationBundleHash(verified);
    process.stdout.write(`${JSON.stringify({
      verified: true,
      issuerKeysetChecked: Boolean(issuerKeysetPath),
      protocolVersion: verified.protocolVersion,
      rootReceiptId: verified.rootReceiptId,
      receiptCount: verified.receipts.length,
      issuerKeyCount: verified.issuerKeys.length,
      bundleHash,
    }, null, 2)}\n`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown verification error.";
    console.error(`Proofweave Receipt verification failed: ${detail}`);
    process.exitCode = 1;
  }
}
