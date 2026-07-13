-- A Run is a mutable status projection. Its identity fields and all evidence
-- rows are immutable, so the projection can always be reconstructed.
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`artifact_bundle_hash` text NOT NULL,
	`request_hash` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`queued_at` text NOT NULL,
	`started_at` text,
	`cancel_requested_at` text,
	`finished_at` text,
	`runner_result_hash` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `agent_attempts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_attempt_idempotency_idx` ON `runs` (`attempt_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `runs_state_queued_idx` ON `runs` (`state`,`queued_at`);--> statement-breakpoint
CREATE INDEX `runs_attempt_updated_idx` ON `runs` (`attempt_id`,`updated_at`);--> statement-breakpoint
CREATE TRIGGER `runs_identity_immutable`
BEFORE UPDATE OF `attempt_id`, `artifact_bundle_hash`, `request_hash`, `idempotency_key` ON `runs`
BEGIN
	SELECT RAISE(ABORT, 'run identity is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `runs_delete_prohibited`
BEFORE DELETE ON `runs`
BEGIN
	SELECT RAISE(ABORT, 'runs cannot be deleted');
END;--> statement-breakpoint
CREATE TABLE `run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`event_type` text NOT NULL,
	`state` text NOT NULL,
	`payload_hash` text NOT NULL,
	`canonical_payload` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_events_sequence_idx` ON `run_events` (`run_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `run_events_payload_hash_idx` ON `run_events` (`payload_hash`);--> statement-breakpoint
CREATE INDEX `run_events_run_occurred_idx` ON `run_events` (`run_id`,`occurred_at`);--> statement-breakpoint
CREATE TRIGGER `run_events_immutable_update`
BEFORE UPDATE ON `run_events`
BEGIN
	SELECT RAISE(ABORT, 'run events are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `run_events_immutable_delete`
BEFORE DELETE ON `run_events`
BEGIN
	SELECT RAISE(ABORT, 'run events cannot be deleted');
END;--> statement-breakpoint
CREATE TABLE `run_results` (
	`run_id` text PRIMARY KEY NOT NULL,
	`result_hash` text NOT NULL,
	`canonical_result` text NOT NULL,
	`received_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_results_hash_idx` ON `run_results` (`result_hash`);--> statement-breakpoint
CREATE TRIGGER `run_results_immutable_update`
BEFORE UPDATE ON `run_results`
BEGIN
	SELECT RAISE(ABORT, 'run results are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `run_results_immutable_delete`
BEFORE DELETE ON `run_results`
BEGIN
	SELECT RAISE(ABORT, 'run results cannot be deleted');
END;
