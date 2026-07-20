-- Receipt evidence stays immutable. Publication eligibility is a separate,
-- equally immutable projection so test closure can remain auditable without
-- appearing in the public mathematical contribution record.
CREATE TABLE `contribution_receipt_publications` (
	`receipt_id` text PRIMARY KEY NOT NULL,
	`record_class` text NOT NULL CHECK (`record_class` IN ('research','demo','smoke_test')),
	`visibility` text NOT NULL CHECK (`visibility` IN ('public','unlisted','internal')),
	`policy_version` text NOT NULL,
	`classification_reason` text NOT NULL,
	`classified_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`receipt_id`) REFERENCES `contribution_receipts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `contribution_receipt_publications_visibility_idx` ON `contribution_receipt_publications` (`record_class`,`visibility`,`classified_at`);
--> statement-breakpoint
INSERT INTO `contribution_receipt_publications` (
	`receipt_id`, `record_class`, `visibility`, `policy_version`,
	`classification_reason`, `classified_at`
)
SELECT
	`id`,
	CASE
		WHEN lower(`beneficiary_person_id`) LIKE '%smoke%'
			OR lower(`beneficiary_person_id`) LIKE '%mock%'
			OR lower(`beneficiary_agent_id`) LIKE '%smoke%'
			OR lower(`beneficiary_agent_id`) LIKE '%mock%'
			OR `canonical_receipt` LIKE '%"declaration":"ProofweaveCloudSmoke.%'
		THEN 'smoke_test'
		WHEN lower(`beneficiary_person_id`) LIKE '%demo%'
			OR lower(`beneficiary_agent_id`) LIKE '%demo%'
		THEN 'demo'
		ELSE 'research'
	END,
	CASE
		WHEN lower(`beneficiary_person_id`) LIKE '%smoke%'
			OR lower(`beneficiary_person_id`) LIKE '%mock%'
			OR lower(`beneficiary_agent_id`) LIKE '%smoke%'
			OR lower(`beneficiary_agent_id`) LIKE '%mock%'
			OR `canonical_receipt` LIKE '%"declaration":"ProofweaveCloudSmoke.%'
		THEN 'internal'
		WHEN lower(`beneficiary_person_id`) LIKE '%demo%'
			OR lower(`beneficiary_agent_id`) LIKE '%demo%'
		THEN 'unlisted'
		ELSE 'public'
	END,
	'pw-receipt-publication-policy-v1',
	CASE
		WHEN lower(`beneficiary_person_id`) LIKE '%smoke%'
			OR lower(`beneficiary_person_id`) LIKE '%mock%'
			OR lower(`beneficiary_agent_id`) LIKE '%smoke%'
			OR lower(`beneficiary_agent_id`) LIKE '%mock%'
			OR `canonical_receipt` LIKE '%"declaration":"ProofweaveCloudSmoke.%'
		THEN 'legacy_smoke_marker'
		WHEN lower(`beneficiary_person_id`) LIKE '%demo%'
			OR lower(`beneficiary_agent_id`) LIKE '%demo%'
		THEN 'legacy_demo_marker'
		ELSE 'legacy_research_receipt'
	END,
	`issued_at`
FROM `contribution_receipts`;
--> statement-breakpoint
CREATE TRIGGER `contribution_receipt_publications_immutable_update`
BEFORE UPDATE ON `contribution_receipt_publications`
BEGIN
	SELECT RAISE(ABORT, 'contribution receipt publication records are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `contribution_receipt_publications_immutable_delete`
BEFORE DELETE ON `contribution_receipt_publications`
BEGIN
	SELECT RAISE(ABORT, 'contribution receipt publication records cannot be deleted');
END;
