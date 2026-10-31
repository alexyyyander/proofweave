import { getAccountAuthD1 as getD1 } from "@/db";

export type AccountProvider = "chatgpt" | "google" | "proofweave";

export type AccountIdentityInput = Readonly<{
  provider: AccountProvider;
  subject: string;
  displayName: string;
  email?: string | null;
  emailVerified?: boolean;
  linkVerifiedEmail?: boolean;
}>;

export type ResolvedAccountIdentity = Readonly<{
  identityId: string;
  personId: string;
  provider: AccountProvider;
  subject: string;
  displayName: string;
  email: string | null;
}>;

export type AccountSession = ResolvedAccountIdentity & Readonly<{
  sessionId: string;
  expiresAt: string;
}>;

type IdentityRow = {
  identity_id: string;
  person_id: string;
  provider: AccountProvider;
  provider_subject: string;
  display_name: string;
  email: string | null;
};

export class AmbiguousVerifiedEmailError extends Error {
  constructor() {
    super("This verified email is already associated with more than one Person record.");
    this.name = "AmbiguousVerifiedEmailError";
  }
}

export class AccountAuthRepository {
  async resolveIdentity(input: AccountIdentityInput): Promise<ResolvedAccountIdentity> {
    const normalized = normalizeIdentity(input);
    const existing = await this.findIdentity(normalized.provider, normalized.subject);
    if (existing) {
      await this.updateIdentity(existing.identity_id, normalized);
      return { ...toResolved(existing), displayName: normalized.displayName, email: normalized.email };
    }

    const legacy = await getD1()
      .prepare(
        `SELECT id, display_name
         FROM persons
         WHERE identity_provider = ? AND provider_subject = ?`,
      )
      .bind(normalized.provider, normalized.subject)
      .first<{ id: string; display_name: string }>();

    let personId = legacy?.id ?? null;
    // A Person already bound to an immutable Sites subject must not be
    // claimed by another provider through a current or legacy email alias.
    if (!personId && input.linkVerifiedEmail !== false && normalized.emailVerified && normalized.emailNormalized) {
      const matches = await getD1()
        .prepare(
          `SELECT DISTINCT identity.person_id
           FROM person_identities AS identity
           WHERE identity.email_normalized = ? AND identity.email_verified_at IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM person_identities AS bridge
               WHERE bridge.person_id = identity.person_id
                 AND bridge.provider = 'chatgpt' AND bridge.provider_subject LIKE 'sites:%'
             )
           LIMIT 2`,
        )
        .bind(normalized.emailNormalized)
        .all<{ person_id: string }>();
      const personIds = matches.results.map((row: { person_id: string }) => row.person_id);
      if (personIds.length > 1) throw new AmbiguousVerifiedEmailError();
      personId = personIds[0] ?? null;
    }

    return this.insertIdentity(normalized, personId, !legacy);
  }

  async resolveSitesBridgeIdentity(input: { siteId: string; userId: string; email: string; displayName: string }): Promise<ResolvedAccountIdentity> {
    const subject = `sites:${await sha256(JSON.stringify([input.siteId, input.userId]))}`;
    const normalized = normalizeIdentity({ provider: "chatgpt", subject,
      email: input.email, displayName: input.displayName, emailVerified: true });
    const existing = await this.findIdentity("chatgpt", subject);
    if (existing) {
      // The stable Sites subject owns this Person; email is mutable metadata.
      await this.updateIdentity(existing.identity_id, normalized);
      return { ...toResolved(existing), email: normalized.email, displayName: normalized.displayName };
    }
    // The original Site authenticated these exact legacy ChatGPT subjects.
    // Do not link to Google or other providers merely because email matches.
    const email = normalizeEmail(input.email);
    const candidates = await getD1().prepare(
      `SELECT candidate.person_id FROM (
         SELECT person_id FROM person_identities WHERE provider = 'chatgpt' AND provider_subject = ?
         UNION SELECT id AS person_id FROM persons WHERE identity_provider = 'chatgpt' AND provider_subject = ?
       ) AS candidate
       WHERE NOT EXISTS (
         SELECT 1 FROM person_identities AS bridge
         WHERE bridge.person_id = candidate.person_id
           AND bridge.provider = 'chatgpt' AND bridge.provider_subject LIKE 'sites:%'
       )`,
    ).bind(email, email).all<{ person_id: string }>();
    const ids = [...new Set<string>(candidates.results.map((row: { person_id: string }) => row.person_id))];
    if (ids.length > 1) throw new AmbiguousVerifiedEmailError();
    return this.insertIdentity(normalized, ids[0] ?? null, true);
  }

