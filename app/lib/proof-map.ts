export type ProofMapStatus = "deep" | "draft" | "scaffold";

export type ProofMapIndexEntry = {
  familyNumber: string;
  title: string;
  subject: string;
  claimSnippet: string;
  manuscriptCount: number;
  scopeDocument: boolean;
  comparatorCount: number;
  formalizedManuscripts: number;
  status: ProofMapStatus;
  statusLabel: string;
  reviewStatus: "unreviewed" | "not_started";
  proofweaveReplay: "not_run";
  route: string;
  publicationRoute: string;
  manifestLabel: string | null;
  nextStep: string;
  searchText: string;
};

export type ProofMapIndexSubject = {
  name: string;
  families: number;
  deep: number;
  draft: number;
  scaffold: number;
};

export type ProofMapIndexSummary = {
  families: number;
  manuscripts: number;
  subjects: number;
  scopeDocuments: number;
  scopeFamilies: number;
  comparatorLinks: number;
  formalizedManuscripts: number;
  deep: number;
  draft: number;
  scaffold: number;
  proofweaveReplays: number;
};

export type ProofMapIndex = {
  schemaVersion: "pw-proof-map-index-v1";
  status: "draft";
  generatedFrom: {
    collection: string;
    releaseDate: string;
    indexedAt: string;
    revision: string | null;
  };
  summary: ProofMapIndexSummary;
  statusCounts: Record<ProofMapStatus, number>;
  subjects: ProofMapIndexSubject[];
  entries: ProofMapIndexEntry[];
};
