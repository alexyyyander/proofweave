-- A registered public key is not yet evidence that the current Person holds
-- its private half. These immutable rows record one-time, short-lived signed
-- challenges before that key can issue a delegation in the closed alpha.
CREATE TABLE `person_key_proof_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`person_key_id` text NOT NULL,
	`nonce` text NOT NULL,
	`issued_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`canonical_payload` text NOT NULL,
	`payload_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`person_key_id`) REFERENCES `person_keys`(`id`) ON UPDATE no action ON DELETE restrict,
	CHECK (`expires_at` > `issued_at`)
);
--> statement-breakpoint
CREATE INDEX `person_key_proof_challenges_person_key_expiry_idx` ON `person_key_proof_challenges` (`person_id`,`person_key_id`,`expires_at`);--> statement-breakpoint
CREATE TRIGGER `person_key_proof_challenges_immutable_update`
BEFORE UPDATE ON `person_key_proof_challenges`
BEGIN
	SELECT RAISE(ABORT, 'person key proof challenges are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `person_key_proof_challenges_immutable_delete`
BEFORE DELETE ON `person_key_proof_challenges`
BEGIN
	SELECT RAISE(ABORT, 'person key proof challenges cannot be deleted');
END;--> statement-breakpoint
CREATE TABLE `person_key_proof_events` (
	`id` text PRIMARY KEY NOT NULL,
	`challenge_id` text NOT NULL,
	`person_id` text NOT NULL,
	`person_key_id` text NOT NULL,
	`protocol_version` text NOT NULL,
	`canonical_payload` text NOT NULL,
	`payload_hash` text NOT NULL,
	`person_signature` text NOT NULL,
	`verified_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`challenge_id`) REFERENCES `person_key_proof_challenges`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`person_key_id`) REFERENCES `person_keys`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `person_key_proof_events_challenge_idx` ON `person_key_proof_events` (`challenge_id`);--> statement-breakpoint
CREATE INDEX `person_key_proof_events_key_verified_idx` ON `person_key_proof_events` (`person_key_id`,`verified_at`);--> statement-breakpoint
CREATE TRIGGER `person_key_proof_events_match_challenge`
BEFORE INSERT ON `person_key_proof_events`
WHEN NOT EXISTS (
	SELECT 1 FROM `person_key_proof_challenges`
	WHERE `id` = NEW.`challenge_id`
	  AND `person_id` = NEW.`person_id`
	  AND `person_key_id` = NEW.`person_key_id`
)
BEGIN
	SELECT RAISE(ABORT, 'person key proof event does not match its challenge');
END;--> statement-breakpoint
CREATE TRIGGER `person_key_proof_events_immutable_update`
BEFORE UPDATE ON `person_key_proof_events`
BEGIN
	SELECT RAISE(ABORT, 'person key proof events are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `person_key_proof_events_immutable_delete`
BEFORE DELETE ON `person_key_proof_events`
BEGIN
	SELECT RAISE(ABORT, 'person key proof events cannot be deleted');
END;
