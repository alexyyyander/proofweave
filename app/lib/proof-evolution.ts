export const PROOF_EVOLUTION_SCHEMA_VERSION = "pw-proof-evolution-v1";

export type ProofEvolutionGoal = "origin" | "simplify" | "explicitize" | "elementary" | "recombine" | "stronger";
export type ExplicitConstant = "existential" | "explicit" | "effective" | "asymptotic";
export type LeanStatus = "formalized_upstream" | "not_formalized" | "not_separately_formalized";
export type ProofDetailLevel = "lemma" | "grouped" | "summary" | "section";
export type ProofStepKind = "theorem" | "lemma" | "corollary" | "construction" | "bound" | "assembly" | "external";
export type VersionEdgeRelation = "simplifies" | "explicitizes" | "recombines" | "stronger";
export type LedgerStatus = "used" | "replaced" | "removed" | "not_used" | "explicit" | "existential" | "effective";

export type ProofEvolutionTrack = {
  id: string;
  label: string;
  description: string;
};

export type ProofEvolutionTheorem = {
  id: string;
  title: string;
  statement: string;
  scopeNote: string;
  sourceNote: string;
};

export type LeanCoverage = {
  status: LeanStatus;
  label: string;
  url: string | null;
  note: string;
};

export type ProofStep = {
  id: string;
  label: string;
  kind: ProofStepKind;
  detail: string;
  source: string;
  dependsOn: string[];
};

export type ProofVersion = {
  id: string;
  trackId: string;
  label: string;
  title: string;
  authors: string[];
  date: string;
  releaseDate?: string;
  pages: number;
  goal: ProofEvolutionGoal;
  method: string;
  field: string;
  explicitConstant: ExplicitConstant;
  aiAssistance: string;
  summary: string;
  changeSummary: string;
  lean: LeanCoverage;
  sourceUrl: string;
  sourceLabel: string;
  proofDetail: ProofDetailLevel;
  layout: { x: number; y: number };
  proofSteps: ProofStep[];
};

export type VersionEdge = {
  from: string;
  to: string;
  relation: VersionEdgeRelation;
  label: string;
  secondary?: boolean;
  visible?: boolean;
};

export type LedgerRow = {
  id: string;
  label: string;
  cells: Record<string, LedgerStatus>;
};

export type ProofEvolutionSource = {
  label: string;
  url: string;
  kind: string;
};

export type ProofEvolutionData = {
  schemaVersion: typeof PROOF_EVOLUTION_SCHEMA_VERSION;
  status: "draft";
  reviewStatus: "unreviewed";
  curatedAt: string;
  theorem: ProofEvolutionTheorem;
  tracks: ProofEvolutionTrack[];
  versions: ProofVersion[];
  versionEdges: VersionEdge[];
  ledger: {
    columns: string[];
    rows: LedgerRow[];
  };
  caveats: string[];
  sources: ProofEvolutionSource[];
};

export const goalLabel: Record<ProofEvolutionGoal, string> = {
  origin: "Origin",
  simplify: "Simplifies",
  explicitize: "Explicitizes",
  elementary: "Elementary",
  recombine: "Recombines",
  stronger: "Stronger theorem",
};

export const explicitConstantLabel: Record<ExplicitConstant, string> = {
  existential: "Existential constant",
  explicit: "Explicit numeric constant",
  effective: "Effective constant",
  asymptotic: "Asymptotic constant",
};

export const leanStatusLabel: Record<LeanStatus, string> = {
  formalized_upstream: "Formalized upstream",
  not_formalized: "Not formalized",
  not_separately_formalized: "Not separately formalized",
};

export const relationLabel: Record<VersionEdgeRelation, string> = {
  simplifies: "Simplifies",
  explicitizes: "Explicitizes",
  recombines: "Recombines",
  stronger: "Stronger theorem",
};

export const ledgerStatusLabel: Record<LedgerStatus, string> = {
  used: "Used",
  replaced: "Replaced",
  removed: "Removed",
  not_used: "Not used",
  explicit: "Explicit",
  existential: "Existential",
  effective: "Effective",
};

export function versionById(data: ProofEvolutionData, id: string): ProofVersion | undefined {
  return data.versions.find((version) => version.id === id);
}

export function versionsForTrack(data: ProofEvolutionData, trackId: string): ProofVersion[] {
  return data.versions.filter((version) => version.trackId === trackId);
}

export function trackById(data: ProofEvolutionData, id: string): ProofEvolutionTrack | undefined {
  return data.tracks.find((track) => track.id === id);
}
