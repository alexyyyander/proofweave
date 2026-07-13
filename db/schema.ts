import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
      enum: ["attempt_created", "agent_reported", "bundle_staged"],
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
