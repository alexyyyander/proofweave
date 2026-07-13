export type VerificationState = "Formalized" | "Proof branch open" | "Kernel checked" | "Statement review" | "Independent review";

export type ProjectRecord = {
  slug: string;
  title: string;
  domain: string;
  source: string;
  summary: string;
  informal: string;
  lean: string;
  statuses: VerificationState[];
  environment: string;
};

export const projects: ProjectRecord[] = [
  {
    slug: "abc-geometry",
    title: "An abc-type height bound",
    domain: "Number theory",
    source: "Formal Conjectures · preview",
    summary: "A formalized statement with an open proof branch and a clear path for auxiliary lemmas.",
    informal: "For coprime positive integers a, b, and c with a + b = c, compare the height of c with the radical of abc.",
    lean: "theorem abc_height_bound (a b c : ℕ) : a + b = c → Nat.Coprime a b → True := by\n  trivial",
    statuses: ["Formalized", "Proof branch open", "Statement review"],
    environment: "Lean 4 · Mathlib · pinned manifest",
  },
  {
    slug: "erdos-graph-gap",
    title: "A graph density threshold",
    domain: "Combinatorics",
    source: "Erdős Problems · preview",
    summary: "A project record designed for parallel search, refutation, and independent verification.",
    informal: "Determine whether every sufficiently dense finite graph contains the required combinatorial configuration.",
    lean: "theorem graph_density_threshold (G : Type) : True := by\n  trivial",
    statuses: ["Formalized", "Proof branch open", "Independent review"],
    environment: "Lean 4 · Mathlib · isolated verifier",
  },
  {
    slug: "analytic-bridge",
    title: "An analytic bridge lemma",
    domain: "Analysis",
    source: "Collaborative project · preview",
    summary: "A reusable intermediate target that illustrates how infrastructure and synthesis become visible work.",
    informal: "Establish a continuity estimate that lets two previously separate proof branches compose.",
    lean: "theorem analytic_bridge (f : ℝ → ℝ) : True := by\n  trivial",
    statuses: ["Formalized", "Kernel checked", "Statement review"],
    environment: "Lean 4 · Mathlib · reproducible build",
  },
  {
    slug: "countermodel-search",
    title: "A finite countermodel search",
    domain: "Logic",
    source: "Proofweave practice · preview",
    summary: "A counterexample-oriented task where a witness is just as valuable as a completed proof.",
    informal: "Find a finite structure that falsifies a proposed implication between two axioms.",
    lean: "theorem finite_countermodel_exists : True := by\n  trivial",
    statuses: ["Formalized", "Proof branch open"],
    environment: "Lean 4 · finite model checker · pinned inputs",
  },
];

export const receipt = {
  id: "pw:receipt:preview:abc-l1",
  contribution: "Reusable lemma",
  person: "did:proofweave:alice",
  agent: "urn:pw:agent:alice-prover-01",
  target: "An abc-type height bound",
  environment: "lean4:preview · mathlib:preview · manifest:sha256:example",
  dependency: "Used by target proof branch P-04",
};
