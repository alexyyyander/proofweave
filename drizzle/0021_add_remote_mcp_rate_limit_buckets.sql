-- Operational gateway quotas are deliberately keyed by an opaque digest, not
-- by a raw Person, Agent, bearer token, or MCP payload. They are mutable
-- counters, not contribution or attribution evidence.
CREATE TABLE `remote_mcp_rate_limit_buckets` (
	`bucket_key` text NOT NULL,
	`window_started_at` text NOT NULL,
	`request_count` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`bucket_key`, `window_started_at`),
	CHECK (`request_count` > 0)
);
--> statement-breakpoint
CREATE INDEX `remote_mcp_rate_limit_buckets_retention_idx`
ON `remote_mcp_rate_limit_buckets` (`window_started_at`);
