-- Per-environment Runner routing. The signed queue envelope stays immutable;
-- this projection lets a Runner built from one exact Lean + Mathlib pair claim
-- only Runs for that pair. Legacy rows are backfilled when the signed request
-- contains both fields; otherwise they stay NULL and remain claimable by any
-- single-environment Runner, whose preflight still verifies the request.
ALTER TABLE `runner_queue_messages` ADD COLUMN `runner_environment_key` text;
--> statement-breakpoint
UPDATE `runner_queue_messages`
SET `runner_environment_key` = json_array(
	json_extract(`canonical_message`, '$.request.environment.leanToolchain'),
	json_extract(`canonical_message`, '$.request.environment.mathlibRevision')
)
WHERE `runner_environment_key` IS NULL
	AND json_extract(`canonical_message`, '$.request.environment.leanToolchain') IS NOT NULL
	AND json_extract(`canonical_message`, '$.request.environment.mathlibRevision') IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `runner_queue_environment_idx`
ON `runner_queue_messages` (`runner_environment_key`,`delivery_state`,`available_at`,`enqueued_at`);
