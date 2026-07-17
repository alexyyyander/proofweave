-- Runner output is independent infrastructure evidence. Keep its immutable R2
-- index separate from participant Artifact Bundle objects so a result hash can
-- always be replayed without changing an Agent-owned manifest.
CREATE TABLE `runner_output_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`role` text NOT NULL,
	`content_hash` text NOT NULL,
	`object_key` text NOT NULL,
	`byte_length` integer NOT NULL,
	`content_type` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CHECK (`role` IN ('stdout', 'stderr')),
	CHECK (`byte_length` >= 0 AND `byte_length` <= 20000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runner_output_artifacts_run_role_idx` ON `runner_output_artifacts` (`run_id`,`role`);
--> statement-breakpoint
CREATE INDEX `runner_output_artifacts_hash_idx` ON `runner_output_artifacts` (`content_hash`);
--> statement-breakpoint
CREATE TRIGGER `runner_output_artifacts_immutable_update`
BEFORE UPDATE ON `runner_output_artifacts`
BEGIN
	SELECT RAISE(ABORT, 'runner output artifacts are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `runner_output_artifacts_immutable_delete`
BEFORE DELETE ON `runner_output_artifacts`
BEGIN
	SELECT RAISE(ABORT, 'runner output artifacts cannot be deleted');
END;
