import { getD1 } from "@/db";
import {
  D1ResearchGraphStore,
  ResearchGraphConflictError,
  ResearchGraphNotFoundError,
  ResearchGraphValidationError,
} from "@/services/research/d1-research-graph-store.mjs";

export type ResearchNodeKind =
  | "formalization"
  | "hypothesis"
  | "lemma"
  | "proof_state"
  | "proof_patch"
  | "counterexample"
  | "negative_result"
  | "synthesis";

export type PublicResearchNode = Readonly<{
  id: string;
  problemRevisionId: string;
  attemptId: string;
  kind: ResearchNodeKind;
  summary: string;
  proofStateHash: string | null;
  artifactBundleHash: string | null;
  delegationCertificateId: string;
  state: "shared_unverified";
  payloadHash: string;
  checkpointHash: string;
  occurredAt: string;
  creator: Readonly<{
    personId: string;
    displayName: string;
    agentId: string;
    agentLabel: string;
  }>;
  evidence: Readonly<{
    stage: "shared" | "bundle_staged" | "kernel_accepted" | "review_recorded" | "receipt_recorded";
    bundle: Readonly<{ manifestHash: string }> | null;
    lean: Readonly<{ runId: string; resultHash: string; artifactBundleHash: string; acceptedAt: string }> | null;
    review: Readonly<{
      attestationCount: number;
      reviewerCount: number;
      claimTypes: readonly string[];
      lastAttestedAt: string;
    }> | null;
    receipt: Readonly<{
      id: string;
      receiptHash: string;
      kind: string;
      issuedAt: string;
    }> | null;
  }>;
}>;

export type ResearchDerivationEdge = Readonly<{
  childNodeId: string;
  parentNodeId: string;
  relation: "derives_from" | "merges";
  recordedAt: string;
}>;

export type ExternalAttribution = Readonly<{
  id: string;
  displayName: string;
  persistentIdScheme: string | null;
  persistentId: string | null;
  role: "author" | "formalizer" | "prover" | "reviewer" | "maintainer";
  assertionStatus: "source_asserted" | "curator_reviewed" | "author_confirmed";
  evidenceUrl: string;
}>;

export type ExternalWork = Readonly<{
  id: string;
  sourceSystem: string;
  sourceUrl: string;
  sourceObjectId: string;
  sourceRevision: string;
  title: string;
  contentHash: string;
  sourceLicense: string;
  retrievedAt: string;
  citedBy: readonly Readonly<{ nodeId: string; relation: string }>[];
  attributions: readonly ExternalAttribution[];
}>;

export type PublicResearchGraph = Readonly<{
  nodes: readonly PublicResearchNode[];
  edges: readonly ResearchDerivationEdge[];
  externalWorks: readonly ExternalWork[];
  truncated: boolean;
}>;

export type ExternalWorkImportInput = Readonly<{
  problemRevisionId: string;
  sourceSystem: string;
  sourceUrl: string;
  sourceObjectId: string;
  sourceRevision: string;
  title: string;
  contentHash: string;
  sourceLicense: string;
  retrievedAt: string;
  contributors: readonly Readonly<{
    displayName: string;
    persistentIdScheme: string | null;
    persistentId: string | null;
    role: ExternalAttribution["role"];
    evidenceUrl: string;
  }>[];
}>;

export class ResearchGraphSchemaUnavailableError extends Error {
  constructor() {
    super("The research graph schema is not active in this control plane.");
    this.name = "ResearchGraphSchemaUnavailableError";
  }
}

export interface ResearchGraphRepository {
  findByProblemRevisionId(problemRevisionId: string): Promise<PublicResearchGraph>;
  importExternalWork(personId: string, input: ExternalWorkImportInput): Promise<Readonly<{
    externalWork: ExternalWork;
    created: boolean;
    attributionState: "source_asserted";
    receiptIssued: false;
  }>>;
}

class D1ResearchGraphRepository implements ResearchGraphRepository {
  async findByProblemRevisionId(problemRevisionId: string): Promise<PublicResearchGraph> {
    try {
      return await store().readProblemGraph(problemRevisionId) as PublicResearchGraph;
    } catch (error) {
      if (isMissingResearchGraphTable(error)) throw new ResearchGraphSchemaUnavailableError();
      throw error;
    }
  }

  async importExternalWork(personId: string, input: ExternalWorkImportInput) {
    try {
      return await store().importExternalWork(personId, input) as Readonly<{
        externalWork: ExternalWork;
        created: boolean;
        attributionState: "source_asserted";
        receiptIssued: false;
      }>;
    } catch (error) {
      if (isMissingResearchGraphTable(error)) throw new ResearchGraphSchemaUnavailableError();
      throw error;
    }
  }
}

const repository = new D1ResearchGraphRepository();

export function getResearchGraphRepository(): ResearchGraphRepository {
  return repository;
}

export {
  ResearchGraphConflictError,
  ResearchGraphNotFoundError,
  ResearchGraphValidationError,
};

function store() {
  return new D1ResearchGraphStore(getD1());
}

function isMissingResearchGraphTable(error: unknown): boolean {
  return error instanceof Error && /no such table:\s*(research_nodes|external_works|external_work_problem_links|external_attributions|research_node_citations)/i.test(error.message);
}
