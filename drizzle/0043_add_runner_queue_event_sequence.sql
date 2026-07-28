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
--> statement-breakpoint
-- Existing rows predate durable sequencing and remain readable as immutable
-- legacy evidence. After this migration, however, every new writer must supply
-- a sequence. This makes an old application revision fail closed during a
-- cutover instead of silently appending a NULL event that a new reader could
-- place before already-sequenced lifecycle evidence.
CREATE TRIGGER `runner_queue_events_sequence_required`
BEFORE INSERT ON `runner_queue_events`
WHEN NEW.`event_sequence` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'runner queue event sequence is required');
END;
