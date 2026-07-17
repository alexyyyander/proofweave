-- Public research checkpoints are immutable Agent-signed milestones. They are
-- deliberately distinct from linear Attempt notes, Lean execution evidence,
-- independent review, and final Contribution Receipts.
CREATE TABLE `research_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`problem_revision_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`beneficiary_person_id` text NOT NULL,
	`beneficiary_agent_id` text NOT NULL,
	`delegation_certificate_id` text NOT NULL,
	`kind` text NOT NULL CHECK (`kind` IN ('formalization','hypothesis','lemma','proof_state','proof_patch','counterexample','negative_result','synthesis')),
	`summary` text NOT NULL,
	`proof_state_hash` text,
	`artifact_bundle_manifest_hash` text,
	`initial_state` text NOT NULL DEFAULT 'shared_unverified' CHECK (`initial_state` = 'shared_unverified'),
	`payload_hash` text NOT NULL,
	`checkpoint_hash` text NOT NULL,
	`canonical_checkpoint` text NOT NULL,
	`agent_event_id` text NOT NULL,
	`agent_event_occurred_at` text NOT NULL,
	`agent_public_key` text NOT NULL,
	`agent_signature` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`problem_revision_id`) REFERENCES `problem_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`attempt_id`) REFERENCES `agent_attempts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`beneficiary_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`beneficiary_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`delegation_certificate_id`) REFERENCES `delegation_certificates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`artifact_bundle_manifest_hash`) REFERENCES `artifact_bundles`(`manifest_hash`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_nodes_payload_hash_idx` ON `research_nodes` (`payload_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_nodes_checkpoint_hash_idx` ON `research_nodes` (`checkpoint_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_nodes_agent_event_idx` ON `research_nodes` (`agent_event_id`);
--> statement-breakpoint
CREATE INDEX `research_nodes_problem_time_idx` ON `research_nodes` (`problem_revision_id`,`agent_event_occurred_at`);
--> statement-breakpoint
CREATE INDEX `research_nodes_attempt_time_idx` ON `research_nodes` (`attempt_id`,`agent_event_occurred_at`);
--> statement-breakpoint
CREATE TABLE `research_derivation_edges` (
	`child_node_id` text NOT NULL,
	`parent_node_id` text NOT NULL,
	`relation` text NOT NULL CHECK (`relation` IN ('derives_from','merges')),
	`declared_by_payload_hash` text NOT NULL,
	`recorded_at` text NOT NULL,
	PRIMARY KEY (`child_node_id`,`parent_node_id`),
	FOREIGN KEY (`child_node_id`) REFERENCES `research_nodes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_node_id`) REFERENCES `research_nodes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`declared_by_payload_hash`) REFERENCES `research_nodes`(`payload_hash`) ON UPDATE no action ON DELETE restrict,
	CHECK (`child_node_id` <> `parent_node_id`)
);
--> statement-breakpoint
CREATE INDEX `research_derivation_edges_parent_idx` ON `research_derivation_edges` (`parent_node_id`,`recorded_at`);
--> statement-breakpoint
CREATE TABLE `research_node_events` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`event_type` text NOT NULL CHECK (`event_type` IN ('published','superseded','withdrawn','verification_recorded')),
	`payload_hash` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `research_nodes`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_node_events_sequence_idx` ON `research_node_events` (`node_id`,`sequence`);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_node_events_payload_idx` ON `research_node_events` (`payload_hash`,`event_type`);
--> statement-breakpoint
-- Historical sources retain their original provenance and contributor names.
-- Importing one never fabricates a Proofweave delegation or Receipt.
CREATE TABLE `external_works` (
	`id` text PRIMARY KEY NOT NULL,
	`source_system` text NOT NULL,
	`source_url` text NOT NULL,
	`source_object_id` text NOT NULL,
	`source_revision` text NOT NULL,
	`title` text NOT NULL,
	`content_hash` text NOT NULL,
	`source_license` text NOT NULL,
	`retrieved_at` text NOT NULL,
	`asserted_by_person_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`asserted_by_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_works_source_revision_idx` ON `external_works` (`source_system`,`source_object_id`,`source_revision`);
--> statement-breakpoint
CREATE INDEX `external_works_asserted_by_idx` ON `external_works` (`asserted_by_person_id`,`retrieved_at`);
--> statement-breakpoint
-- A historical work is made visible only on explicitly linked problem
-- revisions. This prevents an account-wide source import from silently
-- becoming prior work for every conjecture in the public catalog.
CREATE TABLE `external_work_problem_links` (
	`external_work_id` text NOT NULL,
	`problem_revision_id` text NOT NULL,
	`relation` text NOT NULL DEFAULT 'prior_work' CHECK (`relation` = 'prior_work'),
	`asserted_by_person_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	PRIMARY KEY (`external_work_id`,`problem_revision_id`,`relation`),
	FOREIGN KEY (`external_work_id`) REFERENCES `external_works`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`problem_revision_id`) REFERENCES `problem_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asserted_by_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `external_work_problem_links_problem_idx` ON `external_work_problem_links` (`problem_revision_id`,`recorded_at`);
--> statement-breakpoint
CREATE TABLE `external_attributions` (
	`id` text PRIMARY KEY NOT NULL,
	`external_work_id` text NOT NULL,
	`display_name` text NOT NULL,
	`persistent_id_scheme` text,
	`persistent_id` text,
	`role` text NOT NULL CHECK (`role` IN ('author','formalizer','prover','reviewer','maintainer')),
	`assertion_status` text NOT NULL CHECK (`assertion_status` IN ('source_asserted','curator_reviewed','author_confirmed')),
	`asserted_by_person_id` text,
	`evidence_url` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`external_work_id`) REFERENCES `external_works`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asserted_by_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_attributions_identity_idx` ON `external_attributions` (`external_work_id`,`display_name`,`role`,`evidence_url`);
--> statement-breakpoint
CREATE INDEX `external_attributions_work_idx` ON `external_attributions` (`external_work_id`,`assertion_status`);
--> statement-breakpoint
CREATE TABLE `research_node_citations` (
	`research_node_id` text NOT NULL,
	`external_work_id` text NOT NULL,
	`relation` text NOT NULL CHECK (`relation` IN ('builds_on','formalizes','refutes','reproduces')),
	`declared_by_payload_hash` text NOT NULL,
	`recorded_at` text NOT NULL,
	PRIMARY KEY (`research_node_id`,`external_work_id`,`relation`),
	FOREIGN KEY (`research_node_id`) REFERENCES `research_nodes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`external_work_id`) REFERENCES `external_works`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`declared_by_payload_hash`) REFERENCES `research_nodes`(`payload_hash`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `research_node_citations_work_idx` ON `research_node_citations` (`external_work_id`,`recorded_at`);
--> statement-breakpoint
CREATE TRIGGER `research_nodes_immutable_update` BEFORE UPDATE ON `research_nodes` BEGIN SELECT RAISE(ABORT, 'research nodes are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `research_nodes_immutable_delete` BEFORE DELETE ON `research_nodes` BEGIN SELECT RAISE(ABORT, 'research nodes cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `research_derivation_edges_immutable_update` BEFORE UPDATE ON `research_derivation_edges` BEGIN SELECT RAISE(ABORT, 'research derivation edges are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `research_derivation_edges_immutable_delete` BEFORE DELETE ON `research_derivation_edges` BEGIN SELECT RAISE(ABORT, 'research derivation edges cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `research_node_events_immutable_update` BEFORE UPDATE ON `research_node_events` BEGIN SELECT RAISE(ABORT, 'research node events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `research_node_events_immutable_delete` BEFORE DELETE ON `research_node_events` BEGIN SELECT RAISE(ABORT, 'research node events cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `external_works_immutable_update` BEFORE UPDATE ON `external_works` BEGIN SELECT RAISE(ABORT, 'external works are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `external_works_immutable_delete` BEFORE DELETE ON `external_works` BEGIN SELECT RAISE(ABORT, 'external works cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `external_work_problem_links_immutable_update` BEFORE UPDATE ON `external_work_problem_links` BEGIN SELECT RAISE(ABORT, 'external work problem links are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `external_work_problem_links_immutable_delete` BEFORE DELETE ON `external_work_problem_links` BEGIN SELECT RAISE(ABORT, 'external work problem links cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `external_attributions_immutable_update` BEFORE UPDATE ON `external_attributions` BEGIN SELECT RAISE(ABORT, 'external attributions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `external_attributions_immutable_delete` BEFORE DELETE ON `external_attributions` BEGIN SELECT RAISE(ABORT, 'external attributions cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `research_node_citations_immutable_update` BEFORE UPDATE ON `research_node_citations` BEGIN SELECT RAISE(ABORT, 'research node citations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `research_node_citations_immutable_delete` BEFORE DELETE ON `research_node_citations` BEGIN SELECT RAISE(ABORT, 'research node citations cannot be deleted'); END;
