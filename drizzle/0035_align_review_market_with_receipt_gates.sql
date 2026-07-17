-- The original public review market omitted two claims required by the
-- Contribution Receipt policy. Rebuild only the immutable job parent table
-- with the complete verification claim domain; existing jobs keep their ids,
-- policy version, events, and claims.
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `verification_market_jobs_immutable_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `verification_market_jobs_immutable_delete`;
--> statement-breakpoint
CREATE TABLE `verification_market_jobs_next` (
	`id` text PRIMARY KEY NOT NULL,
	`problem_revision_id` text NOT NULL,
	`pool_id` text NOT NULL,
	`artifact_bundle_manifest_hash` text NOT NULL,
	`claim_type` text NOT NULL CHECK (`claim_type` IN ('bundle_reproducible','kernel_accepted','statement_faithful','novelty_reviewed','project_accepted')),
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
INSERT INTO `verification_market_jobs_next` (
	`id`, `problem_revision_id`, `pool_id`, `artifact_bundle_manifest_hash`,
	`claim_type`, `attempt_owner_person_id`, `reward_weight`, `policy_version`,
	`published_at`, `created_at`
)
SELECT
	`id`, `problem_revision_id`, `pool_id`, `artifact_bundle_manifest_hash`,
	`claim_type`, `attempt_owner_person_id`, `reward_weight`, `policy_version`,
	`published_at`, `created_at`
FROM `verification_market_jobs`;
--> statement-breakpoint
DROP TABLE `verification_market_jobs`;
--> statement-breakpoint
ALTER TABLE `verification_market_jobs_next` RENAME TO `verification_market_jobs`;
--> statement-breakpoint
CREATE UNIQUE INDEX `verification_market_jobs_bundle_claim_idx` ON `verification_market_jobs` (`artifact_bundle_manifest_hash`,`claim_type`);
--> statement-breakpoint
CREATE INDEX `verification_market_jobs_problem_published_idx` ON `verification_market_jobs` (`problem_revision_id`,`published_at`);
--> statement-breakpoint
CREATE INDEX `verification_market_jobs_pool_published_idx` ON `verification_market_jobs` (`pool_id`,`published_at`);
--> statement-breakpoint
CREATE TRIGGER `verification_market_jobs_immutable_update` BEFORE UPDATE ON `verification_market_jobs` BEGIN SELECT RAISE(ABORT, 'verification market jobs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `verification_market_jobs_immutable_delete` BEFORE DELETE ON `verification_market_jobs` BEGIN SELECT RAISE(ABORT, 'verification market jobs cannot be deleted'); END;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
