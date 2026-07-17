-- Verification Market jobs expose only claim-specific review work over a
-- staged immutable Bundle. A weight is a later settlement share, not a balance
-- reservation. Jobs and claims remain append-only.
CREATE TABLE `verification_market_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`problem_revision_id` text NOT NULL,
	`pool_id` text NOT NULL,
	`artifact_bundle_manifest_hash` text NOT NULL,
	`claim_type` text NOT NULL CHECK (`claim_type` IN ('bundle_reproducible','statement_faithful','novelty_reviewed')),
	`attempt_owner_person_id` text NOT NULL,
	`reward_weight` integer NOT NULL CHECK (`reward_weight` BETWEEN 1 AND 100),
	`policy_version` text NOT NULL CHECK (`policy_version` = 'pw-verification-market-v1'),
	`published_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`problem_revision_id`) REFERENCES `problem_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`pool_id`) REFERENCES `problem_credit_pools`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`artifact_bundle_manifest_hash`) REFERENCES `artifact_bundles`(`manifest_hash`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`attempt_owner_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verification_market_jobs_bundle_claim_idx` ON `verification_market_jobs` (`artifact_bundle_manifest_hash`,`claim_type`);
--> statement-breakpoint
CREATE INDEX `verification_market_jobs_problem_published_idx` ON `verification_market_jobs` (`problem_revision_id`,`published_at`);
--> statement-breakpoint
CREATE INDEX `verification_market_jobs_pool_published_idx` ON `verification_market_jobs` (`pool_id`,`published_at`);
--> statement-breakpoint
CREATE TABLE `verification_market_job_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL UNIQUE,
	`assignment_id` text NOT NULL UNIQUE,
	`verifier_person_id` text NOT NULL,
	`claimed_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `verification_market_jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assignment_id`) REFERENCES `verification_assignments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`verifier_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `verification_market_job_claims_person_time_idx` ON `verification_market_job_claims` (`verifier_person_id`,`claimed_at`);
--> statement-breakpoint
CREATE TABLE `verification_market_job_events` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`sequence` integer NOT NULL CHECK (`sequence` > 0),
	`event_type` text NOT NULL CHECK (`event_type` IN ('published','claimed','withdrawn')),
	`payload_hash` text NOT NULL UNIQUE CHECK (`payload_hash` GLOB 'sha256:[0-9a-f]*' AND length(`payload_hash`) = 71),
	`canonical_payload` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `verification_market_jobs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verification_market_job_events_sequence_idx` ON `verification_market_job_events` (`job_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `verification_market_job_events_occurred_idx` ON `verification_market_job_events` (`job_id`,`occurred_at`);
--> statement-breakpoint
CREATE TRIGGER `verification_market_jobs_immutable_update` BEFORE UPDATE ON `verification_market_jobs` BEGIN SELECT RAISE(ABORT, 'verification market jobs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `verification_market_jobs_immutable_delete` BEFORE DELETE ON `verification_market_jobs` BEGIN SELECT RAISE(ABORT, 'verification market jobs cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `verification_market_job_claims_immutable_update` BEFORE UPDATE ON `verification_market_job_claims` BEGIN SELECT RAISE(ABORT, 'verification market job claims are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `verification_market_job_claims_immutable_delete` BEFORE DELETE ON `verification_market_job_claims` BEGIN SELECT RAISE(ABORT, 'verification market job claims cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `verification_market_job_events_immutable_update` BEFORE UPDATE ON `verification_market_job_events` BEGIN SELECT RAISE(ABORT, 'verification market job events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `verification_market_job_events_immutable_delete` BEFORE DELETE ON `verification_market_job_events` BEGIN SELECT RAISE(ABORT, 'verification market job events cannot be deleted'); END;
