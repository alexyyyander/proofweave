-- A staged, signed Artifact Bundle earns an immediate evidence record for the
-- delegated Person. It is intentionally narrower than a Contribution Receipt:
-- this table cannot represent kernel acceptance, review, novelty, or final
-- authorship.
CREATE TABLE `provisional_contributions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL CHECK (`kind` = 'evidence_bundle'),
	`state` text NOT NULL CHECK (`state` = 'bundle_staged'),
	`beneficiary_person_id` text NOT NULL,
	`beneficiary_agent_id` text NOT NULL,
	`beneficiary_delegation_certificate_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`problem_revision_id` text NOT NULL,
	`artifact_bundle_manifest_hash` text NOT NULL,
	`agent_event_id` text NOT NULL,
	`agent_event_occurred_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`beneficiary_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`beneficiary_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`beneficiary_delegation_certificate_id`) REFERENCES `delegation_certificates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`attempt_id`) REFERENCES `agent_attempts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`problem_revision_id`) REFERENCES `problem_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`artifact_bundle_manifest_hash`) REFERENCES `artifact_bundles`(`manifest_hash`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provisional_contributions_manifest_hash_idx` ON `provisional_contributions` (`artifact_bundle_manifest_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `provisional_contributions_agent_event_idx` ON `provisional_contributions` (`agent_event_id`);--> statement-breakpoint
CREATE INDEX `provisional_contributions_person_recorded_idx` ON `provisional_contributions` (`beneficiary_person_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `provisional_contributions_attempt_idx` ON `provisional_contributions` (`attempt_id`);--> statement-breakpoint
CREATE TRIGGER `provisional_contributions_immutable_update`
BEFORE UPDATE ON `provisional_contributions`
BEGIN
	SELECT RAISE(ABORT, 'provisional contributions are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `provisional_contributions_immutable_delete`
BEFORE DELETE ON `provisional_contributions`
BEGIN
	SELECT RAISE(ABORT, 'provisional contributions cannot be deleted');
END;
