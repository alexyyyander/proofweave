-- Independent review is keyed to Persons, not just Agents. Assignment identity
-- stays immutable; transitions and final Agent-signed attestations are events.
CREATE TABLE `verification_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_bundle_manifest_hash` text NOT NULL,
	`claim_type` text NOT NULL,
	`attempt_owner_person_id` text NOT NULL,
	`verifier_person_id` text NOT NULL,
	`status` text DEFAULT 'assigned' NOT NULL,
	`assigned_at` text NOT NULL,
	`accepted_at` text,
	`declined_at` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`artifact_bundle_manifest_hash`) REFERENCES `artifact_bundles`(`manifest_hash`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`attempt_owner_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`verifier_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verification_assignments_unique_reviewer_idx` ON `verification_assignments` (`artifact_bundle_manifest_hash`,`claim_type`,`verifier_person_id`);--> statement-breakpoint
CREATE INDEX `verification_assignments_verifier_status_idx` ON `verification_assignments` (`verifier_person_id`,`status`);--> statement-breakpoint
CREATE INDEX `verification_assignments_bundle_claim_idx` ON `verification_assignments` (`artifact_bundle_manifest_hash`,`claim_type`);--> statement-breakpoint
CREATE TRIGGER `verification_assignments_identity_immutable`
BEFORE UPDATE OF `artifact_bundle_manifest_hash`, `claim_type`, `attempt_owner_person_id`, `verifier_person_id` ON `verification_assignments`
BEGIN
	SELECT RAISE(ABORT, 'verification assignment identity is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `verification_assignments_delete_prohibited`
BEFORE DELETE ON `verification_assignments`
BEGIN
	SELECT RAISE(ABORT, 'verification assignments cannot be deleted');
END;--> statement-breakpoint
CREATE TABLE `verification_assignment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`event_type` text NOT NULL,
	`status` text NOT NULL,
	`payload_hash` text NOT NULL,
	`canonical_payload` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `verification_assignments`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verification_assignment_events_sequence_idx` ON `verification_assignment_events` (`assignment_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `verification_assignment_events_payload_idx` ON `verification_assignment_events` (`payload_hash`);--> statement-breakpoint
CREATE INDEX `verification_assignment_events_occurred_idx` ON `verification_assignment_events` (`assignment_id`,`occurred_at`);--> statement-breakpoint
CREATE TRIGGER `verification_assignment_events_immutable_update`
BEFORE UPDATE ON `verification_assignment_events`
BEGIN
	SELECT RAISE(ABORT, 'verification assignment events are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `verification_assignment_events_immutable_delete`
BEFORE DELETE ON `verification_assignment_events`
BEGIN
	SELECT RAISE(ABORT, 'verification assignment events cannot be deleted');
END;--> statement-breakpoint
CREATE TABLE `verification_attestations` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`artifact_bundle_manifest_hash` text NOT NULL,
	`claim_type` text NOT NULL,
	`verifier_person_id` text NOT NULL,
	`verifier_agent_id` text NOT NULL,
	`delegation_certificate_id` text NOT NULL,
	`verifier_agent_public_key` text NOT NULL,
	`decision` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`canonical_payload` text NOT NULL,
	`payload_hash` text NOT NULL,
	`signature` text NOT NULL,
	`attested_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `verification_assignments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`artifact_bundle_manifest_hash`) REFERENCES `artifact_bundles`(`manifest_hash`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`verifier_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`verifier_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`delegation_certificate_id`) REFERENCES `delegation_certificates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`evidence_hash`) REFERENCES `artifact_objects`(`content_hash`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verification_attestations_assignment_idx` ON `verification_attestations` (`assignment_id`);--> statement-breakpoint
CREATE INDEX `verification_attestations_bundle_claim_idx` ON `verification_attestations` (`artifact_bundle_manifest_hash`,`claim_type`);--> statement-breakpoint
CREATE INDEX `verification_attestations_verifier_idx` ON `verification_attestations` (`verifier_person_id`,`attested_at`);--> statement-breakpoint
CREATE TRIGGER `verification_attestations_immutable_update`
BEFORE UPDATE ON `verification_attestations`
BEGIN
	SELECT RAISE(ABORT, 'verification attestations are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `verification_attestations_immutable_delete`
BEFORE DELETE ON `verification_attestations`
BEGIN
	SELECT RAISE(ABORT, 'verification attestations cannot be deleted');
END;
