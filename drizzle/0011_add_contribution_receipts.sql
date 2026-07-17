-- A receipt is immutable signed evidence. Claim/dependency detail lives inside
-- canonical_receipt so external verification reproduces one exact payload.
CREATE TABLE `contribution_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`beneficiary_person_id` text NOT NULL,
	`beneficiary_agent_id` text NOT NULL,
	`beneficiary_delegation_certificate_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`problem_revision_id` text NOT NULL,
	`artifact_bundle_manifest_hash` text NOT NULL,
	`run_id` text NOT NULL,
	`receipt_hash` text NOT NULL,
	`canonical_receipt` text NOT NULL,
	`payload_hash` text NOT NULL,
	`issuer_key_id` text NOT NULL,
	`issuer_public_key` text NOT NULL,
	`issuer_signature` text NOT NULL,
	`issued_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`beneficiary_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`beneficiary_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`beneficiary_delegation_certificate_id`) REFERENCES `delegation_certificates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`attempt_id`) REFERENCES `agent_attempts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`problem_revision_id`) REFERENCES `problem_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`artifact_bundle_manifest_hash`) REFERENCES `artifact_bundles`(`manifest_hash`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contribution_receipts_hash_idx` ON `contribution_receipts` (`receipt_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `contribution_receipts_evidence_beneficiary_idx` ON `contribution_receipts` (`artifact_bundle_manifest_hash`,`kind`,`beneficiary_person_id`,`beneficiary_agent_id`,`beneficiary_delegation_certificate_id`);--> statement-breakpoint
CREATE INDEX `contribution_receipts_person_issued_idx` ON `contribution_receipts` (`beneficiary_person_id`,`issued_at`);--> statement-breakpoint
CREATE INDEX `contribution_receipts_attempt_idx` ON `contribution_receipts` (`attempt_id`);--> statement-breakpoint
CREATE TRIGGER `contribution_receipts_immutable_update`
BEFORE UPDATE ON `contribution_receipts`
BEGIN
	SELECT RAISE(ABORT, 'contribution receipts are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `contribution_receipts_immutable_delete`
BEFORE DELETE ON `contribution_receipts`
BEGIN
	SELECT RAISE(ABORT, 'contribution receipts cannot be deleted');
END;
