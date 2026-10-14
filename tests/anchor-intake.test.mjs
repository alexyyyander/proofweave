// tests/anchor-intake.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createAnchorIntake } from "../services/anchoring/anchor-intake.mjs";

test("enqueue computes leafHash and rejects unknown record types", async () => {
  const inserted = [];
  const store = {
    async insertRecord(input) { inserted.push(input); return { created: inserted.length === 1 }; },
  };
  const intake = createAnchorIntake(store);
  const result = await intake.enqueueAnchorRecord({
    recordType: "contribution_receipt",
    recordId: "receipt:a",
    recordHash: `sha256:${"a".repeat(64)}`,
    createdAt: "2026-10-14T00:00:00.000Z",
  });
  assert.match(inserted[0].leafHash, /^sha256:[a-f0-9]{64}$/);
  await assert.rejects(
    () => intake.enqueueAnchorRecord({ recordType: "nope", recordId: "x", recordHash: `sha256:${"a".repeat(64)}` }),
    /recordType/,
  );
});
