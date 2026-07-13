-- OAuth identity data is a separate credential boundary. Only hashes of
-- short-lived authorization artifacts are persisted.
CREATE TABLE `agent_installations` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`delegation_certificate_id` text NOT NULL,
	`client_id` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`delegation_certificate_id`) REFERENCES `delegation_certificates`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_installations_agent_client_certificate_idx` ON `agent_installations` (`agent_id`,`client_id`,`delegation_certificate_id`);--> statement-breakpoint
CREATE INDEX `agent_installations_person_client_idx` ON `agent_installations` (`person_id`,`client_id`);--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`client_name` text NOT NULL,
	`redirect_uris_json` text NOT NULL,
	`token_endpoint_auth_method` text DEFAULT 'none' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE INDEX `oauth_clients_active_idx` ON `oauth_clients` (`revoked_at`);--> statement-breakpoint
CREATE TABLE `oauth_authorization_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`resource` text NOT NULL,
	`person_id` text NOT NULL,
	`agent_installation_id` text NOT NULL,
	`scopes_json` text NOT NULL,
	`code_challenge` text NOT NULL,
	`issued_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_installation_id`) REFERENCES `agent_installations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `oauth_authorization_codes_expiry_idx` ON `oauth_authorization_codes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `oauth_access_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`resource` text NOT NULL,
	`person_id` text NOT NULL,
	`agent_installation_id` text NOT NULL,
	`scopes_json` text NOT NULL,
	`issued_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_installation_id`) REFERENCES `agent_installations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_expiry_idx` ON `oauth_access_tokens` (`expires_at`);--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_installation_idx` ON `oauth_access_tokens` (`agent_installation_id`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `oauth_refresh_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`resource` text NOT NULL,
	`person_id` text NOT NULL,
	`agent_installation_id` text NOT NULL,
	`scopes_json` text NOT NULL,
	`issued_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`revoked_at` text,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_installation_id`) REFERENCES `agent_installations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `oauth_refresh_tokens_expiry_idx` ON `oauth_refresh_tokens` (`expires_at`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_tokens_installation_idx` ON `oauth_refresh_tokens` (`agent_installation_id`,`revoked_at`);
