-- Receipt issuer trust is a separate, operator-managed key registry. Receipts
-- retain the exact signing key forever; rotation changes only which key may
-- sign new receipt or lifecycle evidence.
CREATE TABLE `contribution_receipt_issuer_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`status` text NOT NULL,
	`valid_from` text NOT NULL,
	`retired_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CHECK (`status` IN ('active', 'retired', 'revoked')),
	CHECK (
		(`status` = 'active' AND `retired_at` IS NULL AND `revoked_at` IS NULL)
		OR (`status` = 'retired' AND `retired_at` IS NOT NULL AND `revoked_at` IS NULL)
		OR (`status` = 'revoked' AND `revoked_at` IS NOT NULL)
	)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contribution_receipt_issuer_keys_public_key_idx`
ON `contribution_receipt_issuer_keys` (`public_key`);
--> statement-breakpoint
-- A closed-alpha issuer has one current signing key. Rotation retires the
-- predecessor and activates its successor in one database batch.
CREATE UNIQUE INDEX `contribution_receipt_issuer_keys_one_active_idx`
ON `contribution_receipt_issuer_keys` (`status`) WHERE `status` = 'active';
--> statement-breakpoint
CREATE INDEX `contribution_receipt_issuer_keys_status_valid_from_idx`
ON `contribution_receipt_issuer_keys` (`status`, `valid_from`);
--> statement-breakpoint

-- Key transitions are append-only operator audit evidence. They do not alter
-- an immutable receipt or lifecycle record.
CREATE TABLE `contribution_receipt_issuer_key_events` (
	`id` text PRIMARY KEY NOT NULL,
	`key_id` text NOT NULL,
	`event_type` text NOT NULL,
	`related_key_id` text,
	`occurred_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`key_id`) REFERENCES `contribution_receipt_issuer_keys`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`related_key_id`) REFERENCES `contribution_receipt_issuer_keys`(`id`) ON UPDATE no action ON DELETE restrict,
	CHECK (`event_type` IN ('activated', 'retired', 'revoked')),
	CHECK ((`event_type` = 'activated') OR (`related_key_id` IS NULL OR `related_key_id` <> `key_id`))
);
--> statement-breakpoint
CREATE INDEX `contribution_receipt_issuer_key_events_key_idx`
ON `contribution_receipt_issuer_key_events` (`key_id`, `occurred_at`, `id`);
--> statement-breakpoint
CREATE TRIGGER `contribution_receipt_issuer_key_events_immutable_update`
BEFORE UPDATE ON `contribution_receipt_issuer_key_events`
BEGIN
	SELECT RAISE(ABORT, 'contribution receipt issuer key events are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `contribution_receipt_issuer_key_events_immutable_delete`
BEFORE DELETE ON `contribution_receipt_issuer_key_events`
BEGIN
	SELECT RAISE(ABORT, 'contribution receipt issuer key events cannot be deleted');
END;
