-- Provider identities are separate from the Person attribution root. This
-- lets one Person sign in through more than one verified provider without
-- splitting their contribution record. IF NOT EXISTS and INSERT OR IGNORE
-- preserve a Sites database that received this schema before the migration
-- was renumbered to follow the provider-neutral Runner queue.
CREATE TABLE IF NOT EXISTS `person_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_subject` text NOT NULL,
	`email` text,
	`email_normalized` text,
	`display_name` text NOT NULL,
	`email_verified_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `person_identities_provider_subject_idx` ON `person_identities` (`provider`,`provider_subject`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `person_identities_person_idx` ON `person_identities` (`person_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `person_identities_verified_email_idx` ON `person_identities` (`email_normalized`,`email_verified_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO `person_identities` (
	`id`, `person_id`, `provider`, `provider_subject`, `email`,
	`email_normalized`, `display_name`, `email_verified_at`, `created_at`, `updated_at`
)
SELECT
	'identity:' || lower(hex(randomblob(16))),
	`id`,
	`identity_provider`,
	`provider_subject`,
	CASE WHEN `identity_provider` = 'chatgpt' THEN lower(trim(`provider_subject`)) ELSE NULL END,
	CASE WHEN `identity_provider` = 'chatgpt' THEN lower(trim(`provider_subject`)) ELSE NULL END,
	`display_name`,
	CASE WHEN `identity_provider` = 'chatgpt' THEN `created_at` ELSE NULL END,
	`created_at`,
	`updated_at`
FROM `persons`;
--> statement-breakpoint
-- Browser sessions contain only a hash of the opaque cookie value. Google
-- access and ID tokens are verified during callback and are never persisted.
CREATE TABLE IF NOT EXISTS `app_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`identity_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`identity_id`) REFERENCES `person_identities`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `app_sessions_token_hash_idx` ON `app_sessions` (`token_hash`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `app_sessions_person_active_idx` ON `app_sessions` (`person_id`,`revoked_at`,`expires_at`);
