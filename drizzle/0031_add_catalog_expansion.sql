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
DROP INDEX IF EXISTS source_snapshots_upstream_revision_idx;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS source_snapshots_upstream_revision_idx ON source_snapshots (upstream_name, revision_commit);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS source_snapshots_upstream_revision_manifest_idx ON source_snapshots (upstream_name, revision_commit, manifest_hash);
--> statement-breakpoint
INSERT OR IGNORE INTO source_snapshots (
  id, upstream_name, source_url, revision_tag, revision_commit,
  retrieved_at, content_hash, manifest_hash, source_license,
  lean_toolchain, mathlib_revision
) VALUES   ('snapshot:formal-conjectures:expansion-v1-lean4.27.0', 'Formal Conjectures', 'https://github.com/google-deepmind/formal-conjectures/tree/b2e608fc52d765510915a244bb69b1a2741acc3c', 'curated-expansion-v1-lean4.27.0', 'b2e608fc52d765510915a244bb69b1a2741acc3c', '2026-07-16T00:00:00Z', 'sha256:79c2815173dca37c7d871ec5cb8b552f293a0a7d19795a94e391ab51d641d60a', 'sha256:53a426471ead821a049c80967f2d754c8e856455a02c69eb7f25b0f6bc937660', 'Apache-2.0 source code; upstream materials may carry their own stated terms.', 'leanprover/lean4:v4.27.0', 'a3a10db0e9d66acbebf76c5e6a135066525ac900');
--> statement-breakpoint
INSERT OR IGNORE INTO catalog_subjects (
  id, slug, name, ams_code, description, sort_order
) VALUES
  ('subject:ams-05', 'combinatorics', 'Combinatorics', '05', 'Enumerative, extremal, and structural combinatorics.', 5),
  ('subject:ams-11', 'number-theory', 'Number theory', '11', 'Prime numbers, Diophantine equations, and arithmetic structures.', 11),
  ('subject:ams-20', 'group-theory', 'Group theory', '20', 'Structure, growth, and representations of groups.', 20),
  ('subject:ams-51', 'geometry', 'Geometry', '51', 'Euclidean, incidence, and topological geometry.', 51),
  ('subject:ams-54', 'general-topology', 'General topology', '54', 'Topological spaces, embeddings, and homotopy phenomena.', 54),
  ('subject:ams-57', 'manifolds', 'Manifolds and cell complexes', '57', 'Topological and smooth manifolds, knots, and complexes.', 57),
  ('subject:ams-68', 'computer-science', 'Computer science', '68', 'Complexity, algorithms, and models of computation.', 68);
--> statement-breakpoint
INSERT OR IGNORE INTO catalog_collections (
  id, slug, title, summary, tier, priority, visibility
) VALUES
  ('collection:founding-challenges', 'founding-challenges', 'Founding Challenges', 'Recognizable open questions paired with smaller, known milestones that make a first research Attempt concrete.', 'founding', 100, 'public'),
  ('collection:grand-challenges', 'grand-challenges', 'Grand Challenges', 'Long-horizon problems whose formal statements can anchor reusable lemmas, counterexamples, and independent review.', 'grand', 90, 'public');
