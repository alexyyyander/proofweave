-- A Person key is never silently overwritten or deleted. A later, immutable
-- revocation prevents new delegations and ends any authority signed by that
-- key at the recorded server time while preserving historical evidence.
CREATE TABLE `person_key_revocations` (
	`id` text PRIMARY KEY NOT NULL,
	`person_key_id` text NOT NULL,
	`owner_person_id` text NOT NULL,
	`revoked_at` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`person_key_id`) REFERENCES `person_keys`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `person_key_revocations_key_idx` ON `person_key_revocations` (`person_key_id`);--> statement-breakpoint
CREATE INDEX `person_key_revocations_owner_idx` ON `person_key_revocations` (`owner_person_id`,`revoked_at`);--> statement-breakpoint
CREATE TRIGGER `person_key_revocations_immutable_update`
BEFORE UPDATE ON `person_key_revocations`
BEGIN
	SELECT RAISE(ABORT, 'person key revocations are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `person_key_revocations_immutable_delete`
BEFORE DELETE ON `person_key_revocations`
BEGIN
	SELECT RAISE(ABORT, 'person key revocations cannot be deleted');
END;
