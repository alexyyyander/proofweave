import { sql } from "drizzle-orm";
import { blob, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`);

export const sourceSnapshots = sqliteTable(
  "source_snapshots",
  {
    id: text("id").primaryKey(),
    upstreamName: text("upstream_name").notNull(),
    sourceUrl: text("source_url").notNull(),
    revisionTag: text("revision_tag").notNull(),
    revisionCommit: text("revision_commit").notNull(),
    retrievedAt: text("retrieved_at").notNull(),
    contentHash: text("content_hash").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    sourceLicense: text("source_license").notNull(),
    leanToolchain: text("lean_toolchain").notNull(),
    mathlibRevision: text("mathlib_revision").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("source_snapshots_upstream_revision_idx").on(
      table.upstreamName,
      table.revisionCommit,
    ),
  ],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    kind: text("kind", { enum: ["frontier", "practice"] }).notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    visibility: text("visibility", { enum: ["public", "private"] })
      .notNull()
      .default("public"),
    createdAt,
  },
  (table) => [index("projects_kind_visibility_idx").on(table.kind, table.visibility)],
);

export const problemRevisions = sqliteTable(
  "problem_revisions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceSnapshotId: text("source_snapshot_id")
      .notNull()
      .references(() => sourceSnapshots.id, { onDelete: "restrict" }),
    targetKey: text("target_key").notNull(),
    slug: text("slug").notNull().unique(),
    revisionNumber: integer("revision_number").notNull(),
    title: text("title").notNull(),
    domain: text("domain").notNull(),
    researchStatus: text("research_status", {
      enum: ["research_open", "research_solved"],
    }).notNull(),
    informalStatement: text("informal_statement").notNull(),
    leanStatement: text("lean_statement").notNull(),
    sourceCorrespondence: text("source_correspondence", {
      enum: ["imported_unreviewed", "reviewed"],
    })
      .notNull()
      .default("imported_unreviewed"),
    proofState: text("proof_state", {
      enum: ["admitted", "proved"],
    })
      .notNull()
      .default("admitted"),
    priority: integer("priority").notNull().default(0),
    createdAt,
  },
  (table) => [
    uniqueIndex("problem_revisions_project_revision_idx").on(
      table.projectId,
      table.targetKey,
      table.revisionNumber,
    ),
    index("problem_revisions_snapshot_idx").on(table.sourceSnapshotId),
  ],
);

export const declarations = sqliteTable(
  "declarations",
  {
    id: text("id").primaryKey(),
    problemRevisionId: text("problem_revision_id")
      .notNull()
      .references(() => problemRevisions.id, { onDelete: "cascade" }),
    qualifiedName: text("qualified_name").notNull(),
    declarationKind: text("declaration_kind", { enum: ["theorem", "lemma"] })
      .notNull()
      .default("theorem"),
    sourcePath: text("source_path").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceLineStart: integer("source_line_start").notNull(),
    sourceLineEnd: integer("source_line_end").notNull(),
    sourceContentHash: text("source_content_hash").notNull(),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(true),
    createdAt,
  },
  (table) => [
    uniqueIndex("declarations_revision_name_idx").on(
      table.problemRevisionId,
      table.qualifiedName,
    ),
    index("declarations_primary_idx").on(table.problemRevisionId, table.isPrimary),
  ],
);

export const verificationClaims = sqliteTable(
  "verification_claims",
  {
    id: text("id").primaryKey(),
    problemRevisionId: text("problem_revision_id")
      .notNull()
      .references(() => problemRevisions.id, { onDelete: "cascade" }),
    claimType: text("claim_type", {
      enum: [
        "bundle_reproducible",
        "kernel_accepted",
        "statement_faithful",
        "novelty_reviewed",
        "project_accepted",
      ],
    }).notNull(),
    status: text("status", {
      enum: ["not_submitted", "pending", "attested", "rejected"],
    }).notNull(),
    evidenceUrl: text("evidence_url"),
    recordedAt: text("recorded_at").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("verification_claims_revision_type_idx").on(
      table.problemRevisionId,
      table.claimType,
    ),
  ],
);

export const catalogImports = sqliteTable(
  "catalog_imports",
  {
    id: text("id").primaryKey(),
    sourceSnapshotId: text("source_snapshot_id")
      .notNull()
      .references(() => sourceSnapshots.id, { onDelete: "restrict" }),
    inputHash: text("input_hash").notNull(),
    importedAt: text("imported_at").notNull(),
    recordCount: integer("record_count").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("catalog_imports_snapshot_idx").on(table.sourceSnapshotId),
  ],
);

// A Person is the attribution root for an authenticated participant. This
// closed-alpha mapping intentionally uses the identity currently supplied by
// Sites; public beta will replace it with provider-neutral identities.
export const persons = sqliteTable(
  "persons",
  {
    id: text("id").primaryKey(),
    identityProvider: text("identity_provider", {
      enum: ["chatgpt", "proofweave"],
    }).notNull(),
    providerSubject: text("provider_subject").notNull(),
    displayName: text("display_name").notNull(),
    createdAt,
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("persons_provider_subject_idx").on(
      table.identityProvider,
      table.providerSubject,
    ),
  ],
);

// A Person can have several public signing keys over time. Revocation lives on
// the key record so a historical delegation remains inspectable with the key
// material that signed it.
export const personKeys = sqliteTable(
  "person_keys",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    algorithm: text("algorithm", { enum: ["ed25519"] })
      .notNull()
      .default("ed25519"),
    publicKey: text("public_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    revokedAt: text("revoked_at"),
    createdAt,
  },
  (table) => [
    uniqueIndex("person_keys_public_key_idx").on(table.publicKey),
    uniqueIndex("person_keys_fingerprint_idx").on(table.fingerprint),
    index("person_keys_person_active_idx").on(table.personId, table.revokedAt),
  ],
);

// The server issues a short-lived, one-time signing challenge after a Person
// registers a browser-held public key. The response and its verification are
// append-only evidence; neither is a substitute for public key recovery or
// revocation policy.
export const personKeyProofChallenges = sqliteTable(
  "person_key_proof_challenges",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    personKeyId: text("person_key_id")
      .notNull()
      .references(() => personKeys.id, { onDelete: "restrict" }),
    nonce: text("nonce").notNull(),
    issuedAt: text("issued_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    canonicalPayload: text("canonical_payload").notNull(),
    payloadHash: text("payload_hash").notNull(),
    createdAt,
  },
  (table) => [index("person_key_proof_challenges_person_key_expiry_idx").on(table.personId, table.personKeyId, table.expiresAt)],
);

export const personKeyProofEvents = sqliteTable(
  "person_key_proof_events",
  {
    id: text("id").primaryKey(),
    challengeId: text("challenge_id")
      .notNull()
      .references(() => personKeyProofChallenges.id, { onDelete: "restrict" }),
    personId: text("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    personKeyId: text("person_key_id")
      .notNull()
      .references(() => personKeys.id, { onDelete: "restrict" }),
    protocolVersion: text("protocol_version").notNull(),
    canonicalPayload: text("canonical_payload").notNull(),
    payloadHash: text("payload_hash").notNull(),
    personSignature: text("person_signature").notNull(),
    verifiedAt: text("verified_at").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("person_key_proof_events_challenge_idx").on(table.challengeId),
    index("person_key_proof_events_key_verified_idx").on(table.personKeyId, table.verifiedAt),
  ],
);

// Revocation is an append-only owner decision. The legacy nullable column on
// person_keys remains for historical compatibility; all new control-plane
// reads use this immutable event as the authoritative key state.
export const personKeyRevocations = sqliteTable(
  "person_key_revocations",
  {
    id: text("id").primaryKey(),
    personKeyId: text("person_key_id")
      .notNull()
      .references(() => personKeys.id, { onDelete: "restrict" }),
    ownerPersonId: text("owner_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    revokedAt: text("revoked_at").notNull(),
    reason: text("reason").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("person_key_revocations_key_idx").on(table.personKeyId),
    index("person_key_revocations_owner_idx").on(table.ownerPersonId, table.revokedAt),
  ],
);

// An Agent remains rooted in exactly one Person. It is never transferred by
// mutation: a future transfer must create an auditable successor relationship.
export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    ownerPersonId: text("owner_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    publicKey: text("public_key").notNull(),
    keyFingerprint: text("key_fingerprint").notNull(),
    status: text("status", { enum: ["active", "revoked"] })
      .notNull()
      .default("active"),
    revokedAt: text("revoked_at"),
    createdAt,
  },
  (table) => [
    uniqueIndex("agents_public_key_idx").on(table.publicKey),
    uniqueIndex("agents_key_fingerprint_idx").on(table.keyFingerprint),
    index("agents_owner_status_idx").on(table.ownerPersonId, table.status),
  ],
);

// The signed certificate is immutable. A revocation is represented by an
// append-only row in delegation_revocations rather than a field update here.
export const delegationCertificates = sqliteTable(
  "delegation_certificates",
  {
    id: text("id").primaryKey(),
    ownerPersonId: text("owner_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    personKeyId: text("person_key_id")
      .notNull()
      .references(() => personKeys.id, { onDelete: "restrict" }),
    agentPublicKey: text("agent_public_key").notNull(),
    scopesJson: text("scopes_json").notNull(),
    validFrom: text("valid_from").notNull(),
    validUntil: text("valid_until").notNull(),
    beneficiaryPersonId: text("beneficiary_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    attributionMode: text("attribution_mode", { enum: ["agent_delegated"] })
      .notNull()
      .default("agent_delegated"),
    protocolVersion: text("protocol_version").notNull(),
    payloadHash: text("payload_hash").notNull(),
    canonicalPayload: text("canonical_payload").notNull(),
    personSignature: text("person_signature").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("delegation_certificates_payload_hash_idx").on(table.payloadHash),
    index("delegation_certificates_owner_validity_idx").on(
      table.ownerPersonId,
      table.validUntil,
    ),
    index("delegation_certificates_agent_validity_idx").on(
      table.agentId,
      table.validUntil,
    ),
  ],
);

export const delegationRevocations = sqliteTable(
  "delegation_revocations",
  {
    id: text("id").primaryKey(),
    delegationCertificateId: text("delegation_certificate_id")
      .notNull()
      .references(() => delegationCertificates.id, { onDelete: "restrict" }),
    ownerPersonId: text("owner_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    revokedAt: text("revoked_at").notNull(),
    reason: text("reason").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("delegation_revocations_certificate_idx").on(
      table.delegationCertificateId,
    ),
    index("delegation_revocations_owner_idx").on(table.ownerPersonId, table.revokedAt),
  ],
);

// An installation identifies the selected delegated Agent for one OAuth
// client. The OAuth service checks the linked certificate on every grant and
// resource request; a revoked certificate makes the installation unusable.
export const agentInstallations = sqliteTable(
  "agent_installations",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    delegationCertificateId: text("delegation_certificate_id")
      .notNull()
      .references(() => delegationCertificates.id, { onDelete: "restrict" }),
    clientId: text("client_id").notNull(),
    label: text("label").notNull(),
    status: text("status", { enum: ["active", "revoked"] })
      .notNull()
      .default("active"),
    revokedAt: text("revoked_at"),
    createdAt,
  },
  (table) => [
    uniqueIndex("agent_installations_agent_client_certificate_idx").on(
      table.agentId,
      table.clientId,
      table.delegationCertificateId,
    ),
    index("agent_installations_person_client_idx").on(table.personId, table.clientId),
  ],
);

// Revoking an OAuth installation is an owner decision distinct from revoking
// the underlying Agent or delegation. The installation row is made unusable
// for immediate enforcement, while this immutable record preserves why.
export const agentInstallationRevocations = sqliteTable(
  "agent_installation_revocations",
  {
    id: text("id").primaryKey(),
    agentInstallationId: text("agent_installation_id")
      .notNull()
      .references(() => agentInstallations.id, { onDelete: "restrict" }),
    ownerPersonId: text("owner_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    revokedAt: text("revoked_at").notNull(),
    reason: text("reason").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("agent_installation_revocations_installation_idx").on(
      table.agentInstallationId,
    ),
    index("agent_installation_revocations_owner_idx").on(
      table.ownerPersonId,
      table.revokedAt,
    ),
  ],
);

export const oauthClients = sqliteTable(
  "oauth_clients",
  {
    id: text("id").primaryKey(),
    clientName: text("client_name").notNull(),
    redirectUrisJson: text("redirect_uris_json").notNull(),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method")
      .notNull()
      .default("none"),
    createdAt,
    revokedAt: text("revoked_at"),
  },
  (table) => [index("oauth_clients_active_idx").on(table.revokedAt)],
);

// A browser-consent page never carries a live OAuth request in its form. This
// short-lived, single-use server record preserves the exact request and the
// hash of its CSRF cookie until the Person approves or declines it.
export const oauthConsentChallenges = sqliteTable(
  "oauth_consent_challenges",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "restrict" }),
    redirectUri: text("redirect_uri").notNull(),
    resource: text("resource").notNull(),
    scopesJson: text("scopes_json").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    state: text("state"),
    csrfTokenHash: text("csrf_token_hash").notNull(),
    issuedAt: text("issued_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    createdAt,
  },
  (table) => [
    index("oauth_consent_challenges_person_expiry_idx").on(
      table.personId,
      table.expiresAt,
    ),
    index("oauth_consent_challenges_expiry_idx").on(table.expiresAt),
  ],
);

// OAuth credential tables keep only SHA-256 hashes. Codes and refresh tokens
// are atomically consumed; access tokens can be explicitly revoked later.
export const oauthAuthorizationCodes = sqliteTable(
  "oauth_authorization_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "restrict" }),
    redirectUri: text("redirect_uri").notNull(),
    resource: text("resource").notNull(),
    personId: text("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    agentInstallationId: text("agent_installation_id")
      .notNull()
      .references(() => agentInstallations.id, { onDelete: "restrict" }),
    scopesJson: text("scopes_json").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    issuedAt: text("issued_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
  },
  (table) => [index("oauth_authorization_codes_expiry_idx").on(table.expiresAt)],
);

export const oauthAccessTokens = sqliteTable(
  "oauth_access_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "restrict" }),
    resource: text("resource").notNull(),
    personId: text("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    agentInstallationId: text("agent_installation_id")
      .notNull()
      .references(() => agentInstallations.id, { onDelete: "restrict" }),
    scopesJson: text("scopes_json").notNull(),
    issuedAt: text("issued_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    index("oauth_access_tokens_expiry_idx").on(table.expiresAt),
    index("oauth_access_tokens_installation_idx").on(table.agentInstallationId, table.revokedAt),
  ],
);

export const oauthRefreshTokens = sqliteTable(
  "oauth_refresh_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "restrict" }),
    resource: text("resource").notNull(),
    personId: text("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    agentInstallationId: text("agent_installation_id")
      .notNull()
      .references(() => agentInstallations.id, { onDelete: "restrict" }),
    scopesJson: text("scopes_json").notNull(),
    issuedAt: text("issued_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    index("oauth_refresh_tokens_expiry_idx").on(table.expiresAt),
    index("oauth_refresh_tokens_installation_idx").on(table.agentInstallationId, table.revokedAt),
  ],
);

// Short-lived, opaque operational counters for the remote MCP resource. The
// bucket key is a server-side SHA-256 digest of a Person and operation, never
// a bearer credential or mathematical contribution record.
export const remoteMcpRateLimitBuckets = sqliteTable(
  "remote_mcp_rate_limit_buckets",
  {
    bucketKey: text("bucket_key").notNull(),
    windowStartedAt: text("window_started_at").notNull(),
    requestCount: integer("request_count").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.bucketKey, table.windowStartedAt] }),
    index("remote_mcp_rate_limit_buckets_retention_idx").on(table.windowStartedAt),
  ],
);

// Raw MCP tokens never reach D1. Store only a SHA-256 digest and a short
// non-secret prefix that lets an owner distinguish tokens in a future UI.
export const mcpAccessTokens = sqliteTable(
  "mcp_access_tokens",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    expiresAt: text("expires_at").notNull(),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
    createdAt,
  },
  (table) => [
    uniqueIndex("mcp_access_tokens_hash_idx").on(table.tokenHash),
    index("mcp_access_tokens_person_idx").on(table.personId, table.revokedAt),
  ],
);

// Attempts record agent-reported activity only. They cannot represent kernel
// acceptance, independent review, or a contribution receipt.
export const agentAttempts = sqliteTable(
  "agent_attempts",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    problemRevisionId: text("problem_revision_id")
      .notNull()
      .references(() => problemRevisions.id, { onDelete: "restrict" }),
    agentId: text("agent_id").references(() => agents.id, { onDelete: "restrict" }),
    delegationCertificateId: text("delegation_certificate_id").references(
      () => delegationCertificates.id,
      { onDelete: "restrict" },
    ),
    delegationScope: text("delegation_scope", {
      enum: ["formalize", "prove"],
    }),
    agentLabel: text("agent_label").notNull(),
    status: text("status", {
      enum: ["active", "submitted", "cancelled"],
    })
      .notNull()
      .default("active"),
    idempotencyKey: text("idempotency_key").notNull(),
    lastProgressPercent: integer("last_progress_percent"),
    createdAt,
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("agent_attempts_person_idempotency_idx").on(
      table.personId,
      table.idempotencyKey,
    ),
    index("agent_attempts_person_updated_idx").on(table.personId, table.updatedAt),
    index("agent_attempts_revision_idx").on(table.problemRevisionId),
    index("agent_attempts_delegation_idx").on(table.delegationCertificateId),
  ],
);

export const agentAttemptEvents = sqliteTable(
  "agent_attempt_events",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => agentAttempts.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    eventType: text("event_type", {
      enum: ["attempt_created", "agent_reported", "checkpoint_published", "bundle_staged"],
    }).notNull(),
    message: text("message").notNull(),
    progressPercent: integer("progress_percent"),
    idempotencyKey: text("idempotency_key").notNull(),
    occurredAt: text("occurred_at").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("agent_attempt_events_sequence_idx").on(
      table.attemptId,
      table.sequence,
    ),
    uniqueIndex("agent_attempt_events_idempotency_idx").on(
      table.attemptId,
      table.idempotencyKey,
    ),
  ],
);

// Public research nodes are immutable, Agent-signed structured milestones.
// Their initial state never implies Lean execution, review, novelty, or credit.
export const researchNodes = sqliteTable(
  "research_nodes",
  {
    id: text("id").primaryKey(),
    problemRevisionId: text("problem_revision_id").notNull().references(() => problemRevisions.id, { onDelete: "restrict" }),
    attemptId: text("attempt_id").notNull().references(() => agentAttempts.id, { onDelete: "restrict" }),
    beneficiaryPersonId: text("beneficiary_person_id").notNull().references(() => persons.id, { onDelete: "restrict" }),
    beneficiaryAgentId: text("beneficiary_agent_id").notNull().references(() => agents.id, { onDelete: "restrict" }),
    delegationCertificateId: text("delegation_certificate_id").notNull().references(() => delegationCertificates.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: ["formalization", "hypothesis", "lemma", "proof_state", "proof_patch", "counterexample", "negative_result", "synthesis"] }).notNull(),
    summary: text("summary").notNull(),
    proofStateHash: text("proof_state_hash"),
    // The SQL migration adds the FK to artifact_bundles. Keep this declaration
    // as text because artifactBundles is declared later in this module.
    artifactBundleManifestHash: text("artifact_bundle_manifest_hash"),
    initialState: text("initial_state", { enum: ["shared_unverified"] }).notNull().default("shared_unverified"),
    payloadHash: text("payload_hash").notNull(),
    checkpointHash: text("checkpoint_hash").notNull(),
    canonicalCheckpoint: text("canonical_checkpoint").notNull(),
    agentEventId: text("agent_event_id").notNull(),
    agentEventOccurredAt: text("agent_event_occurred_at").notNull(),
    agentPublicKey: text("agent_public_key").notNull(),
    agentSignature: text("agent_signature").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("research_nodes_payload_hash_idx").on(table.payloadHash),
    uniqueIndex("research_nodes_checkpoint_hash_idx").on(table.checkpointHash),
    uniqueIndex("research_nodes_agent_event_idx").on(table.agentEventId),
    index("research_nodes_problem_time_idx").on(table.problemRevisionId, table.agentEventOccurredAt),
    index("research_nodes_attempt_time_idx").on(table.attemptId, table.agentEventOccurredAt),
  ],
);

export const researchDerivationEdges = sqliteTable(
  "research_derivation_edges",
  {
    childNodeId: text("child_node_id").notNull().references(() => researchNodes.id, { onDelete: "restrict" }),
    parentNodeId: text("parent_node_id").notNull().references(() => researchNodes.id, { onDelete: "restrict" }),
    relation: text("relation", { enum: ["derives_from", "merges"] }).notNull(),
    declaredByPayloadHash: text("declared_by_payload_hash").notNull().references(() => researchNodes.payloadHash, { onDelete: "restrict" }),
    recordedAt: text("recorded_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.childNodeId, table.parentNodeId] }),
    index("research_derivation_edges_parent_idx").on(table.parentNodeId, table.recordedAt),
  ],
);

export const researchNodeEvents = sqliteTable(
  "research_node_events",
  {
    id: text("id").primaryKey(),
    nodeId: text("node_id").notNull().references(() => researchNodes.id, { onDelete: "restrict" }),
    sequence: integer("sequence").notNull(),
    eventType: text("event_type", { enum: ["published", "superseded", "withdrawn", "verification_recorded"] }).notNull(),
    payloadHash: text("payload_hash").notNull(),
    occurredAt: text("occurred_at").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("research_node_events_sequence_idx").on(table.nodeId, table.sequence),
    uniqueIndex("research_node_events_payload_idx").on(table.payloadHash, table.eventType),
  ],
);

export const externalWorks = sqliteTable(
  "external_works",
  {
    id: text("id").primaryKey(),
    sourceSystem: text("source_system").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceObjectId: text("source_object_id").notNull(),
    sourceRevision: text("source_revision").notNull(),
    title: text("title").notNull(),
    contentHash: text("content_hash").notNull(),
    sourceLicense: text("source_license").notNull(),
    retrievedAt: text("retrieved_at").notNull(),
    assertedByPersonId: text("asserted_by_person_id").references(() => persons.id, { onDelete: "restrict" }),
    createdAt,
  },
  (table) => [
    uniqueIndex("external_works_source_revision_idx").on(table.sourceSystem, table.sourceObjectId, table.sourceRevision),
    index("external_works_asserted_by_idx").on(table.assertedByPersonId, table.retrievedAt),
  ],
);

export const externalWorkProblemLinks = sqliteTable(
  "external_work_problem_links",
  {
    externalWorkId: text("external_work_id").notNull().references(() => externalWorks.id, { onDelete: "restrict" }),
    problemRevisionId: text("problem_revision_id").notNull().references(() => problemRevisions.id, { onDelete: "restrict" }),
    relation: text("relation", { enum: ["prior_work"] }).notNull().default("prior_work"),
    assertedByPersonId: text("asserted_by_person_id").notNull().references(() => persons.id, { onDelete: "restrict" }),
    recordedAt: text("recorded_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.externalWorkId, table.problemRevisionId, table.relation] }),
    index("external_work_problem_links_problem_idx").on(table.problemRevisionId, table.recordedAt),
  ],
);

export const externalAttributions = sqliteTable(
  "external_attributions",
  {
    id: text("id").primaryKey(),
    externalWorkId: text("external_work_id").notNull().references(() => externalWorks.id, { onDelete: "restrict" }),
    displayName: text("display_name").notNull(),
    persistentIdScheme: text("persistent_id_scheme"),
    persistentId: text("persistent_id"),
    role: text("role", { enum: ["author", "formalizer", "prover", "reviewer", "maintainer"] }).notNull(),
    assertionStatus: text("assertion_status", { enum: ["source_asserted", "curator_reviewed", "author_confirmed"] }).notNull(),
    assertedByPersonId: text("asserted_by_person_id").references(() => persons.id, { onDelete: "restrict" }),
    evidenceUrl: text("evidence_url").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("external_attributions_identity_idx").on(table.externalWorkId, table.displayName, table.role, table.evidenceUrl),
    index("external_attributions_work_idx").on(table.externalWorkId, table.assertionStatus),
  ],
);

export const researchNodeCitations = sqliteTable(
  "research_node_citations",
  {
    researchNodeId: text("research_node_id").notNull().references(() => researchNodes.id, { onDelete: "restrict" }),
    externalWorkId: text("external_work_id").notNull().references(() => externalWorks.id, { onDelete: "restrict" }),
    relation: text("relation", { enum: ["builds_on", "formalizes", "refutes", "reproduces"] }).notNull(),
    declaredByPayloadHash: text("declared_by_payload_hash").notNull().references(() => researchNodes.payloadHash, { onDelete: "restrict" }),
    recordedAt: text("recorded_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.researchNodeId, table.externalWorkId, table.relation] }),
    index("research_node_citations_work_idx").on(table.externalWorkId, table.recordedAt),
  ],
);

// A pool fixes a non-financial credit budget and policy for one immutable
// problem revision. Its lifecycle is projected exclusively from append-only
// events; compute and token usage never write to this ledger.
export const problemCreditPools = sqliteTable(
  "problem_credit_pools",
  {
    id: text("id").primaryKey(),
    problemRevisionId: text("problem_revision_id")
      .notNull()
      .unique()
      .references(() => problemRevisions.id, { onDelete: "restrict" }),
    policyVersion: text("policy_version").notNull(),
    unit: text("unit", { enum: ["non_transferable_research_credit"] })
      .notNull()
      .default("non_transferable_research_credit"),
    totalCredits: integer("total_credits").notNull(),
    sponsorLabel: text("sponsor_label").notNull(),
    createdAt,
  },
  (table) => [index("problem_credit_pools_policy_idx").on(table.policyVersion, table.createdAt)],
);

export const problemCreditPoolEvents = sqliteTable(
  "problem_credit_pool_events",
  {
    id: text("id").primaryKey(),
    poolId: text("pool_id")
      .notNull()
      .references(() => problemCreditPools.id, { onDelete: "restrict" }),
    sequence: integer("sequence").notNull(),
    eventType: text("event_type", {
      enum: ["created", "activated", "locked", "settled", "cancelled"],
    }).notNull(),
    payloadHash: text("payload_hash").notNull().unique(),
    canonicalPayload: text("canonical_payload").notNull(),
    occurredAt: text("occurred_at").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("problem_credit_pool_events_sequence_idx").on(table.poolId, table.sequence),
    index("problem_credit_pool_events_occurred_idx").on(table.poolId, table.occurredAt),
  ],
);

// Runs are mutable projections backed by immutable execution events and an
// immutable terminal result. They never constitute mathematical verification.
export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => agentAttempts.id, { onDelete: "restrict" }),
    artifactBundleHash: text("artifact_bundle_hash").notNull(),
    requestHash: text("request_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    state: text("state", {
      enum: [
        "queued",
        "preparing",
        "running",
        "cancel_requested",
        "succeeded",
        "failed",
        "timed_out",
        "rejected",
        "cancelled",
      ],
    })
      .notNull()
      .default("queued"),
    queuedAt: text("queued_at").notNull(),
    preparingAt: text("preparing_at"),
    startedAt: text("started_at"),
    cancelRequestedAt: text("cancel_requested_at"),
    finishedAt: text("finished_at"),
    runnerResultHash: text("runner_result_hash"),
    createdAt,
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("runs_attempt_idempotency_idx").on(table.attemptId, table.idempotencyKey),
    index("runs_state_queued_idx").on(table.state, table.queuedAt),
    index("runs_state_preparing_idx").on(table.state, table.preparingAt),
    index("runs_attempt_updated_idx").on(table.attemptId, table.updatedAt),
  ],
);

export const runEvents = sqliteTable(
  "run_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "restrict" }),
    sequence: integer("sequence").notNull(),
    eventType: text("event_type", {
      enum: [
        "run_queued",
        "run_started",
        "cancellation_requested",
        "run_cancelled",
        "runner_result_recorded",
      ],
    }).notNull(),
    state: text("state").notNull(),
    payloadHash: text("payload_hash").notNull(),
    canonicalPayload: text("canonical_payload").notNull(),
    occurredAt: text("occurred_at").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("run_events_sequence_idx").on(table.runId, table.sequence),
    uniqueIndex("run_events_payload_hash_idx").on(table.payloadHash),
    index("run_events_run_occurred_idx").on(table.runId, table.occurredAt),
  ],
);

export const runResults = sqliteTable(
  "run_results",
  {
    runId: text("run_id")
      .primaryKey()
      .references(() => runs.id, { onDelete: "restrict" }),
    resultHash: text("result_hash").notNull().unique(),
    canonicalResult: text("canonical_result").notNull(),
    receivedAt: text("received_at").notNull(),
    createdAt,
  },
);

// Runner keys are provisioned by operators, never by a participant-facing
// route. A terminal result is accepted only when its key is currently active.
export const runnerKeys = sqliteTable(
  "runner_keys",
  {
    id: text("id").primaryKey(),
    publicKey: text("public_key").notNull().unique(),
    fingerprint: text("fingerprint").notNull().unique(),
    status: text("status", { enum: ["active", "revoked"] }).notNull().default("active"),
    revokedAt: text("revoked_at"),
    createdAt,
  },
  (table) => [index("runner_keys_active_idx").on(table.status, table.revokedAt)],
);

// The selected alpha store keeps bounded bytes in D1; this immutable index
// binds every content hash to exactly one canonical object key and records
// which signed manifests reference it.
export const artifactObjects = sqliteTable(
  "artifact_objects",
  {
    contentHash: text("content_hash").primaryKey(),
    objectKey: text("object_key").notNull().unique(),
    byteLength: integer("byte_length").notNull(),
    contentType: text("content_type").notNull(),
    createdAt,
  },
);

export const inlineArtifactBytes = sqliteTable(
  "inline_artifact_bytes",
  {
    objectKey: text("object_key").primaryKey(),
    contentHash: text("content_hash").notNull().unique(),
    byteLength: integer("byte_length").notNull(),
    contentType: text("content_type").notNull(),
    bytes: blob("bytes", { mode: "buffer" }).notNull(),
    createdAt,
  },
);

export const artifactBundles = sqliteTable(
  "artifact_bundles",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => agentAttempts.id, { onDelete: "restrict" }),
    problemRevisionId: text("problem_revision_id")
      .notNull()
      .references(() => problemRevisions.id, { onDelete: "restrict" }),
    manifestHash: text("manifest_hash")
      .notNull()
      .unique()
      .references(() => artifactObjects.contentHash, { onDelete: "restrict" }),
    manifestKey: text("manifest_key").notNull().unique(),
    canonicalManifest: text("canonical_manifest").notNull(),
    agentEventId: text("agent_event_id").notNull().unique(),
    agentEventPayloadHash: text("agent_event_payload_hash").notNull(),
    createdAt,
  },
  (table) => [
    index("artifact_bundles_attempt_created_idx").on(table.attemptId, table.createdAt),
    index("artifact_bundles_revision_created_idx").on(table.problemRevisionId, table.createdAt),
  ],
);

// A staged Bundle earns one immediate, owner-visible evidence record. This is
// deliberately not a mathematical claim or a Contribution Receipt: it records
// that a valid delegated Agent supplied a complete signed Bundle, while Lean,
// independent review, novelty, and project acceptance remain separate gates.
export const provisionalContributions = sqliteTable(
  "provisional_contributions",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["evidence_bundle"] }).notNull(),
    state: text("state", { enum: ["bundle_staged"] }).notNull(),
    beneficiaryPersonId: text("beneficiary_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    beneficiaryAgentId: text("beneficiary_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    beneficiaryDelegationCertificateId: text("beneficiary_delegation_certificate_id")
      .notNull()
      .references(() => delegationCertificates.id, { onDelete: "restrict" }),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => agentAttempts.id, { onDelete: "restrict" }),
    problemRevisionId: text("problem_revision_id")
      .notNull()
      .references(() => problemRevisions.id, { onDelete: "restrict" }),
    artifactBundleManifestHash: text("artifact_bundle_manifest_hash")
      .notNull()
      .unique()
      .references(() => artifactBundles.manifestHash, { onDelete: "restrict" }),
    agentEventId: text("agent_event_id").notNull().unique(),
    agentEventOccurredAt: text("agent_event_occurred_at").notNull(),
    recordedAt: text("recorded_at").notNull(),
    createdAt,
  },
  (table) => [
    index("provisional_contributions_person_recorded_idx").on(table.beneficiaryPersonId, table.recordedAt),
    index("provisional_contributions_attempt_idx").on(table.attemptId),
  ],
);

// Runner stdout/stderr are signed infrastructure evidence, not Agent-owned
// Bundle objects. Both bytes must be immutable and present before a terminal
// signed Run result may reference their hashes.
export const runnerOutputArtifacts = sqliteTable(
  "runner_output_artifacts",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "restrict" }),
    role: text("role", { enum: ["stdout", "stderr"] }).notNull(),
    contentHash: text("content_hash").notNull(),
    objectKey: text("object_key").notNull(),
    byteLength: integer("byte_length").notNull(),
    contentType: text("content_type").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("runner_output_artifacts_run_role_idx").on(table.runId, table.role),
    index("runner_output_artifacts_hash_idx").on(table.contentHash),
  ],
);

// Assignment identity and every review event are retained so a later receipt
// can prove that its verifier belonged to a different Person than the Attempt.
export const verificationAssignments = sqliteTable(
  "verification_assignments",
  {
    id: text("id").primaryKey(),
    artifactBundleManifestHash: text("artifact_bundle_manifest_hash")
      .notNull()
      .references(() => artifactBundles.manifestHash, { onDelete: "restrict" }),
    claimType: text("claim_type", {
      enum: [
        "bundle_reproducible",
        "kernel_accepted",
        "statement_faithful",
        "novelty_reviewed",
        "project_accepted",
      ],
    }).notNull(),
    attemptOwnerPersonId: text("attempt_owner_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    verifierPersonId: text("verifier_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    status: text("status", {
      enum: ["assigned", "accepted", "declined", "completed", "cancelled"],
    })
      .notNull()
      .default("assigned"),
    assignedAt: text("assigned_at").notNull(),
    acceptedAt: text("accepted_at"),
    declinedAt: text("declined_at"),
    completedAt: text("completed_at"),
    createdAt,
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("verification_assignments_unique_reviewer_idx").on(
      table.artifactBundleManifestHash,
      table.claimType,
      table.verifierPersonId,
    ),
    index("verification_assignments_verifier_status_idx").on(table.verifierPersonId, table.status),
    index("verification_assignments_bundle_claim_idx").on(table.artifactBundleManifestHash, table.claimType),
  ],
);

// A replay is not a review decision. It is the immutable provenance link
// between an accepted independent-review assignment and a new, isolated Run
// of the exact staged Bundle. The reviewer Agent never receives the
// submitter's Attempt-level Run authority.
export const verificationReplays = sqliteTable(
  "verification_replays",
  {
    id: text("id").primaryKey(),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => verificationAssignments.id, { onDelete: "restrict" }),
    runId: text("run_id")
      .notNull()
      .unique()
      .references(() => runs.id, { onDelete: "restrict" }),
    artifactBundleManifestHash: text("artifact_bundle_manifest_hash")
      .notNull()
      .references(() => artifactBundles.manifestHash, { onDelete: "restrict" }),
    requesterPersonId: text("requester_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    requesterAgentId: text("requester_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    delegationCertificateId: text("delegation_certificate_id")
      .notNull()
      .references(() => delegationCertificates.id, { onDelete: "restrict" }),
    agentInstallationId: text("agent_installation_id")
      .notNull()
      .references(() => agentInstallations.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    requestedAt: text("requested_at").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("verification_replays_assignment_actor_idempotency_idx").on(
      table.assignmentId,
      table.requesterAgentId,
      table.delegationCertificateId,
      table.idempotencyKey,
    ),
    index("verification_replays_assignment_requested_idx").on(table.assignmentId, table.requestedAt),
    index("verification_replays_run_idx").on(table.runId),
  ],
);

// A materialized, signed Runner result for a fresh independent replay. The
// content-addressed evidence object remains infrastructure evidence until the
// assigned review Agent separately signs an explicit claim.
export const verificationReplayEvidence = sqliteTable(
  "verification_replay_evidence",
  {
    id: text("id").primaryKey(),
    replayId: text("replay_id")
      .notNull()
      .unique()
      .references(() => verificationReplays.id, { onDelete: "restrict" }),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => verificationAssignments.id, { onDelete: "restrict" }),
    runId: text("run_id")
      .notNull()
      .unique()
      .references(() => runs.id, { onDelete: "restrict" }),
    artifactBundleManifestHash: text("artifact_bundle_manifest_hash")
      .notNull()
      .references(() => artifactBundles.manifestHash, { onDelete: "restrict" }),
    runnerResultHash: text("runner_result_hash").notNull(),
    evidenceHash: text("evidence_hash")
      .notNull()
      .unique()
      .references(() => artifactObjects.contentHash, { onDelete: "restrict" }),
    canonicalEvidence: text("canonical_evidence").notNull(),
    recordedAt: text("recorded_at").notNull(),
    createdAt,
  },
  (table) => [
    index("verification_replay_evidence_assignment_idx").on(table.assignmentId, table.recordedAt),
  ],
);

export const verificationAssignmentEvents = sqliteTable(
  "verification_assignment_events",
  {
    id: text("id").primaryKey(),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => verificationAssignments.id, { onDelete: "restrict" }),
    sequence: integer("sequence").notNull(),
    eventType: text("event_type", {
      enum: ["assignment_created", "assignment_accepted", "assignment_declined", "attestation_recorded"],
    }).notNull(),
    status: text("status").notNull(),
    payloadHash: text("payload_hash").notNull(),
    canonicalPayload: text("canonical_payload").notNull(),
    occurredAt: text("occurred_at").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("verification_assignment_events_sequence_idx").on(table.assignmentId, table.sequence),
    uniqueIndex("verification_assignment_events_payload_idx").on(table.payloadHash),
    index("verification_assignment_events_occurred_idx").on(table.assignmentId, table.occurredAt),
  ],
);

export const verificationAttestations = sqliteTable(
  "verification_attestations",
  {
    id: text("id").primaryKey(),
    assignmentId: text("assignment_id")
      .notNull()
      .unique()
      .references(() => verificationAssignments.id, { onDelete: "restrict" }),
    artifactBundleManifestHash: text("artifact_bundle_manifest_hash")
      .notNull()
      .references(() => artifactBundles.manifestHash, { onDelete: "restrict" }),
    claimType: text("claim_type").notNull(),
    verifierPersonId: text("verifier_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    verifierAgentId: text("verifier_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    delegationCertificateId: text("delegation_certificate_id")
      .notNull()
      .references(() => delegationCertificates.id, { onDelete: "restrict" }),
    verifierAgentPublicKey: text("verifier_agent_public_key").notNull(),
    decision: text("decision", {
      enum: ["attested", "rejected", "request_changes", "conflict_declared", "integrity_flagged"],
    }).notNull(),
    evidenceHash: text("evidence_hash")
      .notNull()
      .references(() => artifactObjects.contentHash, { onDelete: "restrict" }),
    canonicalPayload: text("canonical_payload").notNull(),
    payloadHash: text("payload_hash").notNull(),
    signature: text("signature").notNull(),
    attestedAt: text("attested_at").notNull(),
    createdAt,
  },
  (table) => [
    index("verification_attestations_bundle_claim_idx").on(table.artifactBundleManifestHash, table.claimType),
    index("verification_attestations_verifier_idx").on(table.verifierPersonId, table.attestedAt),
  ],
);

// The canonical JSON contains the complete claims and dependency-receipt
// evidence. These indexed columns make recipient and source queries possible
// without mutating the signed payload.
export const contributionReceipts = sqliteTable(
  "contribution_receipts",
  {
    id: text("id").primaryKey(),
    kind: text("kind", {
      enum: ["formalization", "lemma", "proof_patch", "counterexample", "verification", "synthesis", "infrastructure"],
    }).notNull(),
    beneficiaryPersonId: text("beneficiary_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    beneficiaryAgentId: text("beneficiary_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    beneficiaryDelegationCertificateId: text("beneficiary_delegation_certificate_id")
      .notNull()
      .references(() => delegationCertificates.id, { onDelete: "restrict" }),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => agentAttempts.id, { onDelete: "restrict" }),
    problemRevisionId: text("problem_revision_id")
      .notNull()
      .references(() => problemRevisions.id, { onDelete: "restrict" }),
    artifactBundleManifestHash: text("artifact_bundle_manifest_hash")
      .notNull()
      .references(() => artifactBundles.manifestHash, { onDelete: "restrict" }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "restrict" }),
    receiptHash: text("receipt_hash").notNull().unique(),
    canonicalReceipt: text("canonical_receipt").notNull(),
    payloadHash: text("payload_hash").notNull(),
    issuerKeyId: text("issuer_key_id").notNull(),
    issuerPublicKey: text("issuer_public_key").notNull(),
    issuerSignature: text("issuer_signature").notNull(),
    issuedAt: text("issued_at").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("contribution_receipts_evidence_beneficiary_idx").on(
      table.artifactBundleManifestHash,
      table.kind,
      table.beneficiaryPersonId,
      table.beneficiaryAgentId,
      table.beneficiaryDelegationCertificateId,
    ),
    index("contribution_receipts_person_issued_idx").on(table.beneficiaryPersonId, table.issuedAt),
    index("contribution_receipts_attempt_idx").on(table.attemptId),
  ],
);

// Operator-managed registry for the public keys that may sign new Contribution
// Receipts. Historical receipts retain their embedded key and are checked
// against this registry at their own issuance time.
export const contributionReceiptIssuerKeys = sqliteTable(
  "contribution_receipt_issuer_keys",
  {
    id: text("id").primaryKey(),
    publicKey: text("public_key").notNull().unique(),
    status: text("status", { enum: ["active", "retired", "revoked"] }).notNull(),
    validFrom: text("valid_from").notNull(),
    retiredAt: text("retired_at"),
    revokedAt: text("revoked_at"),
    createdAt,
  },
  (table) => [index("contribution_receipt_issuer_keys_status_valid_from_idx").on(table.status, table.validFrom)],
);

// An audit trail for activation, rotation retirement, and emergency revocation.
// It is intentionally separate from immutable receipt payloads.
export const contributionReceiptIssuerKeyEvents = sqliteTable(
  "contribution_receipt_issuer_key_events",
  {
    id: text("id").primaryKey(),
    keyId: text("key_id")
      .notNull()
      .references(() => contributionReceiptIssuerKeys.id, { onDelete: "restrict" }),
    eventType: text("event_type", { enum: ["activated", "retired", "revoked"] }).notNull(),
    relatedKeyId: text("related_key_id").references(() => contributionReceiptIssuerKeys.id, { onDelete: "restrict" }),
    occurredAt: text("occurred_at").notNull(),
    createdAt,
  },
  (table) => [index("contribution_receipt_issuer_key_events_key_idx").on(table.keyId, table.occurredAt, table.id)],
);

// An immutable query projection of dependencyReceipts inside the signed
// canonical receipt. The receipt store inserts this only after it verifies the
// referenced upstream receipt hash and issuer signature.
export const contributionReceiptDependencyEdges = sqliteTable(
  "contribution_receipt_dependency_edges",
  {
    downstreamReceiptId: text("downstream_receipt_id")
      .notNull()
      .references(() => contributionReceipts.id, { onDelete: "restrict" }),
    upstreamReceiptId: text("upstream_receipt_id")
      .notNull()
      .references(() => contributionReceipts.id, { onDelete: "restrict" }),
    upstreamReceiptHash: text("upstream_receipt_hash").notNull(),
    declaredByBundleManifestHash: text("declared_by_bundle_manifest_hash")
      .notNull()
      .references(() => artifactBundles.manifestHash, { onDelete: "restrict" }),
    recordedAt: text("recorded_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.downstreamReceiptId, table.upstreamReceiptId] }),
    index("contribution_receipt_dependency_edges_upstream_idx").on(
      table.upstreamReceiptId,
      table.recordedAt,
    ),
  ],
);

// Corrections, supersessions, and retractions are signed append-only evidence;
// no receipt status is ever updated in place.
export const contributionReceiptLifecycleEvents = sqliteTable(
  "contribution_receipt_lifecycle_events",
  {
    id: text("id").primaryKey(),
    receiptId: text("receipt_id")
      .notNull()
      .references(() => contributionReceipts.id, { onDelete: "restrict" }),
    eventType: text("event_type", { enum: ["corrected", "superseded", "retracted"] }).notNull(),
    replacementReceiptId: text("replacement_receipt_id")
      .references(() => contributionReceipts.id, { onDelete: "restrict" }),
    reasonHash: text("reason_hash").notNull(),
    occurredAt: text("occurred_at").notNull(),
    issuerKeyId: text("issuer_key_id").notNull(),
    issuerPublicKey: text("issuer_public_key").notNull(),
    canonicalPayload: text("canonical_payload").notNull(),
    payloadHash: text("payload_hash").notNull(),
    issuerSignature: text("issuer_signature").notNull(),
    createdAt,
  },
  (table) => [
    index("contribution_receipt_lifecycle_events_receipt_idx").on(
      table.receiptId,
      table.occurredAt,
      table.id,
    ),
    index("contribution_receipt_lifecycle_events_replacement_idx").on(table.replacementReceiptId),
  ],
);
