CREATE TABLE `catalog_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`source_snapshot_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`imported_at` text NOT NULL,
	`record_count` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `source_snapshots`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_imports_snapshot_idx` ON `catalog_imports` (`source_snapshot_id`);--> statement-breakpoint
CREATE TABLE `declarations` (
	`id` text PRIMARY KEY NOT NULL,
	`problem_revision_id` text NOT NULL,
	`qualified_name` text NOT NULL,
	`declaration_kind` text DEFAULT 'theorem' NOT NULL,
	`source_path` text NOT NULL,
	`source_url` text NOT NULL,
	`source_line_start` integer NOT NULL,
	`source_line_end` integer NOT NULL,
	`source_content_hash` text NOT NULL,
	`is_primary` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`problem_revision_id`) REFERENCES `problem_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `declarations_revision_name_idx` ON `declarations` (`problem_revision_id`,`qualified_name`);--> statement-breakpoint
CREATE INDEX `declarations_primary_idx` ON `declarations` (`problem_revision_id`,`is_primary`);--> statement-breakpoint
CREATE TABLE `problem_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_snapshot_id` text NOT NULL,
	`target_key` text NOT NULL,
	`slug` text NOT NULL,
	`revision_number` integer NOT NULL,
	`title` text NOT NULL,
	`domain` text NOT NULL,
	`research_status` text NOT NULL,
	`informal_statement` text NOT NULL,
	`lean_statement` text NOT NULL,
	`source_correspondence` text DEFAULT 'imported_unreviewed' NOT NULL,
	`proof_state` text DEFAULT 'admitted' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `source_snapshots`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `problem_revisions_slug_unique` ON `problem_revisions` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `problem_revisions_project_revision_idx` ON `problem_revisions` (`project_id`,`target_key`,`revision_number`);--> statement-breakpoint
CREATE INDEX `problem_revisions_snapshot_idx` ON `problem_revisions` (`source_snapshot_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE INDEX `projects_kind_visibility_idx` ON `projects` (`kind`,`visibility`);--> statement-breakpoint
CREATE TABLE `source_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`upstream_name` text NOT NULL,
	`source_url` text NOT NULL,
	`revision_tag` text NOT NULL,
	`revision_commit` text NOT NULL,
	`retrieved_at` text NOT NULL,
	`content_hash` text NOT NULL,
	`manifest_hash` text NOT NULL,
	`source_license` text NOT NULL,
	`lean_toolchain` text NOT NULL,
	`mathlib_revision` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_snapshots_upstream_revision_idx` ON `source_snapshots` (`upstream_name`,`revision_commit`);--> statement-breakpoint
CREATE TABLE `verification_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`problem_revision_id` text NOT NULL,
	`claim_type` text NOT NULL,
	`status` text NOT NULL,
	`evidence_url` text,
	`recorded_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`problem_revision_id`) REFERENCES `problem_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verification_claims_revision_type_idx` ON `verification_claims` (`problem_revision_id`,`claim_type`);