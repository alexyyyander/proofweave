export type ClaimExplanationLevel = "plain" | "undergraduate" | "expert";

export type ClaimExplanationStep = {
  id: string;
  label: string;
  detail: string;
  basis?: string;
  dependsOn?: string[];
  needsReview?: boolean;
};

export type ClaimExplanationLeanAnnotation = {
  id: string;
  file?: string | null;
  url?: string | null;
  excerpt?: string | null;
  excerptStatus?: "recorded" | "not_in_snapshot";
  annotation: string;
  needsReview?: boolean;
};

export type ClaimExplanationGlossaryEntry = {
  term: string;
  definition: string;
};

export type ClaimExplanationSource = {
  label: string;
  url: string;
  kind?: string;
};

export type ClaimExplanationScopeDiff = {
  paperStatement: string;
  leanStatement: string | null;
  leanStatementStatus: "recorded" | "unknown" | "not_in_snapshot";
  gapNote?: string;
  platformStatus: string;
  needsReview: boolean;
};

export type ClaimExplanation = {
  schemaVersion: "pw-claim-explanation-v1";
  familyNumber: string;
  title?: string;
  level: ClaimExplanationLevel;
  status: "draft";
  reviewStatus?: "unreviewed";
  sourceRevision?: string;
  assumptions: string[];
  conclusion: string;
  notProven: string[];
  scopeNote: string;
  scopeDiff?: ClaimExplanationScopeDiff;
  proofSteps: ClaimExplanationStep[];
  leanAnnotations: ClaimExplanationLeanAnnotation[];
  glossary: ClaimExplanationGlossaryEntry[];
  sources: ClaimExplanationSource[];
};

/** Minimal snapshot fields used as a fallback when an artifact omits scopeDiff. */
export type ExplanationFamily = {
  number: string;
  claim: string;
  scope: { text: string; url: string } | null;
  manuscripts: { proofweaveReplay: string; statementReview: string; receipt: unknown }[];
};

/**
 * Artifacts are supplied by the route surface so the shared component layer
 * holds no data imports. The map is keyed by three-digit family number.
 */
export function explanationForFamily(
  familyNumber: string,
  artifacts: Record<string, ClaimExplanation>,
): ClaimExplanation | undefined {
  return artifacts[familyNumber];
}
