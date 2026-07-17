INSERT OR IGNORE INTO `source_snapshots` (
  `id`, `upstream_name`, `source_url`, `revision_tag`, `revision_commit`,
  `retrieved_at`, `content_hash`, `manifest_hash`, `source_license`,
  `lean_toolchain`, `mathlib_revision`
) VALUES (
  'snapshot:formal-conjectures:bench-v1-lean4.27.0',
  'Formal Conjectures',
  'https://github.com/google-deepmind/formal-conjectures/tree/7a41db3d761324599812d6ca6cb6a9f311046dc7',
  'bench-v1-lean4.27.0',
  '7a41db3d761324599812d6ca6cb6a9f311046dc7',
  '2026-07-13T03:48:00Z',
  'sha256:95024fd456d2254c21c69f2c5c1c00b65aca4629a0557d2cb58523a070573367',
  'sha256:5b99b5f4f807cbba67bbcd22e5e486c17d6a8d970ea218de08d05830ab350c26',
  'Apache-2.0 source code; upstream materials may carry their own stated terms.',
  'leanprover/lean4:v4.27.0',
  'a3a10db0e9d66acbebf76c5e6a135066525ac900'
);
--> statement-breakpoint
INSERT OR IGNORE INTO `projects` (
  `id`, `slug`, `kind`, `title`, `summary`, `visibility`
) VALUES (
  'project:formal-conjectures:erdos-865',
  'formal-conjectures-erdos-865',
  'frontier',
  'Erdős Problem 865',
  'A pinned collection of formal statements around a density threshold problem attributed to Erdős and Sós. Source categories describe mathematical research status; Proofweave records separate verification claims.',
  'public'
);
--> statement-breakpoint
INSERT OR IGNORE INTO `problem_revisions` (
  `id`, `project_id`, `source_snapshot_id`, `target_key`, `slug`,
  `revision_number`, `title`, `domain`, `research_status`,
  `informal_statement`, `lean_statement`, `source_correspondence`,
  `proof_state`, `priority`
) VALUES
  (
    'problem-revision:formal-conjectures:erdos-865:main:1',
    'project:formal-conjectures:erdos-865',
    'snapshot:formal-conjectures:bench-v1-lean4.27.0',
    'erdos-865-main',
    'erdos-865',
    1,
    'Erdős Problem 865',
    'Number theory',
    'research_open',
    'There exists a constant C > 0 such that, for all sufficiently large N, every subset A of {1, …, N} with size at least 5N/8 + C contains distinct a, b, c with a + b, a + c, and b + c all in A.',
    'theorem erdos_865 :
    ∃ C > 0, ∀ᶠ (N : ℕ) in atTop,
      ∀ A ⊆ Icc 1 N, A.card ≥ (5 / 8 : ℝ) * N + C →
      ∃ a ∈ A, ∃ b ∈ A, ∃ c ∈ A, a ≠ b ∧ a ≠ c ∧ b ≠ c ∧
      a + b ∈ A ∧ a + c ∈ A ∧ b + c ∈ A := by
  sorry',
    'imported_unreviewed',
    'admitted',
    100
  ),
  (
    'problem-revision:formal-conjectures:erdos-865:k2:1',
    'project:formal-conjectures:erdos-865',
    'snapshot:formal-conjectures:bench-v1-lean4.27.0',
    'erdos-865-k2',
    'erdos-865-k2',
    1,
    'Erdős Problem 865: k = 2 variant',
    'Number theory',
    'research_solved',
    'For every subset A of {1, …, 2N} with at least N + 2 elements, there are distinct a and b in A with a + b also in A.',
    'theorem erdos_865.variants.k2 (N : ℕ) :
    ∀ A ⊆ Icc 1 (2 * N), A.card ≥ N + 2 →
    ∃ a ∈ A, ∃ b ∈ A, a ≠ b ∧ a + b ∈ A := by
  sorry',
    'imported_unreviewed',
    'admitted',
    90
  ),
  (
    'problem-revision:formal-conjectures:erdos-865:sos:1',
    'project:formal-conjectures:erdos-865',
    'snapshot:formal-conjectures:bench-v1-lean4.27.0',
    'erdos-865-sos',
    'erdos-865-sos-variant',
    1,
    'Erdős–Sós asymptotic variant',
    'Number theory',
    'research_open',
    'For each k ≥ 2, the minimum density threshold f_k(N) for a k-element subset with all pairwise sums in A has the conjectured asymptotic form as N tends to infinity.',
    'theorem erdos_865.variants.sos :
    ∀ᵉ (k : ℕ) (hk : 2 ≤ k),
    (fun N ↦ (f N k : ℝ)) ~[atTop] (fun N ↦ (1 / 2 : ℝ) * (1 + ∑ r ∈ Icc 1 (k - 2),
      (1 / 4 : ℝ) ^ r) * N) := by
  sorry',
    'imported_unreviewed',
    'admitted',
    80
  ),
  (
    'problem-revision:formal-conjectures:erdos-865:upper-bound:1',
    'project:formal-conjectures:erdos-865',
    'snapshot:formal-conjectures:bench-v1-lean4.27.0',
    'erdos-865-upper-bound',
    'erdos-865-upper-bound',
    1,
    'Erdős–Sós upper-bound variant',
    'Number theory',
    'research_solved',
    'For each k ≥ 3, there is ε_k > 0 such that, for all sufficiently large N, f_k(N) is at most (2/3 − ε_k)N.',
    'theorem erdos_865.variants.upper_bound (k : ℕ) (hk : 3 ≤ k) :
    ∃ ε > 0, ∀ᶠ N in atTop, (f N k : ℝ) ≤ (2 / 3 - ε) * N := by
  sorry',
    'imported_unreviewed',
    'admitted',
    70
  );
