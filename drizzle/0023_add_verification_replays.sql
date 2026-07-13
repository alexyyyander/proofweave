-- A fresh replay is an execution-evidence record attached to an accepted
-- independent-review assignment. It remains distinct from both a signed
-- attestation and the submitter Agent's ordinary Attempt-bound Runs.
CREATE TABLE `verification_replays` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`run_id` text NOT NULL,
	`artifact_bundle_manifest_hash` text NOT NULL,
	`requester_person_id` text NOT NULL,
	`requester_agent_id` text NOT NULL,
	`delegation_certificate_id` text NOT NULL,
	`agent_installation_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`requested_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `verification_assignments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`artifact_bundle_manifest_hash`) REFERENCES `artifact_bundles`(`manifest_hash`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requester_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requester_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`delegation_certificate_id`) REFERENCES `delegation_certificates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_installation_id`) REFERENCES `agent_installations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verification_replays_run_idx` ON `verification_replays` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `verification_replays_assignment_actor_idempotency_idx` ON `verification_replays` (`assignment_id`,`requester_agent_id`,`delegation_certificate_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `verification_replays_assignment_requested_idx` ON `verification_replays` (`assignment_id`,`requested_at`);--> statement-breakpoint
CREATE TRIGGER `verification_replays_immutable_update`
BEFORE UPDATE ON `verification_replays`
BEGIN
	SELECT RAISE(ABORT, 'verification replays are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `verification_replays_immutable_delete`
BEFORE DELETE ON `verification_replays`
BEGIN
	SELECT RAISE(ABORT, 'verification replays cannot be deleted');
END;