  private async insertIdentity(
    normalized: ReturnType<typeof normalizeIdentity>,
    candidatePersonId: string | null,
    guardStableSites: boolean,
  ): Promise<ResolvedAccountIdentity> {
    const database = getD1();
    const now = new Date().toISOString();
    const identityId = newId("identity");
    const personId = newId("person");
    const statements = [];
    if (candidatePersonId) {
      // The earlier read finds candidates, but only this conditional write
      // claims one. D1/libSQL serialize the guard and insert in the batch.
      statements.push(database.prepare(
        `INSERT INTO person_identities (
           id, person_id, provider, provider_subject, email, email_normalized,
           display_name, email_verified_at, updated_at
         ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE ? = 0 OR NOT EXISTS (
           SELECT 1 FROM person_identities
           WHERE person_id = ? AND provider = 'chatgpt' AND provider_subject LIKE 'sites:%'
         )
         ON CONFLICT(provider, provider_subject) DO NOTHING`,
      ).bind(identityId, candidatePersonId, normalized.provider, normalized.subject, normalized.email, normalized.emailNormalized,
        normalized.displayName, normalized.emailVerified ? now : null, now, guardStableSites ? 1 : 0, candidatePersonId));
    }
    // A lost claim receives a separate Person. Same-subject retries reuse
    // the winning mapping without creating orphan Persons or identities.
    statements.push(database.prepare(
      `INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at)
       SELECT ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM person_identities WHERE provider = ? AND provider_subject = ?
       )
       ON CONFLICT(identity_provider, provider_subject) DO NOTHING`,
    ).bind(personId, normalized.provider, normalized.subject, normalized.displayName, now, normalized.provider, normalized.subject));
    statements.push(database.prepare(
      `INSERT INTO person_identities (
         id, person_id, provider, provider_subject, email, email_normalized,
         display_name, email_verified_at, updated_at
       ) SELECT ?, person.id, ?, ?, ?, ?, ?, ?, ?
       FROM persons AS person
       WHERE person.identity_provider = ? AND person.provider_subject = ?
       ON CONFLICT(provider, provider_subject) DO NOTHING`,
    ).bind(identityId, normalized.provider, normalized.subject, normalized.email, normalized.emailNormalized,
      normalized.displayName, normalized.emailVerified ? now : null, now, normalized.provider, normalized.subject));
    await database.batch(statements);
    const resolved = await this.findIdentity(normalized.provider, normalized.subject);
    if (!resolved) throw new Error("Account identity mapping did not produce a readable record.");
    await this.updateIdentity(resolved.identity_id, normalized);
    return { ...toResolved(resolved), email: normalized.email, displayName: normalized.displayName };
  }

  async createSession(
    identity: ResolvedAccountIdentity,
    lifetimeSeconds = 60 * 60 * 24 * 30,
  ): Promise<{ token: string; session: AccountSession }> {
    const token = randomBase64Url(32);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + lifetimeSeconds * 1000).toISOString();
    const sessionId = newId("session");
    await getD1()
      .prepare(
        `INSERT INTO app_sessions (
           id, person_id, identity_id, token_hash, expires_at, created_at, last_seen_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        sessionId,
        identity.personId,
        identity.identityId,
        await sha256(token),
        expiresAt,
        now.toISOString(),
        now.toISOString(),
      )
      .run();
    return {
      token,
      session: { ...identity, sessionId, expiresAt },
    };
  }

  async findSession(token: string): Promise<AccountSession | null> {
    if (!token || token.length > 512) return null;
    const row = await getD1()
      .prepare(
        `SELECT session.id AS session_id, session.expires_at,
                identity.id AS identity_id, identity.person_id,
                identity.provider, identity.provider_subject,
                identity.display_name, identity.email
         FROM app_sessions AS session
         INNER JOIN person_identities AS identity ON identity.id = session.identity_id
         WHERE session.token_hash = ?
           AND session.revoked_at IS NULL
           AND session.expires_at > ?`,
      )
      .bind(await sha256(token), new Date().toISOString())
      .first<IdentityRow & { session_id: string; expires_at: string }>();
    if (!row) return null;
    return {
      ...toResolved(row),
      sessionId: row.session_id,
      expiresAt: row.expires_at,
    };
  }

  async revokeSession(token: string): Promise<void> {
    if (!token || token.length > 512) return;
    await getD1()
      .prepare(
        `UPDATE app_sessions
         SET revoked_at = ?
         WHERE token_hash = ? AND revoked_at IS NULL`,
      )
      .bind(new Date().toISOString(), await sha256(token))
      .run();
  }

  private async findIdentity(provider: AccountProvider, subject: string): Promise<IdentityRow | null> {
    return getD1()
      .prepare(
        `SELECT id AS identity_id, person_id, provider, provider_subject, display_name, email
         FROM person_identities
         WHERE provider = ? AND provider_subject = ?`,
      )
      .bind(provider, subject)
      .first<IdentityRow>();
  }

  private async updateIdentity(
    identityId: string,
    input: ReturnType<typeof normalizeIdentity>,
  ): Promise<void> {
    const now = new Date().toISOString();
    await getD1()
      .prepare(
        `UPDATE person_identities
         SET display_name = ?, email = ?, email_normalized = ?,
             email_verified_at = CASE
               WHEN ? = 1 THEN COALESCE(email_verified_at, ?)
               ELSE email_verified_at
             END,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        input.displayName,
        input.email,
        input.emailNormalized,
        input.emailVerified ? 1 : 0,
        now,
        now,
        identityId,
      )
      .run();
  }

}

export function getAccountAuthRepository(): AccountAuthRepository {
  return new AccountAuthRepository();
}

function normalizeIdentity(input: AccountIdentityInput) {
  const subject = required(input.subject, "identity subject", 320);
  const displayName = required(input.displayName, "display name", 160);
  const email = input.email ? normalizeEmail(input.email) : null;
  return {
    provider: input.provider,
    subject: input.provider === "google" ? subject : subject.toLowerCase(),
    displayName,
    email,
    emailNormalized: email,
    emailVerified: Boolean(
      input.emailVerified && email && (input.provider === "chatgpt" || input.provider === "google"),
    ),
  };
}

function normalizeEmail(value: string): string {
  const email = required(value, "email", 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("email is invalid.");
  return email;
}

function required(value: string, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value.trim();
}

function toResolved(row: IdentityRow): ResolvedAccountIdentity {
  return {
    identityId: row.identity_id,
    personId: row.person_id,
    provider: row.provider,
    subject: row.provider_subject,
    displayName: row.display_name,
    email: row.email,
  };
}

function newId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function randomBase64Url(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
