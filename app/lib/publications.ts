import snapshot from "@/data/publications/openai-math.json";

export type PublicationLink = { label: string; url: string };
export type Manuscript = {
  id: string; title: string; authors: string[]; date: string; abstract: string;
  pdfUrl: string; downloadUrl: string; readmeUrl: string; readmeSha256: string;
  citation: string; versionNote: string; versionLinks: PublicationLink[];
  listedInFormalizationIndex: boolean; citedByScopeDocument: boolean;
  proofweaveReplay: "not_run"; statementReview: "not_started"; receipt: null;
};
export type PublicationFamily = {
  number: string; title: string; subject: string; claim: string; manuscripts: Manuscript[];
  scope: null | { url: string; sha256: string; text: string; paperLinks: PublicationLink[]; comparatorLinks: PublicationLink[] };
};
export type PublicationCollection = {
  schemaVersion: number; id: string; title: string; releaseDate: string; indexedAt: string;
  source: { repository: string; revision: string; license: string; licenseUrl: string; historyUrl: string; contentsUrl: string; announcementUrl: string };
  environment: { lean: string; mathlib: string; instructionsUrl: string };
  statistics: { manuscripts: number; families: number; subjects: number; scopeDocuments: number; upstreamReportedFormalizedResults: number; proofweaveReplays: number; yamlIndexedManuscripts: number };
  subjects: { name: string; families: number }[];
  families: PublicationFamily[];
  withdrawals: { title: string; noticeUrl: string; noticeSha256: string; date: string }[];
};
export const openaiMathCollection = snapshot as PublicationCollection;
export const publicationFamily = (number: string) => /^\d{3}$/.test(number) ? openaiMathCollection.families.find((family) => family.number === number) : undefined;
