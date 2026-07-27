-- Preserve append-only queue history while giving every newly appended event a
-- per-Run lifecycle position. Existing rows remain NULL and are read in their
-- original SQLite insertion order; new writers start after the full legacy
-- event count so rolling upgrades do not rewrite or interleave old evidence.
ALTER TABLE `runner_queue_events`
ADD COLUMN `event_sequence` integer
CHECK (`event_sequence` IS NULL OR `event_sequence` > 0);
--> statement-breakpoint
CREATE UNIQUE INDEX `runner_queue_events_run_sequence_idx`
ON `runner_queue_events` (`run_id`, `event_sequence`)
WHERE `event_sequence` IS NOT NULL;
