-- Anchor tables: append-only anchoring of canonical record hashes (spec 2026-10-14).
CREATE TABLE IF NOT EXISTS `anchor_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'built' NOT NULL,
	`root` text NOT NULL,
	`leaf_count` integer NOT NULL,
	`manifest_hash` text NOT NULL,
	`manifest_key` text NOT NULL,
	`prev_batch_id` text,
	`prev_root` text,
	`chain` text NOT NULL,
	`network` text NOT NULL,
	`witness_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`anchored_at` text
);
--> statement-breakpoint
-- Partial unique index: abandoned (failed) batches can be rebuilt from the same leaf set without conflict.
CREATE UNIQUE INDEX IF NOT EXISTS `anchor_batches_root_idx` ON `anchor_batches` (`root`) WHERE `status` != 'failed';
--> statement-breakpoint
-- Append-only head log: version is the CAS token; inserting prevVersion+1 with a PK conflict atomically aborts a concurrent batch build.
CREATE TABLE IF NOT EXISTS `anchor_log_head` (
	`version` integer PRIMARY KEY NOT NULL,
	`head_batch_id` text,
	`head_root` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `anchor_log_head` (`version`, `head_batch_id`, `head_root`, `updated_at`)
VALUES (0, NULL, NULL, '1970-01-01T00:00:00.000Z');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `anchor_records` (
	`id` text PRIMARY KEY NOT NULL,
	`record_type` text NOT NULL,
	`record_id` text NOT NULL,
	`record_hash` text NOT NULL,
	`leaf_hash` text NOT NULL,
	`batch_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `anchor_batches`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `anchor_records_identity_idx` ON `anchor_records` (`record_type`,`record_id`,`record_hash`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `anchor_records_pending_idx` ON `anchor_records` (`batch_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `anchor_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`submitter_kind` text NOT NULL,
	`submitter_id` text NOT NULL,
	`chain` text NOT NULL,
	`network` text NOT NULL,
	`tx_ref` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`confirmations` integer DEFAULT 0 NOT NULL,
	`block_ref` text,
	`submitted_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `anchor_batches`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `anchor_submissions_tx_idx` ON `anchor_submissions` (`chain`,`network`,`tx_ref`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `anchor_submissions_batch_idx` ON `anchor_submissions` (`batch_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `anchor_batch_events` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload_hash` text NOT NULL,
	`canonical_payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `anchor_batches`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `anchor_batch_events_batch_idx` ON `anchor_batch_events` (`batch_id`);
