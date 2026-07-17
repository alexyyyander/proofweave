-- R2 is the byte store; D1 is the immutable index used to prove exactly which
-- content-addressed objects and signed manifest belong to an Attempt.
CREATE TABLE `artifact_objects` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`byte_length` integer NOT NULL,
	`content_type` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_objects_key_idx` ON `artifact_objects` (`object_key`);--> statement-breakpoint
CREATE TRIGGER `artifact_objects_immutable_update`
BEFORE UPDATE ON `artifact_objects`
BEGIN
	SELECT RAISE(ABORT, 'artifact objects are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `artifact_objects_immutable_delete`
BEFORE DELETE ON `artifact_objects`
BEGIN
	SELECT RAISE(ABORT, 'artifact objects cannot be deleted');
END;--> statement-breakpoint
CREATE TABLE `artifact_bundles` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`problem_revision_id` text NOT NULL,
	`manifest_hash` text NOT NULL,
	`manifest_key` text NOT NULL,
	`canonical_manifest` text NOT NULL,
	`agent_event_id` text NOT NULL,
	`agent_event_payload_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `agent_attempts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`problem_revision_id`) REFERENCES `problem_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`manifest_hash`) REFERENCES `artifact_objects`(`content_hash`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_bundles_manifest_hash_idx` ON `artifact_bundles` (`manifest_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_bundles_manifest_key_idx` ON `artifact_bundles` (`manifest_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_bundles_agent_event_idx` ON `artifact_bundles` (`agent_event_id`);--> statement-breakpoint
CREATE INDEX `artifact_bundles_attempt_created_idx` ON `artifact_bundles` (`attempt_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `artifact_bundles_revision_created_idx` ON `artifact_bundles` (`problem_revision_id`,`created_at`);--> statement-breakpoint
CREATE TRIGGER `artifact_bundles_immutable_update`
BEFORE UPDATE ON `artifact_bundles`
BEGIN
	SELECT RAISE(ABORT, 'artifact bundles are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `artifact_bundles_immutable_delete`
BEFORE DELETE ON `artifact_bundles`
BEGIN
	SELECT RAISE(ABORT, 'artifact bundles cannot be deleted');
END;
