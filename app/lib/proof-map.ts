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
  lean: {
    comparators: number;
    solutions: number;
    theoremNames: number;
    status: "extracted" | "partial" | "missing" | "none";
    textualSorry: number;
    textualAxioms: number;
  };
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
  leanFamilies: number;
  leanSolutionModules: number;
  leanTheoremNames: number;
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

export type LeanComparatorCoverage = {
  familyNumber: string;
  familyTitle: string;
  familySubject: string;
  label: string;
  challengePath: string;
  challengeUrl: string;
  jsonPath: string;
  jsonUrl: string;
  solutionModule: string | null;
  solutionPath: string | null;
  solutionUrl: string | null;
  theoremNames: string[];
  definitionNames: string[];
  permittedAxioms: string[];
  enableNanoda: boolean;
  jsonStatus: number;
  challengeStatus: number;
  solutionStatus: number;
  solutionLines: number;
  solutionBytes: number;
  solutionImports: string[];
  solutionDeclarationCount: number;
  solutionDeclarations: Array<{ kind: string; name: string }>;
  solutionSorry: number;
  solutionAxioms: number;
  challengeLines: number;
  challengeSorry: number;
  error: string | null;
};

export type LeanCoverageFamily = {
  familyNumber: string;
  familyTitle: string;
  familySubject: string;
  comparatorCount: number;
  comparators: LeanComparatorCoverage[];
  solutionFetched: number;
  jsonFetched: number;
  challengeFetched: number;
  solutionMissing: number;
  theoremNames: string[];
  permittedAxioms: string[];
  textualSorry: number;
  textualAxioms: number;
  leanStructureStatus: "extracted" | "partial" | "missing";
};

export type LeanCoverageData = {
  schemaVersion: "pw-lean-coverage-v1";
  status: "draft";
  reviewStatus: "unreviewed";
  generatedAt: string;
  commit: string;
  sourceNote: string;
  summary: {
    familiesWithComparators: number;
    comparatorLinks: number;
    jsonFetched: number;
    challengeFetched: number;
    solutionFetched: number;
    solutionMissing: number;
    theoremNames: number;
    textualSorry: number;
    textualAxioms: number;
  };
  families: LeanCoverageFamily[];
};
