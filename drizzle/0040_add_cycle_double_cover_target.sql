INSERT OR IGNORE INTO source_snapshots (
  id, upstream_name, source_url, revision_tag, revision_commit,
  retrieved_at, content_hash, manifest_hash, source_license,
  lean_toolchain, mathlib_revision
) VALUES (
  'snapshot:openai:cdc-lean:577e9d9',
  'OpenAI cdc-lean',
  'https://github.com/openai/cdc-lean/tree/577e9d9ea326d520f80672ee69b830bf1d513df5',
  'claimed-proof-2026-07-09-lean4.31.0',
  '577e9d9ea326d520f80672ee69b830bf1d513df5',
  '2026-07-20T00:00:00Z',
  'sha256:bd5da32fc09e537d0bab4f2d442ba66f9fa6b0d2875869bd909415e378c33aa7',
  'sha256:017e3d0d83fe1030fba04238d0481c8559316006e6f745c0a99231f0be59ca9b',
  'No license file is present in the pinned source tree; inspect upstream terms before reuse.',
  'leanprover/lean4:v4.31.0',
  '9a9483a92959bc92bd6a60176dd1fe597298c1f8'
);
--> statement-breakpoint
INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
VALUES (
  'project:openai:cycle-double-cover',
  'openai-cycle-double-cover',
  'frontier',
  'Cycle Double Cover Conjecture',
  'A source-pinned Lean claim for finite loopless bridgeless multigraphs. Kernel execution, statement fidelity, provenance, novelty, and independent mathematical review remain separate Proofweave claims.',
  'public'
);
--> statement-breakpoint
INSERT OR IGNORE INTO problem_revisions (
  id, project_id, source_snapshot_id, target_key, slug,
  revision_number, title, domain, research_status, informal_statement,
  lean_statement, source_correspondence, proof_state, priority
) VALUES (
  'problem-revision:openai:cycle-double-cover:main:1',
  'project:openai:cycle-double-cover',
  'snapshot:openai:cdc-lean:577e9d9',
  'cycle-double-cover-main',
  'cycle-double-cover-conjecture',
  1,
  'Cycle Double Cover Conjecture',
  'Graph theory',
  'research_open',
  'Every finite loopless bridgeless multigraph has a collection of cycles in which every edge occurs exactly twice.',
  'theorem cycleDoubleCover_of_bridgeless
    {V E : Type u} [Fintype V] [Fintype E] [DecidableEq V] [DecidableEq E]
    (G : FiniteGraph V E) (hb : G.Bridgeless) :
    Nonempty G.CycleDoubleCover := by
  sorry',
  'imported_unreviewed',
  'proved',
  99
);
--> statement-breakpoint
INSERT OR IGNORE INTO declarations (
  id, problem_revision_id, qualified_name, declaration_kind,
  source_path, source_url, source_line_start, source_line_end,
  source_content_hash, is_primary
) VALUES (
  'declaration:openai:cycle-double-cover',
  'problem-revision:openai:cycle-double-cover:main:1',
  'CDCLean.cycleDoubleCover_of_bridgeless',
  'theorem',
  'CDCLean/Main.lean',
  'https://github.com/openai/cdc-lean/blob/577e9d9ea326d520f80672ee69b830bf1d513df5/CDCLean/Main.lean#L58-L67',
  58,
  67,
  'sha256:868348894074fa6d695a4483f600a8b779b478edf49d72b3d75a76f06f319482',
  1
);
--> statement-breakpoint
INSERT OR IGNORE INTO verification_claims (
  id, problem_revision_id, claim_type, status, evidence_url, recorded_at
) VALUES
  ('claim:cycle-double-cover:bundle', 'problem-revision:openai:cycle-double-cover:main:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-20T00:00:00Z'),
  ('claim:cycle-double-cover:kernel', 'problem-revision:openai:cycle-double-cover:main:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-20T00:00:00Z'),
  ('claim:cycle-double-cover:statement', 'problem-revision:openai:cycle-double-cover:main:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-20T00:00:00Z'),
  ('claim:cycle-double-cover:novelty', 'problem-revision:openai:cycle-double-cover:main:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-20T00:00:00Z'),
  ('claim:cycle-double-cover:accepted', 'problem-revision:openai:cycle-double-cover:main:1', 'project_accepted', 'not_submitted', NULL, '2026-07-20T00:00:00Z');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_subjects (problem_revision_id, subject_id, is_primary)
VALUES ('problem-revision:openai:cycle-double-cover:main:1', 'subject:ams-05', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO catalog_collection_members (
  collection_id, problem_revision_id, role, position
) VALUES (
  'collection:grand-challenges',
  'problem-revision:openai:cycle-double-cover:main:1',
  'headline',
  65
);
--> statement-breakpoint
INSERT OR IGNORE INTO catalog_imports (
  id, source_snapshot_id, input_hash, imported_at, record_count
) VALUES (
  'import:openai:cdc-lean:577e9d9',
  'snapshot:openai:cdc-lean:577e9d9',
  'sha256:bd5da32fc09e537d0bab4f2d442ba66f9fa6b0d2875869bd909415e378c33aa7',
  '2026-07-20T00:00:00Z',
  1
);
