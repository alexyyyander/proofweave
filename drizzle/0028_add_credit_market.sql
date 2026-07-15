-- Credit Market v1 fixes a non-financial budget for one pinned problem
-- revision. Lifecycle state is derived only from immutable events. No token,
-- compute, or financial-spend field exists in this ledger by design.
CREATE TABLE `problem_credit_pools` (
	`id` text PRIMARY KEY NOT NULL,
	`problem_revision_id` text NOT NULL,
	`policy_version` text NOT NULL CHECK (`policy_version` = 'pw-credit-market-v1'),
	`unit` text NOT NULL DEFAULT 'non_transferable_research_credit' CHECK (`unit` = 'non_transferable_research_credit'),
	`total_credits` integer NOT NULL CHECK (`total_credits` > 0 AND `total_credits` <= 1000000000),
	`sponsor_label` text NOT NULL CHECK (length(`sponsor_label`) BETWEEN 1 AND 160),
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`problem_revision_id`) REFERENCES `problem_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `problem_credit_pools_problem_revision_idx` ON `problem_credit_pools` (`problem_revision_id`);
--> statement-breakpoint
CREATE INDEX `problem_credit_pools_policy_idx` ON `problem_credit_pools` (`policy_version`,`created_at`);
--> statement-breakpoint
CREATE TABLE `problem_credit_pool_events` (
	`id` text PRIMARY KEY NOT NULL,
	`pool_id` text NOT NULL,
	`sequence` integer NOT NULL CHECK (`sequence` > 0),
	`event_type` text NOT NULL CHECK (`event_type` IN ('created','activated','locked','settled','cancelled')),
	`payload_hash` text NOT NULL UNIQUE CHECK (`payload_hash` GLOB 'sha256:[0-9a-f]*' AND length(`payload_hash`) = 71),
	`canonical_payload` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`pool_id`) REFERENCES `problem_credit_pools`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `problem_credit_pool_events_sequence_idx` ON `problem_credit_pool_events` (`pool_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `problem_credit_pool_events_occurred_idx` ON `problem_credit_pool_events` (`pool_id`,`occurred_at`);
--> statement-breakpoint
-- Seed one explicitly draft, non-financial pilot on the target already chosen
-- for the first delegated research Attempt. A created event does not activate
-- rewards; it makes the proposed fixed budget and allocation auditable.
INSERT OR IGNORE INTO `problem_credit_pools` (
	`id`, `problem_revision_id`, `policy_version`, `unit`, `total_credits`, `sponsor_label`, `created_at`
)
SELECT
	'pool:formal-conjectures:erdos-865:k2:pilot-v1',
	'problem-revision:formal-conjectures:erdos-865:k2:1',
	'pw-credit-market-v1',
	'non_transferable_research_credit',
	10000,
	'Proofweave pilot',
	'2026-07-15T06:00:00Z'
WHERE EXISTS (
	SELECT 1 FROM `problem_revisions`
	WHERE `id` = 'problem-revision:formal-conjectures:erdos-865:k2:1'
);
--> statement-breakpoint
INSERT OR IGNORE INTO `problem_credit_pool_events` (
	`id`, `pool_id`, `sequence`, `event_type`, `payload_hash`, `canonical_payload`, `occurred_at`, `created_at`
)
SELECT
	'pool-event:formal-conjectures:erdos-865:k2:pilot-v1:created',
	'pool:formal-conjectures:erdos-865:k2:pilot-v1',
	1,
	'created',
	'sha256:5ea48b118cbb127c7d04476604f60059c6edd01f58151e9aaf30ad54bee37c5a',
	'{"eventType":"created","occurredAt":"2026-07-15T06:00:00Z","policyVersion":"pw-credit-market-v1","poolId":"pool:formal-conjectures:erdos-865:k2:pilot-v1","problemRevisionId":"problem-revision:formal-conjectures:erdos-865:k2:1","protocolVersion":"pw-credit-pool-event-v1","sequence":1,"sponsorLabel":"Proofweave pilot","totalCredits":10000,"unit":"non_transferable_research_credit"}',
	'2026-07-15T06:00:00Z',
	'2026-07-15T06:00:00Z'
WHERE EXISTS (
	SELECT 1 FROM `problem_credit_pools`
	WHERE `id` = 'pool:formal-conjectures:erdos-865:k2:pilot-v1'
);
--> statement-breakpoint
CREATE TRIGGER `problem_credit_pools_immutable_update` BEFORE UPDATE ON `problem_credit_pools` BEGIN SELECT RAISE(ABORT, 'credit pools are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `problem_credit_pools_immutable_delete` BEFORE DELETE ON `problem_credit_pools` BEGIN SELECT RAISE(ABORT, 'credit pools cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `problem_credit_pool_events_immutable_update` BEFORE UPDATE ON `problem_credit_pool_events` BEGIN SELECT RAISE(ABORT, 'credit pool events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `problem_credit_pool_events_immutable_delete` BEFORE DELETE ON `problem_credit_pool_events` BEGIN SELECT RAISE(ABORT, 'credit pool events cannot be deleted'); END;