--> statement-breakpoint
INSERT OR IGNORE INTO `declarations` (
  `id`, `problem_revision_id`, `qualified_name`, `declaration_kind`,
  `source_path`, `source_url`, `source_line_start`, `source_line_end`,
  `source_content_hash`, `is_primary`
) VALUES
  (
    'declaration:formal-conjectures:erdos-865',
    'problem-revision:formal-conjectures:erdos-865:main:1',
    'Erdos865.erdos_865',
    'theorem',
    'FormalConjectures/ErdosProblems/865.lean',
    'https://github.com/google-deepmind/formal-conjectures/blob/7a41db3d761324599812d6ca6cb6a9f311046dc7/FormalConjectures/ErdosProblems/865.lean#L36-L41',
    36, 41,
    'sha256:95024fd456d2254c21c69f2c5c1c00b65aca4629a0557d2cb58523a070573367',
    1
  ),
  (
    'declaration:formal-conjectures:erdos-865-k2',
    'problem-revision:formal-conjectures:erdos-865:k2:1',
    'Erdos865.erdos_865.variants.k2',
    'theorem',
    'FormalConjectures/ErdosProblems/865.lean',
    'https://github.com/google-deepmind/formal-conjectures/blob/7a41db3d761324599812d6ca6cb6a9f311046dc7/FormalConjectures/ErdosProblems/865.lean#L49-L52',
    49, 52,
    'sha256:95024fd456d2254c21c69f2c5c1c00b65aca4629a0557d2cb58523a070573367',
    1
  ),
  (
    'declaration:formal-conjectures:erdos-865-sos',
    'problem-revision:formal-conjectures:erdos-865:sos:1',
    'Erdos865.erdos_865.variants.sos',
    'theorem',
    'FormalConjectures/ErdosProblems/865.lean',
    'https://github.com/google-deepmind/formal-conjectures/blob/7a41db3d761324599812d6ca6cb6a9f311046dc7/FormalConjectures/ErdosProblems/865.lean#L66-L71',
    66, 71,
    'sha256:95024fd456d2254c21c69f2c5c1c00b65aca4629a0557d2cb58523a070573367',
    1
  ),
  (
    'declaration:formal-conjectures:erdos-865-upper-bound',
    'problem-revision:formal-conjectures:erdos-865:upper-bound:1',
    'Erdos865.erdos_865.variants.upper_bound',
    'theorem',
    'FormalConjectures/ErdosProblems/865.lean',
    'https://github.com/google-deepmind/formal-conjectures/blob/7a41db3d761324599812d6ca6cb6a9f311046dc7/FormalConjectures/ErdosProblems/865.lean#L79-L81',
    79, 81,
    'sha256:95024fd456d2254c21c69f2c5c1c00b65aca4629a0557d2cb58523a070573367',
    1
  );
