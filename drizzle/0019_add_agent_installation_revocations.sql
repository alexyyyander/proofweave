-- The resource server reads installation.status for immediate denial. This
-- immutable owner record makes that revocation inspectable and idempotent.
CREATE TABLE `agent_installation_revocations` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_installation_id` text NOT NULL,
	`owner_person_id` text NOT NULL,
	`revoked_at` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`agent_installation_id`) REFERENCES `agent_installations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_installation_revocations_installation_idx` ON `agent_installation_revocations` (`agent_installation_id`);--> statement-breakpoint
CREATE INDEX `agent_installation_revocations_owner_idx` ON `agent_installation_revocations` (`owner_person_id`,`revoked_at`);
