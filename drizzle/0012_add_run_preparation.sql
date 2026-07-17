-- Workspace transfer is a distinct, retryable phase. A Run cannot be marked
-- running until its v2 workspace has reached the private Container ingress.
ALTER TABLE `runs` ADD COLUMN `preparing_at` text;
--> statement-breakpoint
CREATE INDEX `runs_state_preparing_idx` ON `runs` (`state`,`preparing_at`);
