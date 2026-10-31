import { createAnchorIntake } from "./anchor-intake.mjs";
import { researchCheckpointHash, verifyResearchCheckpointSignature } from "../../packages/protocol/research-checkpoint.mjs";
import { contributionReceiptHash } from "../../packages/protocol/contribution-receipt.mjs";
import { artifactBundleHash } from "../../packages/protocol/artifact-bundle.mjs";

// Only already-public evidence is eligible. Staged bundles and internal/demo receipts
// must not leak into the immutable public manifest. Each tick has bounded work.
export async function enqueuePublicAnchorRecords(database, store) {
  const intake = createAnchorIntake(store);
  let enqueued = 0;
  const sources = [
    { type: "research_checkpoint", query: `SELECT n.id, n.checkpoint_hash AS hash,
        n.canonical_checkpoint AS canonical, n.agent_event_occurred_at AS created_at
        FROM research_nodes n JOIN problem_revisions r ON r.id = n.problem_revision_id
        JOIN projects project ON project.id = r.project_id
        WHERE project.visibility = 'public'`, hash: researchCheckpointHash, verify: verifyResearchCheckpointSignature },
    { type: "contribution_receipt", query: `SELECT r.id, r.receipt_hash AS hash,
        r.canonical_receipt AS canonical, r.issued_at AS created_at
        FROM contribution_receipts r JOIN contribution_receipt_publications p ON p.receipt_id = r.id
        WHERE p.record_class = 'research' AND p.visibility = 'public'`, hash: contributionReceiptHash },
    { type: "evidence_bundle", query: `SELECT b.id, b.manifest_hash AS hash,
        b.canonical_manifest AS canonical, b.created_at
        FROM artifact_bundles b WHERE EXISTS (
          SELECT 1 FROM contribution_receipts r JOIN contribution_receipt_publications p ON p.receipt_id = r.id
          WHERE r.artifact_bundle_manifest_hash = b.manifest_hash AND p.record_class = 'research' AND p.visibility = 'public'
        ) OR EXISTS (
          SELECT 1 FROM research_nodes n JOIN problem_revisions r ON r.id = n.problem_revision_id
          JOIN projects project ON project.id = r.project_id
          WHERE n.artifact_bundle_manifest_hash = b.manifest_hash AND project.visibility = 'public'
        )`, hash: artifactBundleHash },
  ];
  for (const source of sources) {
    const rows = await database.prepare(`SELECT candidate.* FROM (${source.query}) candidate
      WHERE NOT EXISTS (SELECT 1 FROM anchor_records a WHERE a.record_type = ?
        AND a.record_id = candidate.id AND a.record_hash = candidate.hash)
      ORDER BY candidate.created_at, candidate.id LIMIT 24`).bind(source.type).all();
    for (const row of rows.results ?? []) {
      const record = JSON.parse(row.canonical);
      if (await source.hash(record) !== row.hash || (source.verify && !await source.verify(record))) {
        throw new Error(`Public ${source.type} failed its stored evidence integrity check.`);
      }
      const result = await intake.enqueueAnchorRecord({ recordType: source.type,
        recordId: row.id, recordHash: row.hash, createdAt: row.created_at });
      if (result.created) enqueued++;
    }
  }
  return enqueued;
}
