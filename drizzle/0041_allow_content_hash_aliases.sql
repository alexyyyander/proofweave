-- The inline alpha bucket addresses objects by their full logical key. Two
-- roles may legitimately contain identical bytes (for example, empty Runner
-- stdout and stderr), so content hashes are indexed but are not globally
-- unique across object keys.
CREATE TABLE `inline_artifact_bytes_next` (
	`object_key` text PRIMARY KEY NOT NULL,
	`content_hash` text NOT NULL,
	`byte_length` integer NOT NULL CHECK (`byte_length` >= 0 AND `byte_length` <= 1000000),
	`content_type` text NOT NULL,
	`bytes` blob NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `inline_artifact_bytes_next` (
	`object_key`, `content_hash`, `byte_length`, `content_type`, `bytes`, `created_at`
)
SELECT `object_key`, `content_hash`, `byte_length`, `content_type`, `bytes`, `created_at`
FROM `inline_artifact_bytes`;
--> statement-breakpoint
DROP TABLE `inline_artifact_bytes`;
--> statement-breakpoint
ALTER TABLE `inline_artifact_bytes_next` RENAME TO `inline_artifact_bytes`;
--> statement-breakpoint
CREATE INDEX `inline_artifact_bytes_hash_idx`
ON `inline_artifact_bytes` (`content_hash`);
--> statement-breakpoint
CREATE TRIGGER `inline_artifact_bytes_immutable_update`
BEFORE UPDATE ON `inline_artifact_bytes`
BEGIN
	SELECT RAISE(ABORT, 'inline artifact bytes are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `inline_artifact_bytes_immutable_delete`
BEFORE DELETE ON `inline_artifact_bytes`
BEGIN
	SELECT RAISE(ABORT, 'inline artifact bytes cannot be deleted');
END;