--> statement-breakpoint
INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
  VALUES   ('project:formal-conjectures:p-vs-np', 'formal-conjectures-p-vs-np', 'frontier', 'P versus NP', 'The central complexity-theory question is paired with elementary class-inclusion facts that provide concrete Lean milestones before the open separation problem.', 'public');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_revisions (
    id, project_id, source_snapshot_id, target_key, slug,
    revision_number, title, domain, research_status, informal_statement,
    lean_statement, source_correspondence, proof_state, priority
  ) VALUES
  ('problem-revision:formal-conjectures:p-vs-np:main:1', 'project:formal-conjectures:p-vs-np', 'snapshot:formal-conjectures:expansion-v1-lean4.27.0', 'p-vs-np-main', 'p-vs-np', 1, 'P versus NP', 'Computational complexity', 'research_open', 'The deterministic polynomial-time complexity class P is not equal to the nondeterministic polynomial-time class NP.', 'theorem P_ne_NP : P ≠ NP := by
  sorry', 'imported_unreviewed', 'admitted', 99),
  ('problem-revision:formal-conjectures:p-vs-np:cop-eq-p:1', 'project:formal-conjectures:p-vs-np', 'snapshot:formal-conjectures:expansion-v1-lean4.27.0', 'p-vs-np-cop-eq-p', 'complexity-cop-equals-p', 1, 'Complexity classes: coP equals P', 'Computational complexity', 'research_solved', 'The complement of every language in P is also in P.', 'theorem coP_eq_P :
    { L | Lᶜ ∈ P } = P := by
  sorry', 'imported_unreviewed', 'admitted', 82),
  ('problem-revision:formal-conjectures:p-vs-np:p-subset-np:1', 'project:formal-conjectures:p-vs-np', 'snapshot:formal-conjectures:expansion-v1-lean4.27.0', 'p-vs-np-p-subset-np', 'complexity-p-subset-np', 1, 'Complexity classes: P is contained in NP', 'Computational complexity', 'research_solved', 'Every decision problem decidable in deterministic polynomial time also belongs to NP.', 'theorem P_subset_NP :
    P ⊆ NP := by
  sorry', 'imported_unreviewed', 'admitted', 83);
--> statement-breakpoint
INSERT OR IGNORE INTO declarations (
    id, problem_revision_id, qualified_name, declaration_kind,
    source_path, source_url, source_line_start, source_line_end,
    source_content_hash, is_primary
  ) VALUES
  ('declaration:formal-conjectures:p-vs-np', 'problem-revision:formal-conjectures:p-vs-np:main:1', 'ComplexityTheory.P_ne_NP', 'theorem', 'FormalConjectures/Millenium/PvsNP.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Millenium/PvsNP.lean#L90-L90', 90, 90, 'sha256:5af9dc0179ce1d9dd09a8b73e4acecb9d5f1787438f30a3a3c0eb70ef673bdf6', 1),
  ('declaration:formal-conjectures:p-vs-np-cop-eq-p', 'problem-revision:formal-conjectures:p-vs-np:cop-eq-p:1', 'ComplexityTheory.coP_eq_P', 'theorem', 'FormalConjectures/Millenium/PvsNP.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Millenium/PvsNP.lean#L107-L109', 107, 109, 'sha256:5af9dc0179ce1d9dd09a8b73e4acecb9d5f1787438f30a3a3c0eb70ef673bdf6', 1),
  ('declaration:formal-conjectures:p-vs-np-p-subset-np', 'problem-revision:formal-conjectures:p-vs-np:p-subset-np:1', 'ComplexityTheory.P_subset_NP', 'theorem', 'FormalConjectures/Millenium/PvsNP.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Millenium/PvsNP.lean#L119-L121', 119, 121, 'sha256:5af9dc0179ce1d9dd09a8b73e4acecb9d5f1787438f30a3a3c0eb70ef673bdf6', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
  VALUES   ('project:formal-conjectures:poincare', 'formal-conjectures-poincare', 'frontier', 'Poincaré Conjecture and smooth variants', 'The solved three-dimensional topological theorem and the still-open smooth four-dimensional case share a formal vocabulary but must keep their research statuses distinct.', 'public');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_revisions (
    id, project_id, source_snapshot_id, target_key, slug,
    revision_number, title, domain, research_status, informal_statement,
    lean_statement, source_correspondence, proof_state, priority
  ) VALUES
  ('problem-revision:formal-conjectures:poincare:smooth-dimension-four:1', 'project:formal-conjectures:poincare', 'snapshot:formal-conjectures:expansion-v1-lean4.27.0', 'poincare-smooth-dimension-four', 'smooth-poincare-dimension-four', 1, 'Smooth Poincaré conjecture in dimension four', 'Geometric topology', 'research_open', 'Every smooth four-manifold homotopy equivalent to the four-sphere is diffeomorphic to the four-sphere.', 'theorem poincare_conjecture.variants.smooth_dimension_four : SmoothConjectureFor 4 := by
  sorry', 'imported_unreviewed', 'admitted', 95),
  ('problem-revision:formal-conjectures:poincare:dimension-three:1', 'project:formal-conjectures:poincare', 'snapshot:formal-conjectures:expansion-v1-lean4.27.0', 'poincare-dimension-three', 'poincare-conjecture-dimension-three', 1, 'Poincaré conjecture in dimension three', 'Geometric topology', 'research_solved', 'A three-dimensional manifold homotopy equivalent to the three-sphere is homeomorphic to the three-sphere.', 'theorem poincare_conjecture : ConjectureFor 3 := by
  sorry', 'imported_unreviewed', 'admitted', 93);
--> statement-breakpoint
INSERT OR IGNORE INTO declarations (
    id, problem_revision_id, qualified_name, declaration_kind,
    source_path, source_url, source_line_start, source_line_end,
    source_content_hash, is_primary
  ) VALUES
  ('declaration:formal-conjectures:poincare-smooth-four', 'problem-revision:formal-conjectures:poincare:smooth-dimension-four:1', 'PoincareConjecture.poincare_conjecture.variants.smooth_dimension_four', 'theorem', 'FormalConjectures/Millenium/Poincare.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Millenium/Poincare.lean#L101-L102', 101, 102, 'sha256:8c9e44bb2b7fc0a89a7a9198e87e0ca9c4dc35fefd10d3686fa201e28cb6ffe2', 1),
  ('declaration:formal-conjectures:poincare-three', 'problem-revision:formal-conjectures:poincare:dimension-three:1', 'PoincareConjecture.poincare_conjecture', 'theorem', 'FormalConjectures/Millenium/Poincare.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Millenium/Poincare.lean#L47-L48', 47, 48, 'sha256:8c9e44bb2b7fc0a89a7a9198e87e0ca9c4dc35fefd10d3686fa201e28cb6ffe2', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
  VALUES   ('project:formal-conjectures:legendre', 'formal-conjectures-legendre', 'frontier', 'Legendre''s Conjecture', 'The conjecture about a prime between consecutive squares is paired with a sufficiently-large-n theorem as a more bounded formalization target.', 'public');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_revisions (
    id, project_id, source_snapshot_id, target_key, slug,
    revision_number, title, domain, research_status, informal_statement,
    lean_statement, source_correspondence, proof_state, priority
  ) VALUES
  ('problem-revision:formal-conjectures:legendre:main:1', 'project:formal-conjectures:legendre', 'snapshot:formal-conjectures:expansion-v1-lean4.27.0', 'legendre-main', 'legendre-conjecture', 1, 'Legendre''s Conjecture', 'Number theory', 'research_open', 'For every positive integer n, there is a prime strictly between n² and (n + 1)².', 'theorem legendre_conjecture :
    answer(sorry) ↔ ∀ n ≥ 1, ∃ p ∈ Set.Ioo (n ^ 2) ((n + 1) ^ 2), Nat.Prime p := by
  sorry', 'imported_unreviewed', 'admitted', 94),
  ('problem-revision:formal-conjectures:legendre:large-n:1', 'project:formal-conjectures:legendre', 'snapshot:formal-conjectures:expansion-v1-lean4.27.0', 'legendre-large-n', 'legendre-sufficiently-large-n', 1, 'Legendre''s conjecture for sufficiently large n', 'Number theory', 'research_solved', 'For all sufficiently large n, a prime exists strictly between n² and (n + 1)².', 'theorem legendre_conjecture.ferreira_large_n :
    ∀ᶠ n in atTop, ∃ p ∈ Set.Ioo (n ^ 2) ((n + 1) ^ 2), Nat.Prime p := by
  sorry', 'imported_unreviewed', 'admitted', 86);
--> statement-breakpoint
INSERT OR IGNORE INTO declarations (
    id, problem_revision_id, qualified_name, declaration_kind,
    source_path, source_url, source_line_start, source_line_end,
    source_content_hash, is_primary
  ) VALUES
  ('declaration:formal-conjectures:legendre', 'problem-revision:formal-conjectures:legendre:main:1', 'LegendreConjecture.legendre_conjecture', 'theorem', 'FormalConjectures/Wikipedia/LegendreConjecture.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Wikipedia/LegendreConjecture.lean#L34-L36', 34, 36, 'sha256:c7ec74fb1e28040c870d64d01bd52d7ff85d812475e211e53d604bc809b3c577', 1),
  ('declaration:formal-conjectures:legendre-large-n', 'problem-revision:formal-conjectures:legendre:large-n:1', 'LegendreConjecture.legendre_conjecture.ferreira_large_n', 'theorem', 'FormalConjectures/Wikipedia/LegendreConjecture.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Wikipedia/LegendreConjecture.lean#L56-L58', 56, 58, 'sha256:c7ec74fb1e28040c870d64d01bd52d7ff85d812475e211e53d604bc809b3c577', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
  VALUES   ('project:formal-conjectures:inscribed-square', 'formal-conjectures-inscribed-square', 'frontier', 'Inscribed Square Problem', 'The open square-peg problem is paired with known rectangle and smooth-curve cases, creating a natural ladder from geometry definitions to stronger theorems.', 'public');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_revisions (
    id, project_id, source_snapshot_id, target_key, slug,
    revision_number, title, domain, research_status, informal_statement,
    lean_statement, source_correspondence, proof_state, priority
  ) VALUES
  ('problem-revision:formal-conjectures:inscribed-square:main:1', 'project:formal-conjectures:inscribed-square', 'snapshot:formal-conjectures:expansion-v1-lean4.27.0', 'inscribed-square-main', 'inscribed-square-problem', 1, 'Inscribed Square Problem', 'Geometry', 'research_open', 'Every Jordan curve in the plane contains four points that are the vertices of a square.', 'theorem inscribed_square_problem :
    answer(sorry) ↔ ∀ (γ : Circle → ℝ²) (hγ : IsEmbedding γ),
      ∃ t₁ t₂ t₃ t₄, IsRectangle (γ t₁) (γ t₂) (γ t₃) (γ t₄) 1 := by
  sorry', 'imported_unreviewed', 'admitted', 92),
  ('problem-revision:formal-conjectures:inscribed-square:rectangle:1', 'project:formal-conjectures:inscribed-square', 'snapshot:formal-conjectures:expansion-v1-lean4.27.0', 'inscribed-square-rectangle', 'jordan-curve-inscribed-rectangle', 1, 'Every Jordan curve has an inscribed rectangle', 'Geometry', 'research_solved', 'Every Jordan curve admits at least one nondegenerate inscribed rectangle.', 'theorem exists_inscribed_rectangle (γ : Circle → ℝ²) (hγ : IsEmbedding γ) :
    ∃ t₁ t₂ t₃ t₄ r, IsRectangle (γ t₁) (γ t₂) (γ t₃) (γ t₄) r := by
  sorry', 'imported_unreviewed', 'admitted', 80),
  ('problem-revision:formal-conjectures:inscribed-square:c2:1', 'project:formal-conjectures:inscribed-square', 'snapshot:formal-conjectures:expansion-v1-lean4.27.0', 'inscribed-square-c2', 'inscribed-square-c2-curves', 1, 'Inscribed squares for C² Jordan curves', 'Geometry', 'research_solved', 'Every twice continuously differentiable Jordan curve in the plane admits an inscribed square.', 'theorem exists_inscribed_square_of_C2 (γ : Circle → ℝ²)
    (hγ : IsEmbedding γ) (hγ'' : ContMDiff (𝓡 1) (𝓡 2) 2 γ) :
    ∃ t₁ t₂ t₃ t₄, IsRectangle (γ t₁) (γ t₂) (γ t₃) (γ t₄) 1 := by
  sorry', 'imported_unreviewed', 'admitted', 84);
--> statement-breakpoint
INSERT OR IGNORE INTO declarations (
    id, problem_revision_id, qualified_name, declaration_kind,
    source_path, source_url, source_line_start, source_line_end,
    source_content_hash, is_primary
  ) VALUES
  ('declaration:formal-conjectures:inscribed-square', 'problem-revision:formal-conjectures:inscribed-square:main:1', 'InscribedSquare.inscribed_square_problem', 'theorem', 'FormalConjectures/Wikipedia/InscribedSquare.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Wikipedia/InscribedSquare.lean#L54-L57', 54, 57, 'sha256:42b9c274d20d5da0d319babdf41ebaea19de86e8df570bde2078227c5bca2d3a', 1),
  ('declaration:formal-conjectures:inscribed-rectangle', 'problem-revision:formal-conjectures:inscribed-square:rectangle:1', 'InscribedSquare.exists_inscribed_rectangle', 'theorem', 'FormalConjectures/Wikipedia/InscribedSquare.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Wikipedia/InscribedSquare.lean#L73-L75', 73, 75, 'sha256:42b9c274d20d5da0d319babdf41ebaea19de86e8df570bde2078227c5bca2d3a', 1),
  ('declaration:formal-conjectures:inscribed-square-c2', 'problem-revision:formal-conjectures:inscribed-square:c2:1', 'InscribedSquare.exists_inscribed_square_of_C2', 'theorem', 'FormalConjectures/Wikipedia/InscribedSquare.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Wikipedia/InscribedSquare.lean#L90-L93', 90, 93, 'sha256:42b9c274d20d5da0d319babdf41ebaea19de86e8df570bde2078227c5bca2d3a', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
  VALUES   ('project:formal-conjectures:beal', 'formal-conjectures-beal', 'frontier', 'Beal Conjecture', 'A generalized Fermat-type equation asking whether every solution with exponents greater than two forces a common prime factor.', 'public');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_revisions (
    id, project_id, source_snapshot_id, target_key, slug,
    revision_number, title, domain, research_status, informal_statement,
    lean_statement, source_correspondence, proof_state, priority
  ) VALUES
  ('problem-revision:formal-conjectures:beal:main:1', 'project:formal-conjectures:beal', 'snapshot:formal-conjectures:expansion-v1-lean4.27.0', 'beal-main', 'beal-conjecture', 1, 'Beal Conjecture', 'Number theory', 'research_open', 'If Aˣ + Bʸ = Cᶻ for positive integers with x, y, z greater than two, then A, B, and C share a common prime factor.', 'theorem beal_conjecture : bealConjecture := by
  sorry', 'imported_unreviewed', 'admitted', 91);
--> statement-breakpoint
INSERT OR IGNORE INTO declarations (
    id, problem_revision_id, qualified_name, declaration_kind,
    source_path, source_url, source_line_start, source_line_end,
    source_content_hash, is_primary
  ) VALUES
  ('declaration:formal-conjectures:beal', 'problem-revision:formal-conjectures:beal:main:1', 'BealConjecture.beal_conjecture', 'theorem', 'FormalConjectures/Wikipedia/BealConjecture.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Wikipedia/BealConjecture.lean#L36-L37', 36, 37, 'sha256:f46a9c09eb9d26be34b45f8b28cb002ec5a31c1a9da9b83f6290b826a8777fa4', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
  VALUES   ('project:formal-conjectures:perfect-cuboid', 'formal-conjectures-perfect-cuboid', 'frontier', 'Perfect Cuboid Problem', 'The problem asks whether a rectangular box can have integer edges, all three integer face diagonals, and an integer space diagonal.', 'public');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_revisions (
    id, project_id, source_snapshot_id, target_key, slug,
    revision_number, title, domain, research_status, informal_statement,
    lean_statement, source_correspondence, proof_state, priority
  ) VALUES
  ('problem-revision:formal-conjectures:perfect-cuboid:main:1', 'project:formal-conjectures:perfect-cuboid', 'snapshot:formal-conjectures:expansion-v1-lean4.27.0', 'perfect-cuboid-main', 'perfect-cuboid-problem', 1, 'Perfect Cuboid Problem', 'Diophantine equations', 'research_open', 'There exists a rectangular cuboid whose edges, face diagonals, and space diagonal all have positive integer lengths.', 'theorem perfect_euler_brick_existence :
    answer(sorry) ↔ ∃ a b c : ℕ+, IsPerfectCuboid a b c := by
  sorry', 'imported_unreviewed', 'admitted', 90);
--> statement-breakpoint
INSERT OR IGNORE INTO declarations (
    id, problem_revision_id, qualified_name, declaration_kind,
    source_path, source_url, source_line_start, source_line_end,
    source_content_hash, is_primary
  ) VALUES
  ('declaration:formal-conjectures:perfect-cuboid', 'problem-revision:formal-conjectures:perfect-cuboid:main:1', 'EulerBrick.perfect_euler_brick_existence', 'theorem', 'FormalConjectures/Wikipedia/EulerBrick.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Wikipedia/EulerBrick.lean#L51-L53', 51, 53, 'sha256:1cabe26d55fe93bc808f2c5fcbb12cbd78e3e497a3e33ef510df29edb9a2e67b', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
  VALUES   ('project:formal-conjectures:graceful-tree', 'formal-conjectures-graceful-tree', 'frontier', 'Graceful Tree Conjecture', 'The Ringel–Kotzig conjecture asks for a graceful labeling of every finite tree, with a statement built directly on Mathlib''s finite graph structures.', 'public');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_revisions (
    id, project_id, source_snapshot_id, target_key, slug,
    revision_number, title, domain, research_status, informal_statement,
    lean_statement, source_correspondence, proof_state, priority
  ) VALUES
  ('problem-revision:formal-conjectures:graceful-tree:main:1', 'project:formal-conjectures:graceful-tree', 'snapshot:formal-conjectures:expansion-v1-lean4.27.0', 'graceful-tree-main', 'graceful-tree-conjecture', 1, 'Graceful Tree Conjecture', 'Graph theory', 'research_open', 'Every finite tree admits an injective vertex labeling whose edge-label differences are exactly the integers from one through the number of edges.', 'theorem graceful_tree_conjecture {V : Type*} [Fintype V] [DecidableEq V]
    (T : SimpleGraph V) [DecidableRel T.Adj] (hT : T.IsTree) :
    let m := T.edgeFinset.card
    ∃ f : V → ℕ,
      Function.Injective f ∧
      (∀ v, f v ≤ m) ∧
      T.edgeFinset.image (fun e =>
        e.lift ⟨fun u v => Int.natAbs ((f u : ℤ) - (f v : ℤ)),
                fun u v => by
                  show ((f u : ℤ) - f v).natAbs = ((f v : ℤ) - f u).natAbs
                  rw [← Int.natAbs_neg, neg_sub]⟩) = Finset.Icc 1 m := by
  sorry', 'imported_unreviewed', 'admitted', 89);
--> statement-breakpoint
INSERT OR IGNORE INTO declarations (
    id, problem_revision_id, qualified_name, declaration_kind,
    source_path, source_url, source_line_start, source_line_end,
    source_content_hash, is_primary
  ) VALUES
  ('declaration:formal-conjectures:graceful-tree', 'problem-revision:formal-conjectures:graceful-tree:main:1', 'GracefulLabeling.graceful_tree_conjecture', 'theorem', 'FormalConjectures/Wikipedia/GracefulLabeling.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Wikipedia/GracefulLabeling.lean#L74-L85', 74, 85, 'sha256:0fdacd321606e048d2c30042349915ca19d154ec8801684e4552b8b998655c3f', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
  VALUES   ('project:formal-conjectures:catalan', 'formal-conjectures-catalan', 'frontier', 'Catalan–Mihăilescu Theorem', 'A landmark solved Diophantine theorem whose compact statement conceals substantial mathematical depth and remains an ambitious Lean formalization target.', 'public');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_revisions (
    id, project_id, source_snapshot_id, target_key, slug,
    revision_number, title, domain, research_status, informal_statement,
    lean_statement, source_correspondence, proof_state, priority
  ) VALUES
  ('problem-revision:formal-conjectures:catalan:main:1', 'project:formal-conjectures:catalan', 'snapshot:formal-conjectures:expansion-v1-lean4.27.0', 'catalan-main', 'catalan-mihailescu-theorem', 1, 'Catalan–Mihăilescu Theorem', 'Number theory', 'research_solved', 'The only consecutive positive perfect powers with exponents greater than one are 8 and 9.', 'theorem catalans_conjecture (a b x y : ℕ) (ha : 1 < a) (hb : 1 < b) (hx : 0 < x) (hy : 0 < y)
    (heq : x ^ a - y ^ b = 1) : a = 2 ∧ b = 3 ∧ x = 3 ∧ y = 2 := by
  sorry', 'imported_unreviewed', 'admitted', 88);
--> statement-breakpoint
INSERT OR IGNORE INTO declarations (
    id, problem_revision_id, qualified_name, declaration_kind,
    source_path, source_url, source_line_start, source_line_end,
    source_content_hash, is_primary
  ) VALUES
  ('declaration:formal-conjectures:catalan', 'problem-revision:formal-conjectures:catalan:main:1', 'Catalan.catalans_conjecture', 'theorem', 'FormalConjectures/Wikipedia/Catalan.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Wikipedia/Catalan.lean#L34-L36', 34, 36, 'sha256:4d6a944a1cec1df6928207be2cdf44ad0b1e7bdc89263f9812fc93037f6b152c', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
  VALUES   ('project:formal-conjectures:modularity', 'formal-conjectures-modularity', 'frontier', 'Modularity Theorem', 'The former Taniyama–Shimura–Weil conjecture is now a theorem, but a complete Lean proof would require a deep reusable arithmetic-geometry stack.', 'public');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_revisions (
    id, project_id, source_snapshot_id, target_key, slug,
    revision_number, title, domain, research_status, informal_statement,
    lean_statement, source_correspondence, proof_state, priority
  ) VALUES
  ('problem-revision:formal-conjectures:modularity:main:1', 'project:formal-conjectures:modularity', 'snapshot:formal-conjectures:expansion-v1-lean4.27.0', 'modularity-main', 'modularity-theorem', 1, 'Modularity Theorem', 'Arithmetic geometry', 'research_solved', 'Every elliptic curve over the rational numbers is modular.', 'theorem modularity_conjecture (E : WeierstrassCurve ℚ) [E.IsElliptic] : modularityConjecture E := by
  sorry', 'imported_unreviewed', 'admitted', 87);
--> statement-breakpoint
INSERT OR IGNORE INTO declarations (
    id, problem_revision_id, qualified_name, declaration_kind,
    source_path, source_url, source_line_start, source_line_end,
    source_content_hash, is_primary
  ) VALUES
  ('declaration:formal-conjectures:modularity', 'problem-revision:formal-conjectures:modularity:main:1', 'ModularityConjecture.modularity_conjecture', 'theorem', 'FormalConjectures/Wikipedia/ModularityConjecture.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Wikipedia/ModularityConjecture.lean#L90-L91', 90, 91, 'sha256:4124eaa034c34448e6c3a68ca9c6d39743f193de49aabf9a75fdebb88ebf6137', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
  VALUES   ('project:formal-conjectures:gromov-growth', 'formal-conjectures-gromov-growth', 'frontier', 'Gromov''s Polynomial Growth Theorem', 'A solved structural theorem connecting geometric growth of finitely generated groups with virtual nilpotence, offered as a major Lean library milestone.', 'public');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_revisions (
    id, project_id, source_snapshot_id, target_key, slug,
    revision_number, title, domain, research_status, informal_statement,
    lean_statement, source_correspondence, proof_state, priority
  ) VALUES
  ('problem-revision:formal-conjectures:gromov-growth:main:1', 'project:formal-conjectures:gromov-growth', 'snapshot:formal-conjectures:expansion-v1-lean4.27.0', 'gromov-growth-main', 'gromov-polynomial-growth-theorem', 1, 'Gromov''s Polynomial Growth Theorem', 'Geometric group theory', 'research_solved', 'A finitely generated group has polynomial growth if and only if it is virtually nilpotent.', 'theorem GromovPolynomialGrowthTheorem [Group.FG G] :
    HasPolynomialGrowth G ↔ Group.IsVirtuallyNilpotent G := by
  sorry', 'imported_unreviewed', 'admitted', 85);
--> statement-breakpoint
INSERT OR IGNORE INTO declarations (
    id, problem_revision_id, qualified_name, declaration_kind,
    source_path, source_url, source_line_start, source_line_end,
    source_content_hash, is_primary
  ) VALUES
  ('declaration:formal-conjectures:gromov-growth', 'problem-revision:formal-conjectures:gromov-growth:main:1', 'GromovPolynomialGrowth.GromovPolynomialGrowthTheorem', 'theorem', 'FormalConjectures/Wikipedia/GromovPolynomialGrowth.lean', 'https://github.com/google-deepmind/formal-conjectures/blob/b2e608fc52d765510915a244bb69b1a2741acc3c/FormalConjectures/Wikipedia/GromovPolynomialGrowth.lean#L58-L60', 58, 60, 'sha256:f39b958b0257f05420868a1722ca5a54222abfc3155553bbee902e824508c0f4', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO verification_claims (
  id, problem_revision_id, claim_type, status, evidence_url, recorded_at
) VALUES
  ('claim:p-vs-np:bundle', 'problem-revision:formal-conjectures:p-vs-np:main:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:p-vs-np:kernel', 'problem-revision:formal-conjectures:p-vs-np:main:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:p-vs-np:statement', 'problem-revision:formal-conjectures:p-vs-np:main:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:p-vs-np:novelty', 'problem-revision:formal-conjectures:p-vs-np:main:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:p-vs-np:accepted', 'problem-revision:formal-conjectures:p-vs-np:main:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:complexity-cop-equals-p:bundle', 'problem-revision:formal-conjectures:p-vs-np:cop-eq-p:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:complexity-cop-equals-p:kernel', 'problem-revision:formal-conjectures:p-vs-np:cop-eq-p:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:complexity-cop-equals-p:statement', 'problem-revision:formal-conjectures:p-vs-np:cop-eq-p:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:complexity-cop-equals-p:novelty', 'problem-revision:formal-conjectures:p-vs-np:cop-eq-p:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:complexity-cop-equals-p:accepted', 'problem-revision:formal-conjectures:p-vs-np:cop-eq-p:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:complexity-p-subset-np:bundle', 'problem-revision:formal-conjectures:p-vs-np:p-subset-np:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:complexity-p-subset-np:kernel', 'problem-revision:formal-conjectures:p-vs-np:p-subset-np:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:complexity-p-subset-np:statement', 'problem-revision:formal-conjectures:p-vs-np:p-subset-np:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:complexity-p-subset-np:novelty', 'problem-revision:formal-conjectures:p-vs-np:p-subset-np:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:complexity-p-subset-np:accepted', 'problem-revision:formal-conjectures:p-vs-np:p-subset-np:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:smooth-poincare-dimension-four:bundle', 'problem-revision:formal-conjectures:poincare:smooth-dimension-four:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:smooth-poincare-dimension-four:kernel', 'problem-revision:formal-conjectures:poincare:smooth-dimension-four:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:smooth-poincare-dimension-four:statement', 'problem-revision:formal-conjectures:poincare:smooth-dimension-four:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:smooth-poincare-dimension-four:novelty', 'problem-revision:formal-conjectures:poincare:smooth-dimension-four:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:smooth-poincare-dimension-four:accepted', 'problem-revision:formal-conjectures:poincare:smooth-dimension-four:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:poincare-conjecture-dimension-three:bundle', 'problem-revision:formal-conjectures:poincare:dimension-three:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:poincare-conjecture-dimension-three:kernel', 'problem-revision:formal-conjectures:poincare:dimension-three:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:poincare-conjecture-dimension-three:statement', 'problem-revision:formal-conjectures:poincare:dimension-three:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:poincare-conjecture-dimension-three:novelty', 'problem-revision:formal-conjectures:poincare:dimension-three:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:poincare-conjecture-dimension-three:accepted', 'problem-revision:formal-conjectures:poincare:dimension-three:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:legendre-conjecture:bundle', 'problem-revision:formal-conjectures:legendre:main:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:legendre-conjecture:kernel', 'problem-revision:formal-conjectures:legendre:main:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:legendre-conjecture:statement', 'problem-revision:formal-conjectures:legendre:main:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:legendre-conjecture:novelty', 'problem-revision:formal-conjectures:legendre:main:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:legendre-conjecture:accepted', 'problem-revision:formal-conjectures:legendre:main:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:legendre-sufficiently-large-n:bundle', 'problem-revision:formal-conjectures:legendre:large-n:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:legendre-sufficiently-large-n:kernel', 'problem-revision:formal-conjectures:legendre:large-n:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:legendre-sufficiently-large-n:statement', 'problem-revision:formal-conjectures:legendre:large-n:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:legendre-sufficiently-large-n:novelty', 'problem-revision:formal-conjectures:legendre:large-n:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:legendre-sufficiently-large-n:accepted', 'problem-revision:formal-conjectures:legendre:large-n:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:inscribed-square-problem:bundle', 'problem-revision:formal-conjectures:inscribed-square:main:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:inscribed-square-problem:kernel', 'problem-revision:formal-conjectures:inscribed-square:main:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:inscribed-square-problem:statement', 'problem-revision:formal-conjectures:inscribed-square:main:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:inscribed-square-problem:novelty', 'problem-revision:formal-conjectures:inscribed-square:main:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:inscribed-square-problem:accepted', 'problem-revision:formal-conjectures:inscribed-square:main:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:jordan-curve-inscribed-rectangle:bundle', 'problem-revision:formal-conjectures:inscribed-square:rectangle:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:jordan-curve-inscribed-rectangle:kernel', 'problem-revision:formal-conjectures:inscribed-square:rectangle:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:jordan-curve-inscribed-rectangle:statement', 'problem-revision:formal-conjectures:inscribed-square:rectangle:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:jordan-curve-inscribed-rectangle:novelty', 'problem-revision:formal-conjectures:inscribed-square:rectangle:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:jordan-curve-inscribed-rectangle:accepted', 'problem-revision:formal-conjectures:inscribed-square:rectangle:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:inscribed-square-c2-curves:bundle', 'problem-revision:formal-conjectures:inscribed-square:c2:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:inscribed-square-c2-curves:kernel', 'problem-revision:formal-conjectures:inscribed-square:c2:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:inscribed-square-c2-curves:statement', 'problem-revision:formal-conjectures:inscribed-square:c2:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:inscribed-square-c2-curves:novelty', 'problem-revision:formal-conjectures:inscribed-square:c2:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:inscribed-square-c2-curves:accepted', 'problem-revision:formal-conjectures:inscribed-square:c2:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:beal-conjecture:bundle', 'problem-revision:formal-conjectures:beal:main:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:beal-conjecture:kernel', 'problem-revision:formal-conjectures:beal:main:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:beal-conjecture:statement', 'problem-revision:formal-conjectures:beal:main:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:beal-conjecture:novelty', 'problem-revision:formal-conjectures:beal:main:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:beal-conjecture:accepted', 'problem-revision:formal-conjectures:beal:main:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:perfect-cuboid-problem:bundle', 'problem-revision:formal-conjectures:perfect-cuboid:main:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:perfect-cuboid-problem:kernel', 'problem-revision:formal-conjectures:perfect-cuboid:main:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:perfect-cuboid-problem:statement', 'problem-revision:formal-conjectures:perfect-cuboid:main:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:perfect-cuboid-problem:novelty', 'problem-revision:formal-conjectures:perfect-cuboid:main:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:perfect-cuboid-problem:accepted', 'problem-revision:formal-conjectures:perfect-cuboid:main:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:graceful-tree-conjecture:bundle', 'problem-revision:formal-conjectures:graceful-tree:main:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:graceful-tree-conjecture:kernel', 'problem-revision:formal-conjectures:graceful-tree:main:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:graceful-tree-conjecture:statement', 'problem-revision:formal-conjectures:graceful-tree:main:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:graceful-tree-conjecture:novelty', 'problem-revision:formal-conjectures:graceful-tree:main:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:graceful-tree-conjecture:accepted', 'problem-revision:formal-conjectures:graceful-tree:main:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:catalan-mihailescu-theorem:bundle', 'problem-revision:formal-conjectures:catalan:main:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:catalan-mihailescu-theorem:kernel', 'problem-revision:formal-conjectures:catalan:main:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:catalan-mihailescu-theorem:statement', 'problem-revision:formal-conjectures:catalan:main:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:catalan-mihailescu-theorem:novelty', 'problem-revision:formal-conjectures:catalan:main:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:catalan-mihailescu-theorem:accepted', 'problem-revision:formal-conjectures:catalan:main:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:modularity-theorem:bundle', 'problem-revision:formal-conjectures:modularity:main:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:modularity-theorem:kernel', 'problem-revision:formal-conjectures:modularity:main:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:modularity-theorem:statement', 'problem-revision:formal-conjectures:modularity:main:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:modularity-theorem:novelty', 'problem-revision:formal-conjectures:modularity:main:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:modularity-theorem:accepted', 'problem-revision:formal-conjectures:modularity:main:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:gromov-polynomial-growth-theorem:bundle', 'problem-revision:formal-conjectures:gromov-growth:main:1', 'bundle_reproducible', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:gromov-polynomial-growth-theorem:kernel', 'problem-revision:formal-conjectures:gromov-growth:main:1', 'kernel_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:gromov-polynomial-growth-theorem:statement', 'problem-revision:formal-conjectures:gromov-growth:main:1', 'statement_faithful', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:gromov-polynomial-growth-theorem:novelty', 'problem-revision:formal-conjectures:gromov-growth:main:1', 'novelty_reviewed', 'not_submitted', NULL, '2026-07-16T00:00:00Z'),
  ('claim:gromov-polynomial-growth-theorem:accepted', 'problem-revision:formal-conjectures:gromov-growth:main:1', 'project_accepted', 'not_submitted', NULL, '2026-07-16T00:00:00Z');
--> statement-breakpoint
INSERT OR IGNORE INTO problem_subjects (
  problem_revision_id, subject_id, is_primary
) VALUES
  ('problem-revision:formal-conjectures:p-vs-np:main:1', 'subject:ams-68', 1),
  ('problem-revision:formal-conjectures:p-vs-np:cop-eq-p:1', 'subject:ams-68', 1),
  ('problem-revision:formal-conjectures:p-vs-np:p-subset-np:1', 'subject:ams-68', 1),
  ('problem-revision:formal-conjectures:poincare:smooth-dimension-four:1', 'subject:ams-57', 1),
  ('problem-revision:formal-conjectures:poincare:smooth-dimension-four:1', 'subject:ams-54', 0),
  ('problem-revision:formal-conjectures:poincare:dimension-three:1', 'subject:ams-57', 1),
  ('problem-revision:formal-conjectures:poincare:dimension-three:1', 'subject:ams-54', 0),
  ('problem-revision:formal-conjectures:legendre:main:1', 'subject:ams-11', 1),
  ('problem-revision:formal-conjectures:legendre:large-n:1', 'subject:ams-11', 1),
  ('problem-revision:formal-conjectures:inscribed-square:main:1', 'subject:ams-51', 1),
  ('problem-revision:formal-conjectures:inscribed-square:main:1', 'subject:ams-54', 0),
  ('problem-revision:formal-conjectures:inscribed-square:rectangle:1', 'subject:ams-51', 1),
  ('problem-revision:formal-conjectures:inscribed-square:rectangle:1', 'subject:ams-54', 0),
  ('problem-revision:formal-conjectures:inscribed-square:c2:1', 'subject:ams-51', 1),
  ('problem-revision:formal-conjectures:inscribed-square:c2:1', 'subject:ams-54', 0),
  ('problem-revision:formal-conjectures:beal:main:1', 'subject:ams-11', 1),
  ('problem-revision:formal-conjectures:perfect-cuboid:main:1', 'subject:ams-11', 1),
  ('problem-revision:formal-conjectures:graceful-tree:main:1', 'subject:ams-05', 1),
  ('problem-revision:formal-conjectures:catalan:main:1', 'subject:ams-11', 1),
  ('problem-revision:formal-conjectures:modularity:main:1', 'subject:ams-11', 1),
  ('problem-revision:formal-conjectures:gromov-growth:main:1', 'subject:ams-20', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO catalog_collection_members (
  collection_id, problem_revision_id, role, position
) VALUES
  ('collection:grand-challenges', 'problem-revision:formal-conjectures:p-vs-np:main:1', 'headline', 60),
  ('collection:grand-challenges', 'problem-revision:formal-conjectures:p-vs-np:cop-eq-p:1', 'milestone', 61),
  ('collection:grand-challenges', 'problem-revision:formal-conjectures:p-vs-np:p-subset-np:1', 'milestone', 62),
  ('collection:grand-challenges', 'problem-revision:formal-conjectures:poincare:smooth-dimension-four:1', 'headline', 70),
  ('collection:grand-challenges', 'problem-revision:formal-conjectures:poincare:dimension-three:1', 'milestone', 71),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:legendre:main:1', 'headline', 70),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:legendre:large-n:1', 'milestone', 71),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:inscribed-square:main:1', 'headline', 80),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:inscribed-square:rectangle:1', 'milestone', 81),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:inscribed-square:c2:1', 'milestone', 82),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:beal:main:1', 'headline', 90),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:perfect-cuboid:main:1', 'headline', 100),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:graceful-tree:main:1', 'headline', 110),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:catalan:main:1', 'milestone', 120),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:modularity:main:1', 'milestone', 121),
  ('collection:founding-challenges', 'problem-revision:formal-conjectures:gromov-growth:main:1', 'milestone', 122);
--> statement-breakpoint
INSERT OR IGNORE INTO catalog_imports (
  id, source_snapshot_id, input_hash, imported_at, record_count
) VALUES   ('import:formal-conjectures:expansion-v1-lean4.27.0', 'snapshot:formal-conjectures:expansion-v1-lean4.27.0', 'sha256:5d01ebb4b5b03c1e8b7f9b6d47764684c881656a38e30ed5f0ad05104c6cdb24', '2026-07-16T00:00:00Z', 16)
