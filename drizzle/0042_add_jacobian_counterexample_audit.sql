INSERT OR IGNORE INTO source_snapshots (
  id, upstream_name, source_url, revision_tag, revision_commit,
  retrieved_at, content_hash, manifest_hash, source_license,
  lean_toolchain, mathlib_revision
) VALUES (
  'snapshot:proofweave-open-catalog:jacobian-audit:f74629e',
  'Proofweave Open Catalog',
  'https://github.com/alexyyyander/proofweave-open-catalog/tree/f74629eb7fd35192f1612339a578f404c2aaac06/evidence/jacobian-counterexample-audit',
  'jacobian-counterexample-audit-v1',
  'f74629eb7fd35192f1612339a578f404c2aaac06',
  '2026-07-22T06:15:00Z',
  'sha256:05557171f31ff0beefccdfa346ac83069ec7b63c0ecf6997e895fd62bc29ee26',
  'sha256:4f74526371f808aa3dc8885b19725606a6313e609903e9156d81059a3dd4ed06',
  'Apache-2.0 for the Lean reproduction; the external announcement remains attributed to its original author.',
  'leanprover/lean4:v4.27.0',
  'a3a10db0e9d66acbebf76c5e6a135066525ac900'
);
--> statement-breakpoint
INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
VALUES (
  'project:proofweave:jacobian-counterexample-audit',
  'proofweave-jacobian-counterexample-audit',
  'frontier',
  'Three-dimensional Jacobian counterexample audit',
  'A bounded algebraic reproduction of the displayed polynomial map, determinant, and collision witnesses. This target does not itself establish source priority, novelty, or independent acceptance of the full Jacobian claim.',
  'public'
);
--> statement-breakpoint
INSERT OR IGNORE INTO problem_revisions (
  id, project_id, source_snapshot_id, target_key, slug,
  revision_number, title, domain, research_status, informal_statement,
  lean_statement, source_correspondence, proof_state, priority
) VALUES (
  'problem-revision:proofweave:jacobian-counterexample-audit:main:1',
  'project:proofweave:jacobian-counterexample-audit',
  'snapshot:proofweave-open-catalog:jacobian-audit:f74629e',
  'jacobian-counterexample-audit-main',
  'jacobian-counterexample-algebraic-audit',
  1,
  'Jacobian counterexample: algebraic audit',
  'Algebraic geometry',
  'research_solved',
  'For the displayed three-variable polynomial map, the formal Jacobian determinant is -2 and three distinct rational inputs map to the same output. This bounded claim does not by itself settle source priority, novelty, or statement correspondence with every formulation of the Jacobian Conjecture.',
  'theorem jacobian_counterexample_audit :
    jacobianDet = (-2 : P) ∧
    point₀ ≠ point₁ ∧ point₀ ≠ point₂ ∧ point₁ ≠ point₂ ∧
    polynomialMap point₀ = commonImage ∧
    polynomialMap point₁ = commonImage ∧
    polynomialMap point₂ = commonImage ∧
    ¬ Function.Injective polynomialMap := by
  sorry',
  'source_bound_unreviewed',
  'proved',
  88
);
--> statement-breakpoint
INSERT OR IGNORE INTO declarations (
  id, problem_revision_id, qualified_name, declaration_kind,
  source_path, source_url, source_line_start, source_line_end,
  source_content_hash, is_primary
) VALUES (
  'declaration:proofweave:jacobian-counterexample-audit',
  'problem-revision:proofweave:jacobian-counterexample-audit:main:1',
  'ProofweaveJacobian.jacobian_counterexample_audit',
  'theorem',
  'evidence/jacobian-counterexample-audit/ProofweaveJacobian.lean',
  'https://github.com/alexyyyander/proofweave-open-catalog/blob/f74629eb7fd35192f1612339a578f404c2aaac06/evidence/jacobian-counterexample-audit/ProofweaveJacobian.lean#L123-L139',
  123,
  139,
  'sha256:05557171f31ff0beefccdfa346ac83069ec7b63c0ecf6997e895fd62bc29ee26',
  1
);
--> statement-breakpoint
INSERT OR IGNORE INTO verification_claims (
  id, problem_revision_id, claim_type, status, evidence_url, recorded_at
) VALUES
  ('claim:jacobian-counterexample-audit:bundle', 'problem-revision:proofweave:jacobian-counterexample-audit:main:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-22T06:15:00Z'),
  ('claim:jacobian-counterexample-audit:kernel', 'problem-revision:proofweave:jacobian-counterexample-audit:main:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-22T06:15:00Z'),
  ('claim:jacobian-counterexample-audit:statement', 'problem-revision:proofweave:jacobian-counterexample-audit:main:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-22T06:15:00Z'),
  ('claim:jacobian-counterexample-audit:novelty', 'problem-revision:proofweave:jacobian-counterexample-audit:main:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-22T06:15:00Z'),
  ('claim:jacobian-counterexample-audit:accepted', 'problem-revision:proofweave:jacobian-counterexample-audit:main:1', 'project_accepted', 'not_submitted', NULL, '2026-07-22T06:15:00Z');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_subjects (problem_revision_id, subject_id, is_primary)
VALUES ('problem-revision:proofweave:jacobian-counterexample-audit:main:1', 'subject:ams-14', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO catalog_collection_members (
  collection_id, problem_revision_id, role, position
) VALUES (
  'collection:grand-challenges',
  'problem-revision:proofweave:jacobian-counterexample-audit:main:1',
  'milestone',
  51
);
--> statement-breakpoint
INSERT OR IGNORE INTO catalog_imports (
  id, source_snapshot_id, input_hash, imported_at, record_count
) VALUES (
  'import:proofweave-open-catalog:jacobian-audit:f74629e',
  'snapshot:proofweave-open-catalog:jacobian-audit:f74629e',
  'sha256:4f74526371f808aa3dc8885b19725606a6313e609903e9156d81059a3dd4ed06',
  '2026-07-22T06:15:00Z',
  1
);
