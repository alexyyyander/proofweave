-- Provider-neutral durable delivery for the trusted Lean Runner. The signed
-- queue envelope is immutable; only its delivery projection may change.
CREATE TABLE `runner_queue_messages` (
	`run_id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`canonical_message` text NOT NULL,
	`delivery_state` text DEFAULT 'queued' NOT NULL,
	`available_at` text NOT NULL,
	`lease_id` text,
	`lease_consumer_id` text,
	`lease_claimed_at` text,
	`lease_expires_at` text,
	`delivery_attempts` integer DEFAULT 0 NOT NULL,
	`last_error_code` text,
	`enqueued_at` text NOT NULL,
	`acknowledged_at` text,
	`cancelled_at` text,
	`dead_lettered_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CHECK (`delivery_state` IN ('queued', 'leased', 'acknowledged', 'cancelled', 'dead_letter')),
	CHECK (`delivery_attempts` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runner_queue_attempt_idempotency_idx`
ON `runner_queue_messages` (`attempt_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `runner_queue_available_idx`
ON `runner_queue_messages` (`delivery_state`,`available_at`,`enqueued_at`);
--> statement-breakpoint
CREATE INDEX `runner_queue_lease_expiry_idx`
ON `runner_queue_messages` (`delivery_state`,`lease_expires_at`);
--> statement-breakpoint
CREATE TRIGGER `runner_queue_message_identity_immutable`
BEFORE UPDATE OF `run_id`, `attempt_id`, `idempotency_key`, `request_hash`, `canonical_message`, `enqueued_at` ON `runner_queue_messages`
BEGIN
	SELECT RAISE(ABORT, 'runner queue message identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `runner_queue_messages_delete_prohibited`
BEFORE DELETE ON `runner_queue_messages`
BEGIN
	SELECT RAISE(ABORT, 'runner queue messages cannot be deleted');
END;
--> statement-breakpoint
CREATE TABLE `runner_queue_events` (
	`id` text PRIMARY KEY NOT NULL,
	`deduplication_key` text NOT NULL,
	`run_id` text NOT NULL,
	`event_type` text NOT NULL,
	`delivery_state` text NOT NULL,
	`lease_id` text,
	`delivery_attempt` integer NOT NULL,
	`error_code` text,
	`occurred_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runner_queue_messages`(`run_id`) ON UPDATE no action ON DELETE restrict,
	CHECK (`event_type` IN ('enqueued', 'lease_claimed', 'lease_reclaimed', 'lease_renewed', 'acknowledged', 'released', 'cancelled', 'dead_lettered')),
	CHECK (`delivery_state` IN ('queued', 'leased', 'acknowledged', 'cancelled', 'dead_letter')),
	CHECK (`delivery_attempt` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runner_queue_events_deduplication_idx`
ON `runner_queue_events` (`deduplication_key`);
--> statement-breakpoint
CREATE INDEX `runner_queue_events_run_time_idx`
ON `runner_queue_events` (`run_id`,`occurred_at`);
--> statement-breakpoint
CREATE TRIGGER `runner_queue_events_immutable_update`
BEFORE UPDATE ON `runner_queue_events`
BEGIN
	SELECT RAISE(ABORT, 'runner queue events are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `runner_queue_events_immutable_delete`
BEFORE DELETE ON `runner_queue_events`
BEGIN
	SELECT RAISE(ABORT, 'runner queue events cannot be deleted');
END;
