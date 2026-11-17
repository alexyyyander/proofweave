-- Additive storage for the login-based beta. Keep this rollout independent
-- of the migration ledger shared with the deployed Runner.
CREATE TABLE IF NOT EXISTS research_beta_enrollments (
  seat INTEGER PRIMARY KEY CHECK (seat BETWEEN 1 AND 100),
  person_id TEXT NOT NULL UNIQUE REFERENCES persons(id) ON DELETE RESTRICT,
  admitted_at TEXT NOT NULL
);
