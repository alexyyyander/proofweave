CREATE TABLE `problem_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`proposer_person_id` text NOT NULL,
	`title` text NOT NULL,
	`domain` text NOT NULL,
	`informal_statement` text NOT NULL,
	`motivation` text NOT NULL,
	`source_url` text,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`payload_hash` text NOT NULL,
	`canonical_payload` text NOT NULL,
	`submitted_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`proposer_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `problem_proposals_person_idempotency_idx` ON `problem_proposals` (`proposer_person_id`,`idempotency_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `problem_proposals_payload_hash_idx` ON `problem_proposals` (`payload_hash`);
--> statement-breakpoint
CREATE INDEX `problem_proposals_person_time_idx` ON `problem_proposals` (`proposer_person_id`,`submitted_at`);
--> statement-breakpoint
CREATE TABLE `problem_proposal_events` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text NOT NULL,
	`sequence` integer NOT NULL CHECK (`sequence` > 0),
	`event_type` text NOT NULL CHECK (`event_type` IN ('submitted','under_review','accepted','rejected','withdrawn')),
	`actor_person_id` text NOT NULL,
	`note` text,
	`payload_hash` text NOT NULL,
	`canonical_payload` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`proposal_id`) REFERENCES `problem_proposals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `problem_proposal_events_sequence_idx` ON `problem_proposal_events` (`proposal_id`,`sequence`);
--> statement-breakpoint
CREATE UNIQUE INDEX `problem_proposal_events_payload_hash_idx` ON `problem_proposal_events` (`payload_hash`);
--> statement-breakpoint
CREATE INDEX `problem_proposal_events_proposal_time_idx` ON `problem_proposal_events` (`proposal_id`,`occurred_at`);
--> statement-breakpoint
CREATE TRIGGER `problem_proposals_immutable_update` BEFORE UPDATE ON `problem_proposals` BEGIN SELECT RAISE(ABORT, 'problem proposals are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `problem_proposals_immutable_delete` BEFORE DELETE ON `problem_proposals` BEGIN SELECT RAISE(ABORT, 'problem proposals cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `problem_proposal_events_immutable_update` BEFORE UPDATE ON `problem_proposal_events` BEGIN SELECT RAISE(ABORT, 'problem proposal events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `problem_proposal_events_immutable_delete` BEFORE DELETE ON `problem_proposal_events` BEGIN SELECT RAISE(ABORT, 'problem proposal events cannot be deleted'); END;
