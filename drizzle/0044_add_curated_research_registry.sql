-- Curated public literature and progress records are separate from
-- Agent-signed checkpoints. A row is a source-backed record, not a
-- Proofweave verification claim.
CREATE TABLE `curated_research_records` (
	`id` text PRIMARY KEY NOT NULL,
	`problem_revision_id` text NOT NULL,
	`role` text NOT NULL CHECK (`role` IN ('origin','definition','special_case','key_lemma','counterexample','negative_result','progress','formalization','reproduction','announcement','current_state')),
	`kind` text NOT NULL CHECK (`kind` IN ('paper','preprint','repository','announcement','formalization','result','review')),
	`title` text NOT NULL,
	`authors` text NOT NULL,
	`summary` text NOT NULL,
	`source_system` text NOT NULL,
	`source_url` text NOT NULL,
	`source_identifier` text NOT NULL,
	`occurred_at` text NOT NULL,
	`curation_status` text NOT NULL CHECK (`curation_status` IN ('source_asserted','curator_reviewed','lean_reproduced','disputed','superseded')),
	`lean_repository_url` text,
	`lean_commit` text,
	`lean_declaration` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`problem_revision_id`) REFERENCES `problem_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `curated_research_records_source_idx` ON `curated_research_records` (`problem_revision_id`,`source_system`,`source_identifier`);
--> statement-breakpoint
CREATE INDEX `curated_research_records_problem_time_idx` ON `curated_research_records` (`problem_revision_id`,`occurred_at`,`position`);
--> statement-breakpoint
CREATE INDEX `curated_research_records_status_idx` ON `curated_research_records` (`curation_status`,`occurred_at`);
--> statement-breakpoint
CREATE TRIGGER `curated_research_records_immutable_update` BEFORE UPDATE ON `curated_research_records` BEGIN SELECT RAISE(ABORT, 'curated research records are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `curated_research_records_immutable_delete` BEFORE DELETE ON `curated_research_records` BEGIN SELECT RAISE(ABORT, 'curated research records cannot be deleted'); END;
--> statement-breakpoint
-- Seed the two public Riemann-related records already exposed by the site's
-- history page. Both remain source_asserted until an independent Proofweave
-- replay records a separate verification state.
INSERT OR IGNORE INTO `curated_research_records` (
	`id`, `problem_revision_id`, `role`, `kind`, `title`, `authors`, `summary`,
	`source_system`, `source_url`, `source_identifier`, `occurred_at`,
	`curation_status`, `lean_repository_url`, `position`
) VALUES
(
	'curated:riemann:anthropic-lower-bound',
	'problem-revision:formal-conjectures:riemann-hypothesis:main:1',
	'progress',
	'announcement',
	'Claude improves a Riemann-zeta lower bound',
	'Anthropic research team',
	'Public reporting describes a new lower bound for the fraction of zeta zeros on the critical line. This is a substantial related result, not a proof of the Riemann Hypothesis.',
	'Anthropic research',
	'https://www.anthropic.com/research/riemann-zeta',
	'anthropic:riemann-zeta',
	'2026-08-10',
	'source_asserted',
	'https://github.com/anthropics/zeta-23-lean',
	10
),
(
	'curated:riemann:zeta23-lean',
	'problem-revision:formal-conjectures:riemann-hypothesis:main:1',
	'formalization',
	'formalization',
	'Zeta23 Lean formalization',
	'Anthropic research team',
	'The supporting Lean repository gives an executable formalization path for the related lower-bound result. A public repository link does not by itself create a Proofweave receipt or prove the headline conjecture.',
	'GitHub',
	'https://github.com/anthropics/zeta-23-lean',
	'github:anthropics/zeta-23-lean',
	'2026-08-10',
	'source_asserted',
	'https://github.com/anthropics/zeta-23-lean',
	20
);
