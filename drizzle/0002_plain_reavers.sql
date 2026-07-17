CREATE TABLE `agent_attempt_events` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`event_type` text NOT NULL,
	`message` text NOT NULL,
	`progress_percent` integer,
	`idempotency_key` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `agent_attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_attempt_events_sequence_idx` ON `agent_attempt_events` (`attempt_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_attempt_events_idempotency_idx` ON `agent_attempt_events` (`attempt_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `agent_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`problem_revision_id` text NOT NULL,
	`agent_label` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`idempotency_key` text NOT NULL,
	`last_progress_percent` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`problem_revision_id`) REFERENCES `problem_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_attempts_person_idempotency_idx` ON `agent_attempts` (`person_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `agent_attempts_person_updated_idx` ON `agent_attempts` (`person_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `agent_attempts_revision_idx` ON `agent_attempts` (`problem_revision_id`);--> statement-breakpoint
CREATE TABLE `mcp_access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_access_tokens_hash_idx` ON `mcp_access_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `mcp_access_tokens_person_idx` ON `mcp_access_tokens` (`person_id`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `persons` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_provider` text NOT NULL,
	`provider_subject` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `persons_provider_subject_idx` ON `persons` (`identity_provider`,`provider_subject`);