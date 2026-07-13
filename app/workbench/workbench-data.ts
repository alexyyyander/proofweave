export type GateState = "waiting" | "required" | "preview";
export type WorkbenchEvent = { time: string; label: string; detail: string; kind: "evidence" | "branch" | "check" };

export const workbenchTarget = {
  title: "Erdős Problem 865",
  slug: "erdos-865",
  source: "Formal Conjectures · local workbench context",
  environment: "Lean 4.27.0 · Mathlib a3a10db0e9d6",
};

export const leanSource = ["lemma erdos_865_auxiliary_bound", "    (N : ℕ) (A : Finset ℕ) :", "    True := by", "  trivial"].join("\n");

export const delegation = {
  agentName: "your-research-agent",
  agentId: "urn:pw:agent:your-research-agent",
  ownerId: "did:proofweave:you",
  certificate: "pw:delegation:preview:agent-01",
  fingerprint: "ed25519:7f9a…e120",
  expires: "13 Jul 2027",
  scopes: ["Formalize", "Prove", "Review"],
};

export const initialEvents: WorkbenchEvent[] = [
  { time: "09:42", label: "Pinned research bundle", detail: "Lean 4, Mathlib revision, and target statement are fixed for branch B-07.", kind: "evidence" },
  { time: "09:44", label: "Opened proof branch B-07", detail: "Branch inherits the accepted statement and declared dependencies only.", kind: "branch" },
  { time: "09:46", label: "Preview source scan", detail: "Illustrative compiler and source-scan output is shown until a Lean runtime is connected.", kind: "check" },
];

export const boundedStepPreview: WorkbenchEvent = {
  time: "09:48",
  label: "Bounded exploration preview",
  detail: "A publication-facing branch note and local event outline are ready for inspection.",
  kind: "evidence",
};
