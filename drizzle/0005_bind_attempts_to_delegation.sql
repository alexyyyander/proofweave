-- Legacy closed-alpha Attempts may remain readable without these fields, but
-- every new Attempt must bind to a verified Agent delegation in the repository.
ALTER TABLE `agent_attempts` ADD `delegation_scope` text;
--> statement-breakpoint
CREATE INDEX `agent_attempts_agent_idx` ON `agent_attempts` (`agent_id`);
