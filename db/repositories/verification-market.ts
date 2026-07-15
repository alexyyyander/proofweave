import { getD1 } from "@/db";
import {
  D1VerificationMarketStore,
  VerificationMarketConflictError,
  VerificationMarketNotFoundError,
  VerificationMarketValidationError,
} from "@/services/verification/d1-verification-market-store.mjs";

export type PublicVerificationJob = Readonly<{
  id: string;
  claimType: string;
  label: string;
  evidenceRequirement: string;
  rewardWeight: number;
  artifactBundleManifestHash: string;
  publishedAt: string;
  submittingAgentLabel: string;
  target: Readonly<{
    problemRevisionId: string;
    problemSlug: string;
    projectSlug: string;
    title: string;
  }>;
  pool: Readonly<{
    id: string;
    totalCredits: number;
    sponsorLabel: string;
    verificationBucketPercentage: number;
  }>;
}>;

export type ClaimedVerificationJob = Readonly<{
  created: boolean;
  assignment: Readonly<{
    id: string;
    artifactBundleManifestHash: string;
    claimType: string;
    status: string;
    assignedAt: string;
    acceptedAt: string | null;
  }>;
}>;

export class VerificationMarketSchemaUnavailableError extends Error {
  constructor() {
    super("The verification market schema is not active in this control plane.");
    this.name = "VerificationMarketSchemaUnavailableError";
  }
}

export interface VerificationMarketRepository {
  listOpenJobs(limit?: number): Promise<readonly PublicVerificationJob[]>;
  claimForPerson(personId: string, jobId: string, claimedAt: string): Promise<ClaimedVerificationJob>;
}

class D1VerificationMarketRepository implements VerificationMarketRepository {
  async listOpenJobs(limit = 50): Promise<readonly PublicVerificationJob[]> {
    try {
      return await new D1VerificationMarketStore(getD1()).listOpenJobs(limit) as readonly PublicVerificationJob[];
    } catch (error) {
      if (isMissingVerificationMarketTable(error)) throw new VerificationMarketSchemaUnavailableError();
      throw error;
    }
  }

  async claimForPerson(personId: string, jobId: string, claimedAt: string): Promise<ClaimedVerificationJob> {
    try {
      return await new D1VerificationMarketStore(getD1()).claimJob(jobId, personId, claimedAt) as ClaimedVerificationJob;
    } catch (error) {
      if (isMissingVerificationMarketTable(error)) throw new VerificationMarketSchemaUnavailableError();
      throw error;
    }
  }
}

export function getVerificationMarketRepository(): VerificationMarketRepository {
  return new D1VerificationMarketRepository();
}

export function isVerificationMarketFailure(error: unknown): boolean {
  return error instanceof VerificationMarketConflictError ||
    error instanceof VerificationMarketNotFoundError ||
    error instanceof VerificationMarketValidationError;
}

export {
  VerificationMarketConflictError,
  VerificationMarketNotFoundError,
  VerificationMarketValidationError,
};

function isMissingVerificationMarketTable(error: unknown): boolean {
  return error instanceof Error && /no such table:\s*(verification_market_jobs|verification_market_job_claims|verification_market_job_events)/i.test(error.message);
}
