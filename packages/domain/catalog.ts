export const verificationClaimTypes = [
  "bundle_reproducible",
  "kernel_accepted",
  "statement_faithful",
  "novelty_reviewed",
  "project_accepted",
] as const;

export type VerificationClaimType = (typeof verificationClaimTypes)[number];
export type VerificationClaimStatus =
  | "not_submitted"
  | "pending"
  | "attested"
  | "rejected";
export type CatalogRecordKind = "frontier" | "practice";
export type CatalogDisplayStatus =
  | "Formalized statement"
  | "Open proof branch"
  | "Kernel accepted"
  | "Statement fidelity reviewed"
  | "Independent review"
  | "No Proofweave attestation";

export const verificationClaimLabels: Record<VerificationClaimType, string> = {
  bundle_reproducible: "Bundle reproducible",
  kernel_accepted: "Kernel accepted",
  statement_faithful: "Statement fidelity",
  novelty_reviewed: "Novelty reviewed",
  project_accepted: "Project accepted",
};

export type CatalogClaim = Readonly<{
  type: VerificationClaimType;
  status: VerificationClaimStatus;
  evidenceUrl: string | null;
  recordedAt: string;
}>;

export type CatalogSubject = Readonly<{
  id: string;
  slug: string;
  name: string;
  amsCode: string;
  description: string;
  isPrimary: boolean;
}>;

export type CatalogCollection = Readonly<{
  id: string;
  slug: string;
  title: string;
  summary: string;
  tier: "founding" | "grand";
  role: "headline" | "milestone";
  position: number;
}>;

export type CatalogProblem = Readonly<{
  id: string;
  slug: string;
  kind: CatalogRecordKind;
  title: string;
  projectId: string;
  projectSlug: string;
  projectTitle: string;
  projectSummary: string;
  domain: string;
  subjects: readonly CatalogSubject[];
  collections: readonly CatalogCollection[];
  researchStatus: "research_open" | "research_solved";
  informalStatement: string;
  leanStatement: string;
  proofState: "admitted" | "proved";
  sourceCorrespondence: "imported_unreviewed" | "reviewed";
  declaration: Readonly<{
    qualifiedName: string;
    kind: "theorem" | "lemma";
    sourcePath: string;
    sourceUrl: string;
    sourceLineStart: number;
    sourceLineEnd: number;
    sourceContentHash: string;
  }>;
  source: Readonly<{
    upstreamName: string;
    sourceUrl: string;
    revisionTag: string;
    revisionCommit: string;
    retrievedAt: string;
    contentHash: string;
    manifestHash: string;
    sourceLicense: string;
    leanToolchain: string;
    mathlibRevision: string;
  }>;
  claims: readonly CatalogClaim[];
  displayStatuses: readonly CatalogDisplayStatus[];
}>;

export function catalogDisplayStatuses(
  proofState: CatalogProblem["proofState"],
  claims: readonly CatalogClaim[],
): CatalogDisplayStatus[] {
  const statuses: CatalogDisplayStatus[] = ["Formalized statement"];

  if (proofState === "admitted") {
    statuses.push("Open proof branch");
  }

  const has = (type: VerificationClaimType) =>
    claims.some((claim) => claim.type === type && claim.status === "attested");

  if (has("kernel_accepted")) statuses.push("Kernel accepted");
  if (has("statement_faithful")) statuses.push("Statement fidelity reviewed");
  if (has("project_accepted")) statuses.push("Independent review");

  if (!claims.some((claim) => claim.status === "attested")) {
    statuses.push("No Proofweave attestation");
  }

  return statuses;
}
