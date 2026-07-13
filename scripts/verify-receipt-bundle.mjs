#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import {
  contributionReceiptVerificationBundleHash,
  verifyContributionReceiptVerificationBundle,
} from "../packages/protocol/contribution-receipt-verification-bundle.mjs";

const [inputPath] = process.argv.slice(2);

if (!inputPath || process.argv.length !== 3) {
  console.error("Usage: node scripts/verify-receipt-bundle.mjs /path/to/verification-bundle.json");
  process.exitCode = 64;
} else {
  try {
    const source = await readFile(inputPath, "utf8");
    const verified = await verifyContributionReceiptVerificationBundle(JSON.parse(source));
    const bundleHash = await contributionReceiptVerificationBundleHash(verified);
    process.stdout.write(`${JSON.stringify({
      verified: true,
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
