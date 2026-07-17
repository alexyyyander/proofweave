-- A fresh replay becomes citeable reproducibility evidence only after the
-- trusted Runner has materialized its signed terminal result into this
-- immutable, content-addressed artifact closure. This is not an attestation.
CREATE TABLE `verification_replay_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`replay_id` text NOT NULL,
	`assignment_id` text NOT NULL,
	`run_id` text NOT NULL,
	`artifact_bundle_manifest_hash` text NOT NULL,
	`runner_result_hash` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`canonical_evidence` text NOT NULL,
	`recorded_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`replay_id`) REFERENCES `verification_replays`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assignment_id`) REFERENCES `verification_assignments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`artifact_bundle_manifest_hash`) REFERENCES `artifact_bundles`(`manifest_hash`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`evidence_hash`) REFERENCES `artifact_objects`(`content_hash`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verification_replay_evidence_replay_idx` ON `verification_replay_evidence` (`replay_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `verification_replay_evidence_run_idx` ON `verification_replay_evidence` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `verification_replay_evidence_hash_idx` ON `verification_replay_evidence` (`evidence_hash`);--> statement-breakpoint
CREATE INDEX `verification_replay_evidence_assignment_idx` ON `verification_replay_evidence` (`assignment_id`,`recorded_at`);--> statement-breakpoint
CREATE TRIGGER `verification_replay_evidence_immutable_update`
BEFORE UPDATE ON `verification_replay_evidence`
BEGIN
	SELECT RAISE(ABORT, 'verification replay evidence is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `verification_replay_evidence_immutable_delete`
BEFORE DELETE ON `verification_replay_evidence`
BEGIN
	SELECT RAISE(ABORT, 'verification replay evidence cannot be deleted');
END;
