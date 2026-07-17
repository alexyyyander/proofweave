-- A short-lived pairing record connects one local Codex Connector to one
-- browser approval. Only a hash of the browser handoff secret is persisted;
-- no local private key, OAuth token, or workspace content enters this table.
CREATE TABLE `local_codex_pairing_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`browser_secret_hash` text NOT NULL,
	`agent_id` text NOT NULL,
	`agent_label` text NOT NULL,
	`agent_public_key` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`oauth_client_id` text NOT NULL,
	`oauth_state` text NOT NULL,
	`code_challenge` text NOT NULL,
	`requested_scopes_json` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`approved_at` text,
	`person_id` text,
	`delegation_certificate_id` text,
	`agent_installation_id` text,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`delegation_certificate_id`) REFERENCES `delegation_certificates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_installation_id`) REFERENCES `agent_installations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `local_codex_pairing_sessions_expiry_idx` ON `local_codex_pairing_sessions` (`expires_at`);
