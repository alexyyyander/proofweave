-- Person signing keys and delegated Agents are the durable attribution layer.
-- Certificates stay immutable; revocation is an append-only event table.
CREATE TABLE `person_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`algorithm` text DEFAULT 'ed25519' NOT NULL,
	`public_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `person_keys_public_key_idx` ON `person_keys` (`public_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `person_keys_fingerprint_idx` ON `person_keys` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `person_keys_person_active_idx` ON `person_keys` (`person_id`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_person_id` text NOT NULL,
	`label` text NOT NULL,
	`public_key` text NOT NULL,
	`key_fingerprint` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`owner_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_public_key_idx` ON `agents` (`public_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `agents_key_fingerprint_idx` ON `agents` (`key_fingerprint`);--> statement-breakpoint
CREATE INDEX `agents_owner_status_idx` ON `agents` (`owner_person_id`,`status`);--> statement-breakpoint
CREATE TABLE `delegation_certificates` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_person_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`person_key_id` text NOT NULL,
	`agent_public_key` text NOT NULL,
	`scopes_json` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_until` text NOT NULL,
	`beneficiary_person_id` text NOT NULL,
	`attribution_mode` text DEFAULT 'agent_delegated' NOT NULL,
	`protocol_version` text NOT NULL,
	`payload_hash` text NOT NULL,
	`canonical_payload` text NOT NULL,
	`person_signature` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`owner_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`person_key_id`) REFERENCES `person_keys`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`beneficiary_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delegation_certificates_payload_hash_idx` ON `delegation_certificates` (`payload_hash`);--> statement-breakpoint
CREATE INDEX `delegation_certificates_owner_validity_idx` ON `delegation_certificates` (`owner_person_id`,`valid_until`);--> statement-breakpoint
CREATE INDEX `delegation_certificates_agent_validity_idx` ON `delegation_certificates` (`agent_id`,`valid_until`);--> statement-breakpoint
CREATE TRIGGER `delegation_certificates_immutable_update`
BEFORE UPDATE ON `delegation_certificates`
BEGIN
	SELECT RAISE(ABORT, 'delegation certificates are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `delegation_certificates_immutable_delete`
BEFORE DELETE ON `delegation_certificates`
BEGIN
	SELECT RAISE(ABORT, 'delegation certificates cannot be deleted');
END;--> statement-breakpoint
CREATE TABLE `delegation_revocations` (
	`id` text PRIMARY KEY NOT NULL,
	`delegation_certificate_id` text NOT NULL,
	`owner_person_id` text NOT NULL,
	`revoked_at` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`delegation_certificate_id`) REFERENCES `delegation_certificates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delegation_revocations_certificate_idx` ON `delegation_revocations` (`delegation_certificate_id`);--> statement-breakpoint
CREATE INDEX `delegation_revocations_owner_idx` ON `delegation_revocations` (`owner_person_id`,`revoked_at`);--> statement-breakpoint
CREATE TRIGGER `delegation_revocations_immutable_update`
BEFORE UPDATE ON `delegation_revocations`
BEGIN
	SELECT RAISE(ABORT, 'delegation revocations are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `delegation_revocations_immutable_delete`
BEFORE DELETE ON `delegation_revocations`
BEGIN
	SELECT RAISE(ABORT, 'delegation revocations cannot be deleted');
END;--> statement-breakpoint
CREATE TRIGGER `agents_owner_immutable`
BEFORE UPDATE OF `owner_person_id` ON `agents`
BEGIN
	SELECT RAISE(ABORT, 'agent owner cannot be changed');
END;--> statement-breakpoint
ALTER TABLE `agent_attempts` ADD `agent_id` text REFERENCES `agents`(`id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `agent_attempts` ADD `delegation_certificate_id` text REFERENCES `delegation_certificates`(`id`) ON DELETE restrict;--> statement-breakpoint
CREATE INDEX `agent_attempts_delegation_idx` ON `agent_attempts` (`delegation_certificate_id`);
