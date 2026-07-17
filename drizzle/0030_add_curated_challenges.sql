CREATE TABLE IF NOT EXISTS catalog_subjects (
  id text PRIMARY KEY NOT NULL,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  ams_code text NOT NULL UNIQUE,
  description text NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS catalog_subjects_sort_idx ON catalog_subjects (sort_order, name);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS problem_subjects (
  problem_revision_id text NOT NULL,
  subject_id text NOT NULL,
  is_primary integer DEFAULT 0 NOT NULL,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (problem_revision_id, subject_id),
  FOREIGN KEY (problem_revision_id) REFERENCES problem_revisions(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (subject_id) REFERENCES catalog_subjects(id) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS problem_subjects_subject_idx ON problem_subjects (subject_id, is_primary);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS catalog_collections (
  id text PRIMARY KEY NOT NULL,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  summary text NOT NULL,
  tier text NOT NULL,
  priority integer DEFAULT 0 NOT NULL,
  visibility text DEFAULT 'public' NOT NULL,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS catalog_collections_visibility_priority_idx ON catalog_collections (visibility, priority);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS catalog_collection_members (
  collection_id text NOT NULL,
  problem_revision_id text NOT NULL,
  role text NOT NULL,
  position integer DEFAULT 0 NOT NULL,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (collection_id, problem_revision_id),
  FOREIGN KEY (collection_id) REFERENCES catalog_collections(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (problem_revision_id) REFERENCES problem_revisions(id) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS catalog_collection_members_revision_idx ON catalog_collection_members (problem_revision_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS catalog_collection_members_position_idx ON catalog_collection_members (collection_id, position);
--> statement-breakpoint
INSERT OR IGNORE INTO source_snapshots (
  id, upstream_name, source_url, revision_tag, revision_commit,
  retrieved_at, content_hash, manifest_hash, source_license,
  lean_toolchain, mathlib_revision
) VALUES   ('snapshot:formal-conjectures:focus-v1-lean4.27.0', 'Formal Conjectures', 'https://github.com/google-deepmind/formal-conjectures/tree/b2e608fc52d765510915a244bb69b1a2741acc3c', 'curated-focus-v1-lean4.27.0', 'b2e608fc52d765510915a244bb69b1a2741acc3c', '2026-07-16T00:00:00Z', 'sha256:d8087e6509f8b48303fd6c0ea25d354dfe9379f23b2f7bd8b31dc0e0276e1cf7', 'sha256:43ca55a6fe946effb4a213e7a2b6b0c134d15b99888ff9aa0434c4e4676b24e6', 'Apache-2.0 source code; upstream materials may carry their own stated terms.', 'leanprover/lean4:v4.27.0', 'a3a10db0e9d66acbebf76c5e6a135066525ac900');
--> statement-breakpoint
INSERT OR IGNORE INTO catalog_subjects (
  id, slug, name, ams_code, description, sort_order
) VALUES
  ('subject:ams-05', 'combinatorics', 'Combinatorics', '05', 'Enumerative, extremal, and structural combinatorics.', 5),
  ('subject:ams-11', 'number-theory', 'Number theory', '11', 'Prime numbers, additive number theory, and arithmetic structures.', 11),
  ('subject:ams-14', 'algebraic-geometry', 'Algebraic geometry', '14', 'Algebraic varieties, morphisms, and polynomial geometry.', 14),
  ('subject:ams-35', 'partial-differential-equations', 'Partial differential equations', '35', 'Existence, regularity, and qualitative behavior of PDE solutions.', 35),
  ('subject:ams-37', 'dynamical-systems', 'Dynamical systems', '37', 'Iteration, asymptotic behavior, and ergodic phenomena.', 37),
  ('subject:ams-42', 'harmonic-analysis', 'Harmonic analysis', '42', 'Fourier analysis and geometric measure questions in Euclidean spaces.', 42),
  ('subject:ams-52', 'discrete-geometry', 'Discrete geometry', '52', 'Convex, combinatorial, and incidence geometry.', 52);
--> statement-breakpoint
INSERT OR IGNORE INTO catalog_collections (
  id, slug, title, summary, tier, priority, visibility
) VALUES
  ('collection:founding-challenges', 'founding-challenges', 'Founding Challenges', 'Recognizable open questions paired with smaller, known milestones that make a first research Attempt concrete.', 'founding', 100, 'public'),
  ('collection:grand-challenges', 'grand-challenges', 'Grand Challenges', 'Long-horizon problems whose formal statements can anchor reusable lemmas, counterexamples, and independent review.', 'grand', 90, 'public');
--> statement-breakpoint
INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
  VALUES   ('project:formal-conjectures:erdos-20', 'formal-conjectures-erdos-20', 'frontier', 'Erdős–Rado Sunflower Conjecture', 'The sunflower problem asks how large a uniform set family must be before a sunflower is unavoidable; the catalog pairs the open exponential question with the classical factorial bound.', 'public');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_revisions (
    id, project_id, source_snapshot_id, target_key, slug,
    revision_number, title, domain, research_status, informal_statement,
    lean_statement, source_correspondence, proof_state, priority
  ) VALUES
  ('problem-revision:formal-conjectures:erdos-20:main:1', 'project:formal-conjectures:erdos-20', 'snapshot:formal-conjectures:focus-v1-lean4.27.0', 'erdos-20-main', 'sunflower-conjecture', 1, 'Erdős–Rado Sunflower Conjecture', 'Combinatorics', 'research_open', 'For each number of petals k, the largest n-uniform family with no k-sunflower is bounded exponentially in n.', 'theorem erdos_20 : answer(sorry) ↔ ∃ (c : ℕ → ℕ), ∀ n k, n > 0 → f n k < (c k) ^ n := by
  sorry', 'imported_unreviewed', 'admitted', 98),
  ('problem-revision:formal-conjectures:erdos-20:erdos-rado-bound:1', 'project:formal-conjectures:erdos-20', 'snapshot:formal-conjectures:focus-v1-lean4.27.0', 'erdos-20-erdos-rado-bound', 'sunflower-erdos-rado-bound', 1, 'Sunflower: Erdős–Rado bound', 'Combinatorics', 'research_solved', 'The classical Erdős–Rado argument bounds the sunflower-free extremal function by (k − 1)ⁿ n! + 1.', 'theorem erdos_20.variants.erdos_rado_bound :
    ∀ n k, n > 0 → 2 ≤ k → f n k ≤ (k - 1) ^ n * n.factorial + 1 := by
  sorry', 'imported_unreviewed', 'admitted', 88);
--> statement-breakpoint
INSERT OR IGNORE INTO declarations (
    id, problem_revision_id, qualified_name, declaration_kind,
    source_path, source_url, source_line_start, source_line_end,
    source_content_hash, is_primary
  ) VALUES
  ('declaration:formal-conjectures:erdos-20', 'problem-revision:formal-conjectures:erdos-20:main:1', 'Erdos20.erdos_20', 'theorem', 'FormalConjectures/ErdosProblems/20.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/ErdosProblems/20.lean#L51-L51', 51, 51, 'sha256:a30fae786a2dab55d5a42b4cb74dd12b4e4e858d3513748c71ef14ff48b0ef4a', 1),
  ('declaration:formal-conjectures:erdos-20-erdos-rado-bound', 'problem-revision:formal-conjectures:erdos-20:erdos-rado-bound:1', 'Erdos20.erdos_20.variants.erdos_rado_bound', 'theorem', 'FormalConjectures/ErdosProblems/20.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/ErdosProblems/20.lean#L62-L63', 62, 63, 'sha256:a30fae786a2dab55d5a42b4cb74dd12b4e4e858d3513748c71ef14ff48b0ef4a', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
  VALUES   ('project:formal-conjectures:erdos-508', 'formal-conjectures-erdos-508', 'frontier', 'Hadwiger–Nelson Problem', 'Determine the chromatic number of the plane when points at unit distance must receive different colors, with known lower bounds exposed as formalization milestones.', 'public');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_revisions (
    id, project_id, source_snapshot_id, target_key, slug,
    revision_number, title, domain, research_status, informal_statement,
    lean_statement, source_correspondence, proof_state, priority
  ) VALUES
  ('problem-revision:formal-conjectures:erdos-508:main:1', 'project:formal-conjectures:erdos-508', 'snapshot:formal-conjectures:focus-v1-lean4.27.0', 'erdos-508-main', 'hadwiger-nelson', 1, 'Hadwiger–Nelson Problem', 'Discrete geometry', 'research_open', 'Determine the minimum number of colors needed to color the Euclidean plane so that points exactly one unit apart have different colors.', 'theorem HadwigerNelsonProblem :
    χ(ℝ²) = answer(sorry) := by
  sorry', 'imported_unreviewed', 'admitted', 97),
  ('problem-revision:formal-conjectures:erdos-508:at-least-five:1', 'project:formal-conjectures:erdos-508', 'snapshot:formal-conjectures:focus-v1-lean4.27.0', 'erdos-508-at-least-five', 'hadwiger-nelson-at-least-five', 1, 'Hadwiger–Nelson: at least five colors', 'Discrete geometry', 'research_solved', 'The chromatic number of the Euclidean plane is at least five.', 'theorem HadwigerNelsonAtLeastFive :
    5 ≤ χ(ℝ²) := by
  sorry', 'imported_unreviewed', 'admitted', 87),
  ('problem-revision:formal-conjectures:erdos-508:at-least-four:1', 'project:formal-conjectures:erdos-508', 'snapshot:formal-conjectures:focus-v1-lean4.27.0', 'erdos-508-at-least-four', 'hadwiger-nelson-at-least-four', 1, 'Hadwiger–Nelson: at least four colors', 'Combinatorics', 'research_solved', 'The chromatic number of the Euclidean plane is at least four.', 'theorem HadwigerNelsonAtLeast4 : 4 ≤ χ(ℝ²) := by
  sorry', 'imported_unreviewed', 'admitted', 77);
--> statement-breakpoint
INSERT OR IGNORE INTO declarations (
    id, problem_revision_id, qualified_name, declaration_kind,
    source_path, source_url, source_line_start, source_line_end,
    source_content_hash, is_primary
  ) VALUES
  ('declaration:formal-conjectures:erdos-508', 'problem-revision:formal-conjectures:erdos-508:main:1', 'Erdos508.HadwigerNelsonProblem', 'theorem', 'FormalConjectures/ErdosProblems/508.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/ErdosProblems/508.lean#L45-L46', 45, 46, 'sha256:267dd025998ff952ddff7c0aa95688bc7b2bce2755517ec44459bffb88312f08', 1),
  ('declaration:formal-conjectures:erdos-508-at-least-five', 'problem-revision:formal-conjectures:erdos-508:at-least-five:1', 'Erdos508.HadwigerNelsonAtLeastFive', 'theorem', 'FormalConjectures/ErdosProblems/508.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/ErdosProblems/508.lean#L57-L58', 57, 58, 'sha256:267dd025998ff952ddff7c0aa95688bc7b2bce2755517ec44459bffb88312f08', 1),
  ('declaration:formal-conjectures:erdos-508-at-least-four', 'problem-revision:formal-conjectures:erdos-508:at-least-four:1', 'Erdos508.HadwigerNelsonAtLeast4', 'theorem', 'FormalConjectures/ErdosProblems/508.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/ErdosProblems/508.lean#L67-L67', 67, 67, 'sha256:267dd025998ff952ddff7c0aa95688bc7b2bce2755517ec44459bffb88312f08', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
  VALUES   ('project:formal-conjectures:lonely-runner', 'formal-conjectures-lonely-runner', 'frontier', 'Lonely Runner Conjecture', 'A Diophantine approximation problem about runners with distinct speeds, paired with a proved quantitative spacing milestone.', 'public');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_revisions (
    id, project_id, source_snapshot_id, target_key, slug,
    revision_number, title, domain, research_status, informal_statement,
    lean_statement, source_correspondence, proof_state, priority
  ) VALUES
  ('problem-revision:formal-conjectures:lonely-runner:main:1', 'project:formal-conjectures:lonely-runner', 'snapshot:formal-conjectures:focus-v1-lean4.27.0', 'lonely-runner-main', 'lonely-runner', 1, 'Lonely Runner Conjecture', 'Number theory', 'research_open', 'For runners with distinct constant speeds on a unit circle, each runner is eventually at least 1/n from every other runner.', 'theorem lonely_runner_conjecture (n : ℕ)
    (speed : Fin n ↪ ℝ) (lonely : Fin n → ℝ → Prop)
    (lonely_def :
      ∀ r t, lonely r t ↔
        ∀ r2 : Fin n, r2 ≠ r →
        dist (t * speed r : UnitAddCircle) (t * speed r2) ≥ 1 / n)
    (r : Fin n) : ∃ t ≥ 0, lonely r t := by
  sorry', 'imported_unreviewed', 'admitted', 96),
  ('problem-revision:formal-conjectures:lonely-runner:tao-2017:1', 'project:formal-conjectures:lonely-runner', 'snapshot:formal-conjectures:focus-v1-lean4.27.0', 'lonely-runner-tao-2017', 'lonely-runner-tao-2017', 1, 'Lonely Runner: Tao 2017 spacing bound', 'Number theory', 'research_solved', 'A quantitative lower bound improves the universal gap beyond 1/(2n) for all sufficiently large n.', 'theorem lonely_runner_conjecture.variants.tao_2017 :
    ∃ c : ℝ, 0 < c ∧
      (∀ᶠ n : ℕ in Filter.atTop,
        deltaGap n ≥
          ((1 : ℝ) / (2 * (n : ℝ))
            + c * Real.log (n : ℝ) /
                ((n : ℝ) ^ 2 * (Real.log (Real.log (n : ℝ))) ^ 2))) := by
  sorry', 'imported_unreviewed', 'admitted', 86);
--> statement-breakpoint
INSERT OR IGNORE INTO declarations (
    id, problem_revision_id, qualified_name, declaration_kind,
    source_path, source_url, source_line_start, source_line_end,
    source_content_hash, is_primary
  ) VALUES
  ('declaration:formal-conjectures:lonely-runner', 'problem-revision:formal-conjectures:lonely-runner:main:1', 'LonelyRunnerConjecture.lonely_runner_conjecture', 'theorem', 'FormalConjectures/Wikipedia/LonelyRunnerConjecture.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Wikipedia/LonelyRunnerConjecture.lean#L36-L42', 36, 42, 'sha256:a9f9d2504bb1f29e52e659a26080edf68b76a95abe4af8e68b1d6d404be1a309', 1),
  ('declaration:formal-conjectures:lonely-runner-tao-2017', 'problem-revision:formal-conjectures:lonely-runner:tao-2017:1', 'LonelyRunnerConjecture.lonely_runner_conjecture.variants.tao_2017', 'theorem', 'FormalConjectures/Wikipedia/LonelyRunnerConjecture.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Wikipedia/LonelyRunnerConjecture.lean#L70-L76', 70, 76, 'sha256:a9f9d2504bb1f29e52e659a26080edf68b76a95abe4af8e68b1d6d404be1a309', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
  VALUES   ('project:formal-conjectures:kakeya', 'formal-conjectures-kakeya', 'frontier', 'Kakeya Set Conjecture', 'Kakeya sets contain a unit segment in every direction; the collection separates the open general dimension statement from solved Euclidean and finite-field cases.', 'public');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_revisions (
    id, project_id, source_snapshot_id, target_key, slug,
    revision_number, title, domain, research_status, informal_statement,
    lean_statement, source_correspondence, proof_state, priority
  ) VALUES
  ('problem-revision:formal-conjectures:kakeya:main:1', 'project:formal-conjectures:kakeya', 'snapshot:formal-conjectures:focus-v1-lean4.27.0', 'kakeya-main', 'kakeya-set-conjecture', 1, 'Kakeya Set Conjecture', 'Harmonic analysis', 'research_open', 'Every Kakeya set in positive Euclidean dimension has full Hausdorff dimension.', 'theorem kakeya_set_conjecture (n : ℕ) (hn : n > 0) :
    KakeyaSetConjectureDim n := by
  sorry', 'imported_unreviewed', 'admitted', 95),
  ('problem-revision:formal-conjectures:kakeya:2d:1', 'project:formal-conjectures:kakeya', 'snapshot:formal-conjectures:focus-v1-lean4.27.0', 'kakeya-2d', 'kakeya-two-dimensional', 1, 'Kakeya: two dimensions', 'Harmonic analysis', 'research_solved', 'The Kakeya set conjecture holds in two dimensions.', 'theorem kakeya_2d : KakeyaSetConjectureDim 2 := by
  sorry', 'imported_unreviewed', 'admitted', 85),
  ('problem-revision:formal-conjectures:kakeya:3d:1', 'project:formal-conjectures:kakeya', 'snapshot:formal-conjectures:focus-v1-lean4.27.0', 'kakeya-3d', 'kakeya-three-dimensional', 1, 'Kakeya: three dimensions', 'Harmonic analysis', 'research_solved', 'The Kakeya set conjecture holds in three dimensions.', 'theorem kakeya_3d : KakeyaSetConjectureDim 3 := by
  sorry', 'imported_unreviewed', 'admitted', 84),
  ('problem-revision:formal-conjectures:kakeya:finite:1', 'project:formal-conjectures:kakeya', 'snapshot:formal-conjectures:focus-v1-lean4.27.0', 'kakeya-finite-field', 'kakeya-finite-field', 1, 'Kakeya: finite-field bound', 'Discrete geometry', 'research_solved', 'A finite-field Kakeya set satisfies the stated polynomial-method cardinality lower bound.', 'theorem kakeya_finite {F : Type*} [Field F] [Fintype F] {n : ℕ}
    (K : Finset (Fin n → F)) (hK : IsKakeyaFinite K) :
    card F ^ n / (2 - 1 / card F : ℚ) ^ (n - 1) ≤ K.card := by
  sorry', 'imported_unreviewed', 'admitted', 83);
--> statement-breakpoint
INSERT OR IGNORE INTO declarations (
    id, problem_revision_id, qualified_name, declaration_kind,
    source_path, source_url, source_line_start, source_line_end,
    source_content_hash, is_primary
  ) VALUES
  ('declaration:formal-conjectures:kakeya', 'problem-revision:formal-conjectures:kakeya:main:1', 'Kakeya.kakeya_set_conjecture', 'theorem', 'FormalConjectures/Wikipedia/Kakeya.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Wikipedia/Kakeya.lean#L59-L60', 59, 60, 'sha256:4d624a82f55702f1602858e2d38bdf26bfdb9892954c71736768e84f8cb9012c', 1),
  ('declaration:formal-conjectures:kakeya-2d', 'problem-revision:formal-conjectures:kakeya:2d:1', 'Kakeya.kakeya_2d', 'theorem', 'FormalConjectures/Wikipedia/Kakeya.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Wikipedia/Kakeya.lean#L70-L70', 70, 70, 'sha256:4d624a82f55702f1602858e2d38bdf26bfdb9892954c71736768e84f8cb9012c', 1),
  ('declaration:formal-conjectures:kakeya-3d', 'problem-revision:formal-conjectures:kakeya:3d:1', 'Kakeya.kakeya_3d', 'theorem', 'FormalConjectures/Wikipedia/Kakeya.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Wikipedia/Kakeya.lean#L80-L80', 80, 80, 'sha256:4d624a82f55702f1602858e2d38bdf26bfdb9892954c71736768e84f8cb9012c', 1),
  ('declaration:formal-conjectures:kakeya-finite', 'problem-revision:formal-conjectures:kakeya:finite:1', 'Kakeya.kakeya_finite', 'theorem', 'FormalConjectures/Wikipedia/Kakeya.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Wikipedia/Kakeya.lean#L102-L104', 102, 104, 'sha256:4d624a82f55702f1602858e2d38bdf26bfdb9892954c71736768e84f8cb9012c', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
  VALUES   ('project:formal-conjectures:goldbach', 'formal-conjectures-goldbach', 'frontier', 'Goldbach Conjectures', 'The binary Goldbach conjecture remains open, while the ternary theorem supplies a famous solved statement for formalization work.', 'public');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_revisions (
    id, project_id, source_snapshot_id, target_key, slug,
    revision_number, title, domain, research_status, informal_statement,
    lean_statement, source_correspondence, proof_state, priority
  ) VALUES
  ('problem-revision:formal-conjectures:goldbach:main:1', 'project:formal-conjectures:goldbach', 'snapshot:formal-conjectures:focus-v1-lean4.27.0', 'goldbach-main', 'goldbach-conjecture', 1, 'Goldbach Conjecture', 'Number theory', 'research_open', 'Every even integer greater than two is the sum of two prime numbers.', 'theorem goldbach :
    answer(sorry) ↔ ∀ n : ℕ, 2 < n → Even n → ∃ p q, Prime p ∧ Prime q ∧ n = p + q := by
  sorry', 'imported_unreviewed', 'admitted', 94),
  ('problem-revision:formal-conjectures:goldbach:ternary:1', 'project:formal-conjectures:goldbach', 'snapshot:formal-conjectures:focus-v1-lean4.27.0', 'goldbach-ternary', 'ternary-goldbach', 1, 'Ternary Goldbach theorem', 'Number theory', 'research_solved', 'Every odd integer greater than five is the sum of three prime numbers.', 'theorem ternaryGoldbach (n : ℕ) (hn : 5 < n) (hn_odd : Odd n) :
    ∃ p q r, Nat.Prime p ∧ Nat.Prime q ∧ Nat.Prime r ∧ n = p + q + r := by
  sorry', 'imported_unreviewed', 'admitted', 84);
--> statement-breakpoint
INSERT OR IGNORE INTO declarations (
    id, problem_revision_id, qualified_name, declaration_kind,
    source_path, source_url, source_line_start, source_line_end,
    source_content_hash, is_primary
  ) VALUES
  ('declaration:formal-conjectures:goldbach', 'problem-revision:formal-conjectures:goldbach:main:1', 'GoldbachConjecture.goldbach', 'theorem', 'FormalConjectures/Wikipedia/GoldbachConjecture.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Wikipedia/GoldbachConjecture.lean#L33-L34', 33, 34, 'sha256:bf6a587c50ba159af919fbe9afa09f04375608c33c68361ffc52246018a5b447', 1),
  ('declaration:formal-conjectures:goldbach-ternary', 'problem-revision:formal-conjectures:goldbach:ternary:1', 'TernaryGoldbachConjecture.ternaryGoldbach', 'theorem', 'FormalConjectures/Wikipedia/GoldbachConjecture.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Wikipedia/GoldbachConjecture.lean#L49-L50', 49, 50, 'sha256:bf6a587c50ba159af919fbe9afa09f04375608c33c68361ffc52246018a5b447', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
  VALUES   ('project:formal-conjectures:collatz', 'formal-conjectures-collatz', 'frontier', 'Collatz Conjecture', 'The elementary-looking iteration problem is presented as a long-horizon target for formal lemmas, finite checks, and structural reductions.', 'public');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_revisions (
    id, project_id, source_snapshot_id, target_key, slug,
    revision_number, title, domain, research_status, informal_statement,
    lean_statement, source_correspondence, proof_state, priority
  ) VALUES
  ('problem-revision:formal-conjectures:collatz:main:1', 'project:formal-conjectures:collatz', 'snapshot:formal-conjectures:focus-v1-lean4.27.0', 'collatz-main', 'collatz-conjecture', 1, 'Collatz Conjecture', 'Number theory', 'research_open', 'Starting from any positive integer, repeated Collatz steps eventually reach one.', 'theorem collatz_conjecture (n : ℕ) (hn : n > 0) : ∃ m, collatzStep^[m] n = 1 := by
  sorry', 'imported_unreviewed', 'admitted', 93);
--> statement-breakpoint
INSERT OR IGNORE INTO declarations (
    id, problem_revision_id, qualified_name, declaration_kind,
    source_path, source_url, source_line_start, source_line_end,
    source_content_hash, is_primary
  ) VALUES
  ('declaration:formal-conjectures:collatz', 'problem-revision:formal-conjectures:collatz:main:1', 'CollatzConjecture.collatz_conjecture', 'theorem', 'FormalConjectures/Wikipedia/CollatzConjecture.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Wikipedia/CollatzConjecture.lean#L50-L50', 50, 50, 'sha256:555bd737d758ee380f6073b794594d53994b21c597fcd931373e727cb73226ea', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
  VALUES   ('project:formal-conjectures:twin-primes', 'formal-conjectures-twin-primes', 'frontier', 'Twin Prime Conjecture', 'The conjecture predicts infinitely many prime pairs separated by two.', 'public');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_revisions (
    id, project_id, source_snapshot_id, target_key, slug,
    revision_number, title, domain, research_status, informal_statement,
    lean_statement, source_correspondence, proof_state, priority
  ) VALUES
  ('problem-revision:formal-conjectures:twin-primes:main:1', 'project:formal-conjectures:twin-primes', 'snapshot:formal-conjectures:focus-v1-lean4.27.0', 'twin-primes-main', 'twin-prime-conjecture', 1, 'Twin Prime Conjecture', 'Number theory', 'research_open', 'There are infinitely many prime numbers p such that p + 2 is also prime.', 'theorem twin_primes :
    answer(sorry) ↔ {p : ℕ | Prime p ∧ Prime (p + 2)}.Infinite := by
  sorry', 'imported_unreviewed', 'admitted', 92);
--> statement-breakpoint
INSERT OR IGNORE INTO declarations (
    id, problem_revision_id, qualified_name, declaration_kind,
    source_path, source_url, source_line_start, source_line_end,
    source_content_hash, is_primary
  ) VALUES
  ('declaration:formal-conjectures:twin-primes', 'problem-revision:formal-conjectures:twin-primes:main:1', 'TwinPrimes.twin_primes', 'theorem', 'FormalConjectures/Wikipedia/TwinPrimes.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Wikipedia/TwinPrimes.lean#L34-L35', 34, 35, 'sha256:e947e40aad99026f3a3efc00d958194aa3ef284b92b6e161f2bde9856e7a77ab', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
  VALUES   ('project:formal-conjectures:riemann-hypothesis', 'formal-conjectures-riemann-hypothesis', 'frontier', 'Riemann Hypothesis', 'The formal target packages the classical assertion about nontrivial zeros of the Riemann zeta function.', 'public');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_revisions (
    id, project_id, source_snapshot_id, target_key, slug,
    revision_number, title, domain, research_status, informal_statement,
    lean_statement, source_correspondence, proof_state, priority
  ) VALUES
  ('problem-revision:formal-conjectures:riemann-hypothesis:main:1', 'project:formal-conjectures:riemann-hypothesis', 'snapshot:formal-conjectures:focus-v1-lean4.27.0', 'riemann-hypothesis-main', 'riemann-hypothesis', 1, 'Riemann Hypothesis', 'Number theory', 'research_open', 'Every nontrivial zero of the Riemann zeta function has real part one half.', 'theorem riemannHypothesis : RiemannHypothesis := by
  sorry', 'imported_unreviewed', 'admitted', 91);
--> statement-breakpoint
INSERT OR IGNORE INTO declarations (
    id, problem_revision_id, qualified_name, declaration_kind,
    source_path, source_url, source_line_start, source_line_end,
    source_content_hash, is_primary
  ) VALUES
  ('declaration:formal-conjectures:riemann-hypothesis', 'problem-revision:formal-conjectures:riemann-hypothesis:main:1', 'RiemannHypothesis.riemannHypothesis', 'theorem', 'FormalConjectures/Millenium/RiemannHypothesis.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Millenium/RiemannHypothesis.lean#L58-L58', 58, 58, 'sha256:31bc68fe45cd4bd1a896e71da6b7bd7459a18572a7d85878b66ddd15adb0130c', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
  VALUES   ('project:formal-conjectures:navier-stokes', 'formal-conjectures-navier-stokes', 'frontier', 'Navier–Stokes Existence and Smoothness', 'The catalog pins the three-dimensional whole-space existence and smoothness formulation from the upstream Millennium problem formalization.', 'public');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_revisions (
    id, project_id, source_snapshot_id, target_key, slug,
    revision_number, title, domain, research_status, informal_statement,
    lean_statement, source_correspondence, proof_state, priority
  ) VALUES
  ('problem-revision:formal-conjectures:navier-stokes:r3:1', 'project:formal-conjectures:navier-stokes', 'snapshot:formal-conjectures:focus-v1-lean4.27.0', 'navier-stokes-r3', 'navier-stokes-r3', 1, 'Navier–Stokes existence and smoothness in ℝ³', 'Partial differential equations', 'research_open', 'For positive viscosity and suitably decaying smooth initial velocity in three dimensions, a global smooth Navier–Stokes solution exists.', 'theorem navier_stokes_existence_and_smoothness_R3 (nu : ℝ) (hnu : nu > 0)
    (u₀ : ℝ³ → ℝ³) (hu₀ : InitialVelocityConditionDecay u₀) :
    ∃ v p, NavierStokesExistenceAndSmoothnessRn nu u₀ (f := 0) v p := by
  sorry', 'imported_unreviewed', 'admitted', 90);
--> statement-breakpoint
INSERT OR IGNORE INTO declarations (
    id, problem_revision_id, qualified_name, declaration_kind,
    source_path, source_url, source_line_start, source_line_end,
    source_content_hash, is_primary
  ) VALUES
  ('declaration:formal-conjectures:navier-stokes-r3', 'problem-revision:formal-conjectures:navier-stokes:r3:1', 'NavierStokes.navier_stokes_existence_and_smoothness_R3', 'theorem', 'FormalConjectures/Millenium/NavierStokes.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Millenium/NavierStokes.lean#L266-L268', 266, 268, 'sha256:259d2ed5dd042c6140c90f74d9471e382909b37b7bec79d4a45bf69a2a51cd6d', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
  VALUES   ('project:formal-conjectures:jacobian', 'formal-conjectures-jacobian', 'frontier', 'Jacobian Conjecture', 'The polynomial inverse problem is pinned as an algebraic-geometry target with its exact upstream Lean environment.', 'public');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_revisions (
    id, project_id, source_snapshot_id, target_key, slug,
    revision_number, title, domain, research_status, informal_statement,
    lean_statement, source_correspondence, proof_state, priority
  ) VALUES
  ('problem-revision:formal-conjectures:jacobian:main:1', 'project:formal-conjectures:jacobian', 'snapshot:formal-conjectures:focus-v1-lean4.27.0', 'jacobian-main', 'jacobian-conjecture', 1, 'Jacobian Conjecture', 'Algebraic geometry', 'research_open', 'A polynomial self-map with invertible constant Jacobian determinant has a polynomial inverse.', 'theorem jacobian_conjecture (F : RegularFunction k σ σ)
    (H : IsUnit F.Jacobian.det) :
    ∃ (G : RegularFunction k σ σ), G.comp F = id k σ ∧
    F.comp G = id k σ := by
  sorry', 'imported_unreviewed', 'admitted', 89);
--> statement-breakpoint
INSERT OR IGNORE INTO declarations (
    id, problem_revision_id, qualified_name, declaration_kind,
    source_path, source_url, source_line_start, source_line_end,
    source_content_hash, is_primary
  ) VALUES
  ('declaration:formal-conjectures:jacobian', 'problem-revision:formal-conjectures:jacobian:main:1', 'JacobianConjecture.jacobian_conjecture', 'theorem', 'FormalConjectures/Wikipedia/JacobianConjecture.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Wikipedia/JacobianConjecture.lean#L72-L75', 72, 75, 'sha256:22a6a801d27ae1a8b225171bbd4a12099c1a5643471273bd8eb11ee206957ced', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO verification_claims (
  id, problem_revision_id, claim_type, status, evidence_url, recorded_at
) VALUES
  ('claim:sunflower-conjecture:bundle', 'problem-revision:formal-conjectures:erdos-20:main:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:sunflower-conjecture:kernel', 'problem-revision:formal-conjectures:erdos-20:main:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:sunflower-conjecture:statement', 'problem-revision:formal-conjectures:erdos-20:main:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:sunflower-conjecture:novelty', 'problem-revision:formal-conjectures:erdos-20:main:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:sunflower-conjecture:accepted', 'problem-revision:formal-conjectures:erdos-20:main:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:sunflower-erdos-rado-bound:bundle', 'problem-revision:formal-conjectures:erdos-20:erdos-rado-bound:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:sunflower-erdos-rado-bound:kernel', 'problem-revision:formal-conjectures:erdos-20:erdos-rado-bound:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:sunflower-erdos-rado-bound:statement', 'problem-revision:formal-conjectures:erdos-20:erdos-rado-bound:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:sunflower-erdos-rado-bound:novelty', 'problem-revision:formal-conjectures:erdos-20:erdos-rado-bound:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:sunflower-erdos-rado-bound:accepted', 'problem-revision:formal-conjectures:erdos-20:erdos-rado-bound:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:hadwiger-nelson:bundle', 'problem-revision:formal-conjectures:erdos-508:main:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:hadwiger-nelson:kernel', 'problem-revision:formal-conjectures:erdos-508:main:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:hadwiger-nelson:statement', 'problem-revision:formal-conjectures:erdos-508:main:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:hadwiger-nelson:novelty', 'problem-revision:formal-conjectures:erdos-508:main:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:hadwiger-nelson:accepted', 'problem-revision:formal-conjectures:erdos-508:main:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:hadwiger-nelson-at-least-five:bundle', 'problem-revision:formal-conjectures:erdos-508:at-least-five:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:hadwiger-nelson-at-least-five:kernel', 'problem-revision:formal-conjectures:erdos-508:at-least-five:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:hadwiger-nelson-at-least-five:statement', 'problem-revision:formal-conjectures:erdos-508:at-least-five:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:hadwiger-nelson-at-least-five:novelty', 'problem-revision:formal-conjectures:erdos-508:at-least-five:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:hadwiger-nelson-at-least-five:accepted', 'problem-revision:formal-conjectures:erdos-508:at-least-five:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:hadwiger-nelson-at-least-four:bundle', 'problem-revision:formal-conjectures:erdos-508:at-least-four:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:hadwiger-nelson-at-least-four:kernel', 'problem-revision:formal-conjectures:erdos-508:at-least-four:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:hadwiger-nelson-at-least-four:statement', 'problem-revision:formal-conjectures:erdos-508:at-least-four:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:hadwiger-nelson-at-least-four:novelty', 'problem-revision:formal-conjectures:erdos-508:at-least-four:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:hadwiger-nelson-at-least-four:accepted', 'problem-revision:formal-conjectures:erdos-508:at-least-four:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:lonely-runner:bundle', 'problem-revision:formal-conjectures:lonely-runner:main:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:lonely-runner:kernel', 'problem-revision:formal-conjectures:lonely-runner:main:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:lonely-runner:statement', 'problem-revision:formal-conjectures:lonely-runner:main:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:lonely-runner:novelty', 'problem-revision:formal-conjectures:lonely-runner:main:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:lonely-runner:accepted', 'problem-revision:formal-conjectures:lonely-runner:main:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:lonely-runner-tao-2017:bundle', 'problem-revision:formal-conjectures:lonely-runner:tao-2017:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:lonely-runner-tao-2017:kernel', 'problem-revision:formal-conjectures:lonely-runner:tao-2017:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:lonely-runner-tao-2017:statement', 'problem-revision:formal-conjectures:lonely-runner:tao-2017:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:lonely-runner-tao-2017:novelty', 'problem-revision:formal-conjectures:lonely-runner:tao-2017:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:lonely-runner-tao-2017:accepted', 'problem-revision:formal-conjectures:lonely-runner:tao-2017:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:kakeya-set-conjecture:bundle', 'problem-revision:formal-conjectures:kakeya:main:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:kakeya-set-conjecture:kernel', 'problem-revision:formal-conjectures:kakeya:main:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:kakeya-set-conjecture:statement', 'problem-revision:formal-conjectures:kakeya:main:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:kakeya-set-conjecture:novelty', 'problem-revision:formal-conjectures:kakeya:main:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:kakeya-set-conjecture:accepted', 'problem-revision:formal-conjectures:kakeya:main:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:kakeya-two-dimensional:bundle', 'problem-revision:formal-conjectures:kakeya:2d:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:kakeya-two-dimensional:kernel', 'problem-revision:formal-conjectures:kakeya:2d:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:kakeya-two-dimensional:statement', 'problem-revision:formal-conjectures:kakeya:2d:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:kakeya-two-dimensional:novelty', 'problem-revision:formal-conjectures:kakeya:2d:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:kakeya-two-dimensional:accepted', 'problem-revision:formal-conjectures:kakeya:2d:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:kakeya-three-dimensional:bundle', 'problem-revision:formal-conjectures:kakeya:3d:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:kakeya-three-dimensional:kernel', 'problem-revision:formal-conjectures:kakeya:3d:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:kakeya-three-dimensional:statement', 'problem-revision:formal-conjectures:kakeya:3d:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:kakeya-three-dimensional:novelty', 'problem-revision:formal-conjectures:kakeya:3d:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:kakeya-three-dimensional:accepted', 'problem-revision:formal-conjectures:kakeya:3d:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:kakeya-finite-field:bundle', 'problem-revision:formal-conjectures:kakeya:finite:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:kakeya-finite-field:kernel', 'problem-revision:formal-conjectures:kakeya:finite:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:kakeya-finite-field:statement', 'problem-revision:formal-conjectures:kakeya:finite:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:kakeya-finite-field:novelty', 'problem-revision:formal-conjectures:kakeya:finite:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:kakeya-finite-field:accepted', 'problem-revision:formal-conjectures:kakeya:finite:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:goldbach-conjecture:bundle', 'problem-revision:formal-conjectures:goldbach:main:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:goldbach-conjecture:kernel', 'problem-revision:formal-conjectures:goldbach:main:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:goldbach-conjecture:statement', 'problem-revision:formal-conjectures:goldbach:main:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:goldbach-conjecture:novelty', 'problem-revision:formal-conjectures:goldbach:main:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:goldbach-conjecture:accepted', 'problem-revision:formal-conjectures:goldbach:main:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:ternary-goldbach:bundle', 'problem-revision:formal-conjectures:goldbach:ternary:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:ternary-goldbach:kernel', 'problem-revision:formal-conjectures:goldbach:ternary:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:ternary-goldbach:statement', 'problem-revision:formal-conjectures:goldbach:ternary:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:ternary-goldbach:novelty', 'problem-revision:formal-conjectures:goldbach:ternary:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:ternary-goldbach:accepted', 'problem-revision:formal-conjectures:goldbach:ternary:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:collatz-conjecture:bundle', 'problem-revision:formal-conjectures:collatz:main:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:collatz-conjecture:kernel', 'problem-revision:formal-conjectures:collatz:main:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:collatz-conjecture:statement', 'problem-revision:formal-conjectures:collatz:main:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:collatz-conjecture:novelty', 'problem-revision:formal-conjectures:collatz:main:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:collatz-conjecture:accepted', 'problem-revision:formal-conjectures:collatz:main:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:twin-prime-conjecture:bundle', 'problem-revision:formal-conjectures:twin-primes:main:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:twin-prime-conjecture:kernel', 'problem-revision:formal-conjectures:twin-primes:main:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:twin-prime-conjecture:statement', 'problem-revision:formal-conjectures:twin-primes:main:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:twin-prime-conjecture:novelty', 'problem-revision:formal-conjectures:twin-primes:main:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:twin-prime-conjecture:accepted', 'problem-revision:formal-conjectures:twin-primes:main:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:riemann-hypothesis:bundle', 'problem-revision:formal-conjectures:riemann-hypothesis:main:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:riemann-hypothesis:kernel', 'problem-revision:formal-conjectures:riemann-hypothesis:main:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:riemann-hypothesis:statement', 'problem-revision:formal-conjectures:riemann-hypothesis:main:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:riemann-hypothesis:novelty', 'problem-revision:formal-conjectures:riemann-hypothesis:main:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:riemann-hypothesis:accepted', 'problem-revision:formal-conjectures:riemann-hypothesis:main:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:navier-stokes-r3:bundle', 'problem-revision:formal-conjectures:navier-stokes:r3:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:navier-stokes-r3:kernel', 'problem-revision:formal-conjectures:navier-stokes:r3:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:navier-stokes-r3:statement', 'problem-revision:formal-conjectures:navier-stokes:r3:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:navier-stokes-r3:novelty', 'problem-revision:formal-conjectures:navier-stokes:r3:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:navier-stokes-r3:accepted', 'problem-revision:formal-conjectures:navier-stokes:r3:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:jacobian-conjecture:bundle', 'problem-revision:formal-conjectures:jacobian:main:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:jacobian-conjecture:kernel', 'problem-revision:formal-conjectures:jacobian:main:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:jacobian-conjecture:statement', 'problem-revision:formal-conjectures:jacobian:main:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:jacobian-conjecture:novelty', 'problem-revision:formal-conjectures:jacobian:main:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:jacobian-conjecture:accepted', 'problem-revision:formal-conjectures:jacobian:main:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_subjects (
  problem_revision_id, subject_id, is_primary
) VALUES
  ('problem-revision:formal-conjectures:erdos-865:main:1', 'subject:ams-11', 1),
  ('problem-revision:formal-conjectures:erdos-865:main:1', 'subject:ams-05', 0),
  ('problem-revision:formal-conjectures:erdos-865:k2:1', 'subject:ams-11', 1),
  ('problem-revision:formal-conjectures:erdos-865:k2:1', 'subject:ams-05', 0),
  ('problem-revision:formal-conjectures:erdos-865:sos:1', 'subject:ams-11', 1),
  ('problem-revision:formal-conjectures:erdos-865:sos:1', 'subject:ams-05', 0),
  ('problem-revision:formal-conjectures:erdos-865:upper-bound:1', 'subject:ams-11', 1),
  ('problem-revision:formal-conjectures:erdos-865:upper-bound:1', 'subject:ams-05', 0),
  ('problem-revision:formal-conjectures:erdos-20:main:1', 'subject:ams-05', 1),
  ('problem-revision:formal-conjectures:erdos-20:erdos-rado-bound:1', 'subject:ams-05', 1),
  ('problem-revision:formal-conjectures:erdos-508:main:1', 'subject:ams-52', 1),
  ('problem-revision:formal-conjectures:erdos-508:at-least-five:1', 'subject:ams-52', 1),
  ('problem-revision:formal-conjectures:erdos-508:at-least-four:1', 'subject:ams-05', 1),
  ('problem-revision:formal-conjectures:lonely-runner:main:1', 'subject:ams-11', 1),
  ('problem-revision:formal-conjectures:lonely-runner:tao-2017:1', 'subject:ams-11', 1),
  ('problem-revision:formal-conjectures:kakeya:main:1', 'subject:ams-42', 1),
  ('problem-revision:formal-conjectures:kakeya:2d:1', 'subject:ams-42', 1),
  ('problem-revision:formal-conjectures:kakeya:3d:1', 'subject:ams-42', 1),
  ('problem-revision:formal-conjectures:kakeya:finite:1', 'subject:ams-52', 1),
  ('problem-revision:formal-conjectures:goldbach:main:1', 'subject:ams-11', 1),
  ('problem-revision:formal-conjectures:goldbach:ternary:1', 'subject:ams-11', 1),
  ('problem-revision:formal-conjectures:collatz:main:1', 'subject:ams-11', 1),
  ('problem-revision:formal-conjectures:collatz:main:1', 'subject:ams-37', 0),
  ('problem-revision:formal-conjectures:twin-primes:main:1', 'subject:ams-11', 1),
  ('problem-revision:formal-conjectures:riemann-hypothesis:main:1', 'subject:ams-11', 1),
  ('problem-revision:formal-conjectures:navier-stokes:r3:1', 'subject:ams-35', 1),
  ('problem-revision:formal-conjectures:jacobian:main:1', 'subject:ams-14', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO catalog_collection_members (
  collection_id, problem_revision_id, role, position
) VALUES
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:erdos-865:main:1', 'headline', 10),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:erdos-865:k2:1', 'milestone', 11),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:erdos-865:sos:1', 'milestone', 12),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:erdos-865:upper-bound:1', 'milestone', 13),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:erdos-20:main:1', 'headline', 20),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:erdos-20:erdos-rado-bound:1', 'milestone', 21),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:erdos-508:main:1', 'headline', 30),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:erdos-508:at-least-five:1', 'milestone', 31),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:erdos-508:at-least-four:1', 'milestone', 32),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:lonely-runner:main:1', 'headline', 40),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:lonely-runner:tao-2017:1', 'milestone', 41),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:kakeya:main:1', 'headline', 50),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:kakeya:2d:1', 'milestone', 51),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:kakeya:3d:1', 'milestone', 52),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:kakeya:finite:1', 'milestone', 53),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:goldbach:main:1', 'headline', 60),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:goldbach:ternary:1', 'milestone', 61),
  ('collection:grand-challenges', 'problem-revision:formal-conjectures:collatz:main:1', 'headline', 10),
  ('collection:grand-challenges', 'problem-revision:formal-conjectures:twin-primes:main:1', 'headline', 20),
  ('collection:grand-challenges', 'problem-revision:formal-conjectures:riemann-hypothesis:main:1', 'headline', 30),
  ('collection:grand-challenges', 'problem-revision:formal-conjectures:navier-stokes:r3:1', 'headline', 40),
  ('collection:grand-challenges', 'problem-revision:formal-conjectures:jacobian:main:1', 'headline', 50);
--> statement-breakpoint
INSERT OR IGNORE INTO catalog_imports (
  id, source_snapshot_id, input_hash, imported_at, record_count
) VALUES   ('import:formal-conjectures:focus-v1-lean4.27.0', 'snapshot:formal-conjectures:focus-v1-lean4.27.0', 'sha256:e70c573b863a748c34600802ab2a0c1a02d8f8afba5dd19d038e3e4f818dd1e6', '2026-07-16T00:00:00Z', 18)
