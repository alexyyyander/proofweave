-- Operator-provisioned keys authenticate the isolated runner result channel.
CREATE TABLE `runner_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runner_keys_public_key_idx` ON `runner_keys` (`public_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `runner_keys_fingerprint_idx` ON `runner_keys` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `runner_keys_active_idx` ON `runner_keys` (`status`,`revoked_at`);
