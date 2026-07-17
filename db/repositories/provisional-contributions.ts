import { getD1 } from "@/db";

export type ProvisionalContribution = Readonly<{
  id: string;
  kind: "evidence_bundle";
  state: "bundle_staged";
  beneficiary: Readonly<{
    personId: string;
    agentId: string;
    agentLabel: string;
    delegationCertificateId: string;
  }>;
  attempt: Readonly<{
    id: string;
    problemRevisionId: string;
    problemSlug: string;
    problemTitle: string;
  }>;
  artifactBundleManifestHash: string;
  agentEvent: Readonly<{
    id: string;
    occurredAt: string;
  }>;
  recordedAt: string;
}>;

type ProvisionalContributionRow = {
  id: string;
  kind: "evidence_bundle";
  state: "bundle_staged";
  beneficiary_person_id: string;
  beneficiary_agent_id: string;
  agent_label: string;
  beneficiary_delegation_certificate_id: string;
  attempt_id: string;
  problem_revision_id: string;
  problem_slug: string;
  problem_title: string;
  artifact_bundle_manifest_hash: string;
  agent_event_id: string;
  agent_event_occurred_at: string;
  recorded_at: string;
};

export class ProvisionalContributionIntegrityError extends Error {
  constructor() {
    super("Stored provisional contribution did not match its bound Attempt and delegated Agent authority.");
    this.name = "ProvisionalContributionIntegrityError";
  }
}

// Sites deployment and the external D1 migration are deliberately separate.
// This lets an older private-alpha database fail visibly but safely instead of
// presenting a made-up local ledger.
export class ProvisionalContributionSchemaUnavailableError extends Error {
  constructor() {
    super("The provisional contribution ledger schema is not available in this control-plane database.");
    this.name = "ProvisionalContributionSchemaUnavailableError";
  }
}

export interface ProvisionalContributionRepository {
  listForPerson(personId: string): Promise<readonly ProvisionalContribution[]>;
}

class D1ProvisionalContributionRepository implements ProvisionalContributionRepository {
  async listForPerson(personId: string): Promise<readonly ProvisionalContribution[]> {
    requireIdentifier(personId, "Person id");
    try {
      const result = await getD1()
        .prepare(
          `SELECT
             contribution.id, contribution.kind, contribution.state,
             contribution.beneficiary_person_id, contribution.beneficiary_agent_id,
             agent.label AS agent_label,
             contribution.beneficiary_delegation_certificate_id,
             contribution.attempt_id, contribution.problem_revision_id,
             revision.slug AS problem_slug, revision.title AS problem_title,
             contribution.artifact_bundle_manifest_hash,
             contribution.agent_event_id, contribution.agent_event_occurred_at,
             contribution.recorded_at
           FROM provisional_contributions AS contribution
           INNER JOIN agent_attempts AS attempt ON attempt.id = contribution.attempt_id
           INNER JOIN agents AS agent ON agent.id = contribution.beneficiary_agent_id
           INNER JOIN delegation_certificates AS certificate
             ON certificate.id = contribution.beneficiary_delegation_certificate_id
           INNER JOIN problem_revisions AS revision ON revision.id = contribution.problem_revision_id
           WHERE contribution.beneficiary_person_id = ?
             AND attempt.person_id = contribution.beneficiary_person_id
             AND attempt.agent_id = contribution.beneficiary_agent_id
             AND attempt.delegation_certificate_id = contribution.beneficiary_delegation_certificate_id
             AND attempt.problem_revision_id = contribution.problem_revision_id
             AND certificate.owner_person_id = contribution.beneficiary_person_id
             AND certificate.agent_id = contribution.beneficiary_agent_id
           ORDER BY contribution.recorded_at DESC, contribution.id ASC`,
        )
        .bind(personId)
        .all<ProvisionalContributionRow>();
      return Object.freeze((result.results ?? []).map(toContribution));
    } catch (error) {
      if (isMissingLedgerTable(error)) throw new ProvisionalContributionSchemaUnavailableError();
      throw error;
    }
  }
}

const repository = new D1ProvisionalContributionRepository();

export function getProvisionalContributionRepository(): ProvisionalContributionRepository {
  return repository;
}

function toContribution(row: ProvisionalContributionRow): ProvisionalContribution {
  if (
    row.kind !== "evidence_bundle" ||
    row.state !== "bundle_staged" ||
    !isIdentifier(row.id) ||
    !isIdentifier(row.beneficiary_person_id) ||
    !isIdentifier(row.beneficiary_agent_id) ||
    !isIdentifier(row.beneficiary_delegation_certificate_id) ||
    !isIdentifier(row.attempt_id) ||
    !isIdentifier(row.problem_revision_id) ||
    !isIdentifier(row.problem_slug) ||
    !isIdentifier(row.agent_event_id) ||
    !isSha256(row.artifact_bundle_manifest_hash) ||
    !isTimestamp(row.agent_event_occurred_at) ||
    !isTimestamp(row.recorded_at)
  ) {
    throw new ProvisionalContributionIntegrityError();
  }
  return Object.freeze({
    id: row.id,
    kind: row.kind,
    state: row.state,
    beneficiary: Object.freeze({
      personId: row.beneficiary_person_id,
      agentId: row.beneficiary_agent_id,
      agentLabel: row.agent_label,
      delegationCertificateId: row.beneficiary_delegation_certificate_id,
    }),
    attempt: Object.freeze({
      id: row.attempt_id,
      problemRevisionId: row.problem_revision_id,
      problemSlug: row.problem_slug,
      problemTitle: row.problem_title,
    }),
    artifactBundleManifestHash: row.artifact_bundle_manifest_hash,
    agentEvent: Object.freeze({ id: row.agent_event_id, occurredAt: row.agent_event_occurred_at }),
    recordedAt: row.recorded_at,
  });
}

function requireIdentifier(value: string, label: string): void {
  if (!isIdentifier(value)) throw new TypeError(`${label} must be a bounded identifier.`);
}

function isIdentifier(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 240 && !/[\r\n]/.test(value);
}

function isSha256(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/.test(value);
}

function isTimestamp(value: string): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isMissingLedgerTable(error: unknown): boolean {
  return error instanceof Error && /no such table:\s*provisional_contributions/i.test(error.message);
}
