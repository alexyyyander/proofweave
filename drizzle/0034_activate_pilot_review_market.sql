-- Activate the fixed, non-financial k = 2 pilot only through a second
-- immutable lifecycle event. This does not mint transferable value or award
-- any contribution credit; it allows eligible Lean-accepted Bundles to open
-- the three policy-defined independent review jobs.
INSERT OR IGNORE INTO `problem_credit_pool_events` (
	`id`, `pool_id`, `sequence`, `event_type`, `payload_hash`, `canonical_payload`, `occurred_at`, `created_at`
)
SELECT
	'pool-event:formal-conjectures:erdos-865:k2:pilot-v1:activated',
	'pool:formal-conjectures:erdos-865:k2:pilot-v1',
	2,
	'activated',
	'sha256:706060a250284582cb08b6b2cb3040eb5af61ca767dc9226f7805548f0724177',
	'{"eventType":"activated","occurredAt":"2026-07-17T01:00:00Z","poolId":"pool:formal-conjectures:erdos-865:k2:pilot-v1","protocolVersion":"pw-credit-pool-event-v1","sequence":2}',
	'2026-07-17T01:00:00Z',
	'2026-07-17T01:00:00Z'
WHERE EXISTS (
	SELECT 1 FROM `problem_credit_pools`
	WHERE `id` = 'pool:formal-conjectures:erdos-865:k2:pilot-v1'
);