--> statement-breakpoint
INSERT OR IGNORE INTO `verification_claims` (
  `id`, `problem_revision_id`, `claim_type`, `status`, `evidence_url`, `recorded_at`
) VALUES
  ('claim:erdos-865:bundle', 'problem-revision:formal-conjectures:erdos-865:main:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-13T03:48:00Z'),
  ('claim:erdos-865:kernel', 'problem-revision:formal-conjectures:erdos-865:main:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-13T03:48:00Z'),
  ('claim:erdos-865:statement', 'problem-revision:formal-conjectures:erdos-865:main:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-13T03:48:00Z'),
  ('claim:erdos-865:novelty', 'problem-revision:formal-conjectures:erdos-865:main:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-13T03:48:00Z'),
  ('claim:erdos-865:accepted', 'problem-revision:formal-conjectures:erdos-865:main:1', 'project_accepted', 'not_submitted', NULL, '2026-07-13T03:48:00Z'),
  ('claim:erdos-865-k2:bundle', 'problem-revision:formal-conjectures:erdos-865:k2:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-13T03:48:00Z'),
  ('claim:erdos-865-k2:kernel', 'problem-revision:formal-conjectures:erdos-865:k2:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-13T03:48:00Z'),
  ('claim:erdos-865-k2:statement', 'problem-revision:formal-conjectures:erdos-865:k2:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-13T03:48:00Z'),
  ('claim:erdos-865-k2:novelty', 'problem-revision:formal-conjectures:erdos-865:k2:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-13T03:48:00Z'),
  ('claim:erdos-865-k2:accepted', 'problem-revision:formal-conjectures:erdos-865:k2:1', 'project_accepted', 'not_submitted', NULL, '2026-07-13T03:48:00Z'),
  ('claim:erdos-865-sos:bundle', 'problem-revision:formal-conjectures:erdos-865:sos:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-13T03:48:00Z'),
  ('claim:erdos-865-sos:kernel', 'problem-revision:formal-conjectures:erdos-865:sos:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-13T03:48:00Z'),
  ('claim:erdos-865-sos:statement', 'problem-revision:formal-conjectures:erdos-865:sos:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-13T03:48:00Z'),
  ('claim:erdos-865-sos:novelty', 'problem-revision:formal-conjectures:erdos-865:sos:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-13T03:48:00Z'),
  ('claim:erdos-865-sos:accepted', 'problem-revision:formal-conjectures:erdos-865:sos:1', 'project_accepted', 'not_submitted', NULL, '2026-07-13T03:48:00Z'),
  ('claim:erdos-865-upper-bound:bundle', 'problem-revision:formal-conjectures:erdos-865:upper-bound:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-13T03:48:00Z'),
  ('claim:erdos-865-upper-bound:kernel', 'problem-revision:formal-conjectures:erdos-865:upper-bound:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-13T03:48:00Z'),
  ('claim:erdos-865-upper-bound:statement', 'problem-revision:formal-conjectures:erdos-865:upper-bound:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-13T03:48:00Z'),
  ('claim:erdos-865-upper-bound:novelty', 'problem-revision:formal-conjectures:erdos-865:upper-bound:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-13T03:48:00Z'),
  ('claim:erdos-865-upper-bound:accepted', 'problem-revision:formal-conjectures:erdos-865:upper-bound:1', 'project_accepted', 'not_submitted', NULL, '2026-07-13T03:48:00Z');
--> statement-breakpoint
INSERT OR IGNORE INTO `catalog_imports` (
  `id`, `source_snapshot_id`, `input_hash`, `imported_at`, `record_count`
) VALUES (
  'import:formal-conjectures:bench-v1-lean4.27.0',
  'snapshot:formal-conjectures:bench-v1-lean4.27.0',
  'sha256:5cfd0ae589d6f4edf2c3aeeef5dff9f397ceda8990f0cb172b47a33a039a2044',
  '2026-07-13T03:48:00Z',
  4
);
