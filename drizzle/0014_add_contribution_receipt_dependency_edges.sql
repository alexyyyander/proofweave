-- A receipt's canonical Artifact Bundle declares upstream receipts. This table
-- is an immutable, queryable projection of those signed declarations; it is
-- never an independently editable graph.
CREATE TABLE `contribution_receipt_dependency_edges` (
	`downstream_receipt_id` text NOT NULL,
	`upstream_receipt_id` text NOT NULL,
	`upstream_receipt_hash` text NOT NULL,
	`declared_by_bundle_manifest_hash` text NOT NULL,
	`recorded_at` text NOT NULL,
	PRIMARY KEY (`downstream_receipt_id`, `upstream_receipt_id`),
	FOREIGN KEY (`downstream_receipt_id`) REFERENCES `contribution_receipts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`upstream_receipt_id`) REFERENCES `contribution_receipts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`declared_by_bundle_manifest_hash`) REFERENCES `artifact_bundles`(`manifest_hash`) ON UPDATE no action ON DELETE restrict,
	CHECK (`downstream_receipt_id` <> `upstream_receipt_id`)
);
--> statement-breakpoint
CREATE INDEX `contribution_receipt_dependency_edges_upstream_idx` ON `contribution_receipt_dependency_edges` (`upstream_receipt_id`,`recorded_at`);--> statement-breakpoint
CREATE TRIGGER `contribution_receipt_dependency_edges_immutable_update`
BEFORE UPDATE ON `contribution_receipt_dependency_edges`
BEGIN
	SELECT RAISE(ABORT, 'contribution receipt dependency edges are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `contribution_receipt_dependency_edges_immutable_delete`
BEFORE DELETE ON `contribution_receipt_dependency_edges`
BEGIN
	SELECT RAISE(ABORT, 'contribution receipt dependency edges cannot be deleted');
END;
