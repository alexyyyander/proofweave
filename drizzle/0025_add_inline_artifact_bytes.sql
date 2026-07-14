-- Closed alpha can keep bounded reproducibility evidence in D1 while R2 is
-- unavailable. These rows are content-addressed and immutable; the separate
-- artifact_objects index remains the shared provenance contract.
CREATE TABLE `inline_artifact_bytes` (
	`object_key` text PRIMARY KEY NOT NULL,
	`content_hash` text NOT NULL,
	`byte_length` integer NOT NULL CHECK (`byte_length` >= 0 AND `byte_length` <= 1000000),
	`content_type` text NOT NULL,
	`bytes` blob NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	UNIQUE(`content_hash`)
);
--> statement-breakpoint
CREATE TRIGGER `inline_artifact_bytes_immutable_update`
BEFORE UPDATE ON `inline_artifact_bytes`
BEGIN
	SELECT RAISE(ABORT, 'inline artifact bytes are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `inline_artifact_bytes_immutable_delete`
BEFORE DELETE ON `inline_artifact_bytes`
BEGIN
	SELECT RAISE(ABORT, 'inline artifact bytes cannot be deleted');
END;
