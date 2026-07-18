CREATE TABLE `receipt_credit_settlements` (
	`receipt_id` text PRIMARY KEY NOT NULL,
	`receipt_hash` text NOT NULL,
	`policy_version` text NOT NULL CHECK (`policy_version` = 'pw-receipt-credit-v1'),
	`unit` text NOT NULL CHECK (`unit` = 'non_transferable_research_credit'),
	`payload_hash` text NOT NULL,
	`canonical_payload` text NOT NULL,
	`settled_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`receipt_id`) REFERENCES `contribution_receipts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `receipt_credit_settlements_receipt_hash_idx` ON `receipt_credit_settlements` (`receipt_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `receipt_credit_settlements_payload_hash_idx` ON `receipt_credit_settlements` (`payload_hash`);
--> statement-breakpoint
CREATE INDEX `receipt_credit_settlements_time_idx` ON `receipt_credit_settlements` (`settled_at`,`receipt_id`);
--> statement-breakpoint
CREATE TABLE `receipt_credit_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`receipt_id` text NOT NULL,
	`person_id` text NOT NULL,
	`category` text NOT NULL CHECK (`category` IN ('certified_receipt','formalization','lemma','proof_progress','counterexample','verification','synthesis','infrastructure','downstream_impact')),
	`units` integer NOT NULL CHECK (`units` BETWEEN 1 AND 1000),
	`reason_key` text NOT NULL,
	`source_receipt_id` text NOT NULL,
	`policy_version` text NOT NULL CHECK (`policy_version` = 'pw-receipt-credit-v1'),
	`unit` text NOT NULL CHECK (`unit` = 'non_transferable_research_credit'),
	`payload_hash` text NOT NULL,
	`canonical_payload` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`receipt_id`) REFERENCES `receipt_credit_settlements`(`receipt_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_receipt_id`) REFERENCES `contribution_receipts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `receipt_credit_entries_payload_hash_idx` ON `receipt_credit_entries` (`payload_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `receipt_credit_entries_reason_idx` ON `receipt_credit_entries` (`receipt_id`,`person_id`,`category`,`reason_key`);
--> statement-breakpoint
CREATE INDEX `receipt_credit_entries_person_idx` ON `receipt_credit_entries` (`person_id`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `receipt_credit_entries_receipt_idx` ON `receipt_credit_entries` (`receipt_id`,`category`);
--> statement-breakpoint
CREATE TRIGGER `receipt_credit_settlements_immutable_update` BEFORE UPDATE ON `receipt_credit_settlements` BEGIN SELECT RAISE(ABORT, 'receipt credit settlements are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `receipt_credit_settlements_immutable_delete` BEFORE DELETE ON `receipt_credit_settlements` BEGIN SELECT RAISE(ABORT, 'receipt credit settlements cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `receipt_credit_entries_immutable_update` BEFORE UPDATE ON `receipt_credit_entries` BEGIN SELECT RAISE(ABORT, 'receipt credit entries are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `receipt_credit_entries_immutable_delete` BEFORE DELETE ON `receipt_credit_entries` BEGIN SELECT RAISE(ABORT, 'receipt credit entries cannot be deleted'); END;
