-- An OAuth installation is a revocable connection session, not the permanent
-- identity of an Agent. Preserve revoked sessions while allowing a later
-- connection to reuse the same still-valid delegation. At most one such
-- session may be active at a time.
DROP INDEX `agent_installations_agent_client_certificate_idx`;
--> statement-breakpoint
CREATE INDEX `agent_installations_agent_client_certificate_idx` ON `agent_installations` (`agent_id`,`client_id`,`delegation_certificate_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_installations_active_agent_client_certificate_idx` ON `agent_installations` (`agent_id`,`client_id`,`delegation_certificate_id`) WHERE `status` = 'active' AND `revoked_at` IS NULL;
--> statement-breakpoint
ALTER TABLE `agent_attempts` ADD `lifecycle_version` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- An Attempt is a durable research object. Its original certificate remains
-- immutable creation provenance, while later work may be authorized by a
-- renewed certificate for the same Person, Agent, key, and scope.
CREATE TABLE `attempt_authority_events` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`delegation_certificate_id` text NOT NULL,
	`agent_installation_id` text NOT NULL,
	`event_type` text DEFAULT 'authority_renewed' NOT NULL,
	`recorded_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `agent_attempts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`delegation_certificate_id`) REFERENCES `delegation_certificates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_installation_id`) REFERENCES `agent_installations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attempt_authority_events_attempt_delegation_idx` ON `attempt_authority_events` (`attempt_id`,`delegation_certificate_id`);
--> statement-breakpoint
CREATE INDEX `attempt_authority_events_attempt_time_idx` ON `attempt_authority_events` (`attempt_id`,`recorded_at`);
--> statement-breakpoint
ALTER TABLE `artifact_bundles` ADD `delegation_certificate_id` text REFERENCES `delegation_certificates`(`id`) ON DELETE restrict;
--> statement-breakpoint
UPDATE `artifact_bundles`
SET `delegation_certificate_id` = (
	SELECT `attempt`.`delegation_certificate_id`
	FROM `agent_attempts` AS `attempt`
	WHERE `attempt`.`id` = `artifact_bundles`.`attempt_id`
)
WHERE `delegation_certificate_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `artifact_bundles_delegation_idx` ON `artifact_bundles` (`delegation_certificate_id`);
