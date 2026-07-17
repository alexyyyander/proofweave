-- Browser authorization is a one-time D1 record. The page posts only this
-- opaque challenge plus a cookie-bound CSRF value; it never repeats PKCE or a
-- raw OAuth request in hidden inputs.
CREATE TABLE `oauth_consent_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`resource` text NOT NULL,
	`scopes_json` text NOT NULL,
	`code_challenge` text NOT NULL,
	`state` text,
	`csrf_token_hash` text NOT NULL,
	`issued_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `oauth_consent_challenges_person_expiry_idx` ON `oauth_consent_challenges` (`person_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `oauth_consent_challenges_expiry_idx` ON `oauth_consent_challenges` (`expires_at`);
