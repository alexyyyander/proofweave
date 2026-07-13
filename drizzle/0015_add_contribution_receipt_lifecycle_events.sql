-- A receipt is never rewritten. A correction, replacement, or retraction is
-- a separately issuer-signed immutable event addressed to the original.
CREATE TABLE `contribution_receipt_lifecycle_events` (
	`id` text PRIMARY KEY NOT NULL,
	`receipt_id` text NOT NULL,
	`event_type` text NOT NULL,
	`replacement_receipt_id` text,
	`reason_hash` text NOT NULL,
	`occurred_at` text NOT NULL,
	`issuer_key_id` text NOT NULL,
	`issuer_public_key` text NOT NULL,
	`canonical_payload` text NOT NULL,
	`payload_hash` text NOT NULL,
	`issuer_signature` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`receipt_id`) REFERENCES `contribution_receipts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`replacement_receipt_id`) REFERENCES `contribution_receipts`(`id`) ON UPDATE no action ON DELETE restrict,
	CHECK ((`event_type` = 'retracted' AND `replacement_receipt_id` IS NULL) OR (`event_type` IN ('corrected', 'superseded') AND `replacement_receipt_id` IS NOT NULL)),
	CHECK (`replacement_receipt_id` IS NULL OR `replacement_receipt_id` <> `receipt_id`)
);
--> statement-breakpoint
CREATE INDEX `contribution_receipt_lifecycle_events_receipt_idx` ON `contribution_receipt_lifecycle_events` (`receipt_id`,`occurred_at`,`id`);--> statement-breakpoint
CREATE INDEX `contribution_receipt_lifecycle_events_replacement_idx` ON `contribution_receipt_lifecycle_events` (`replacement_receipt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `contribution_receipt_lifecycle_events_one_correction_idx` ON `contribution_receipt_lifecycle_events` (`receipt_id`) WHERE `event_type` = 'corrected';--> statement-breakpoint
CREATE UNIQUE INDEX `contribution_receipt_lifecycle_events_one_supersession_idx` ON `contribution_receipt_lifecycle_events` (`receipt_id`) WHERE `event_type` = 'superseded';--> statement-breakpoint
CREATE UNIQUE INDEX `contribution_receipt_lifecycle_events_one_retraction_idx` ON `contribution_receipt_lifecycle_events` (`receipt_id`) WHERE `event_type` = 'retracted';--> statement-breakpoint
CREATE TRIGGER `contribution_receipt_lifecycle_events_immutable_update`
BEFORE UPDATE ON `contribution_receipt_lifecycle_events`
BEGIN
	SELECT RAISE(ABORT, 'contribution receipt lifecycle events are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `contribution_receipt_lifecycle_events_immutable_delete`
BEFORE DELETE ON `contribution_receipt_lifecycle_events`
BEGIN
	SELECT RAISE(ABORT, 'contribution receipt lifecycle events cannot be deleted');
END;
