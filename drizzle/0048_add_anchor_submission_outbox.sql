-- Persist the exact signed transaction before any network broadcast.
CREATE TABLE anchor_submission_outbox (
  batch_id TEXT PRIMARY KEY NOT NULL REFERENCES anchor_batches(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('prepared', 'legacy_unknown')),
  tx_ref TEXT UNIQUE,
  prepared_json TEXT,
  created_at TEXT NOT NULL,
  CHECK ((state = 'prepared' AND tx_ref IS NOT NULL AND prepared_json IS NOT NULL)
    OR (state = 'legacy_unknown' AND tx_ref IS NULL AND prepared_json IS NULL))
);
--> statement-breakpoint
-- Old built batches may already have broadcast without saving a txRef. Never
-- automatically sign a replacement for these ambiguous pre-upgrade attempts.
INSERT INTO anchor_submission_outbox (batch_id, state, created_at)
SELECT id, 'legacy_unknown', created_at FROM anchor_batches WHERE status = 'built';
