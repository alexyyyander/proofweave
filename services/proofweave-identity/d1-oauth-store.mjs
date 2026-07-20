import { delegationAllowsOAuthScopes } from "./delegation-scope-policy.mjs";

/**
 * D1 persistence adapter for Proofweave OAuth. It stores only SHA-256 hashes
 * of codes and tokens. The caller owns raw credential generation and never
 * writes those values to D1.
 */
export class D1ProofweaveOAuthStore {
  constructor(database) {
    this.database = database;
  }

  async findClient(clientId, redirectUri) {
    const row = await this.database
      .prepare("SELECT id, client_name, redirect_uris_json FROM oauth_clients WHERE id = ? AND revoked_at IS NULL")
      .bind(clientId)
      .first();
    if (!row || !parseStringArray(row.redirect_uris_json)?.includes(redirectUri)) return null;
    return { id: row.id, clientName: row.client_name };
  }

  async findChatGPTPerson(providerSubject) {
    const normalized = typeof providerSubject === "string" ? providerSubject.trim().toLowerCase() : "";
    if (!normalized) return null;
    const row = await this.database
      .prepare(
        `SELECT person.id, identity.display_name
         FROM person_identities AS identity
         INNER JOIN persons AS person ON person.id = identity.person_id
         WHERE identity.provider = 'chatgpt' AND identity.provider_subject = ?
         UNION ALL
         SELECT id, display_name
         FROM persons
         WHERE identity_provider = 'chatgpt' AND provider_subject = ?
         LIMIT 1`,
      )
      .bind(normalized, normalized)
      .first();
    return row ? { id: row.id, displayName: row.display_name } : null;
  }

  async findAppSessionPerson(tokenHash) {
    const normalized = typeof tokenHash === "string" ? tokenHash.trim().toLowerCase() : "";
    if (!/^[a-f0-9]{64}$/.test(normalized)) return null;
    const row = await this.database
      .prepare(
        `SELECT person.id, identity.display_name
         FROM app_sessions AS session
         INNER JOIN person_identities AS identity ON identity.id = session.identity_id
         INNER JOIN persons AS person ON person.id = session.person_id
         WHERE session.token_hash = ?
           AND session.revoked_at IS NULL
           AND session.expires_at > ?
           AND identity.person_id = session.person_id`,
      )
      .bind(normalized, new Date().toISOString())
      .first();
    return row ? { id: row.id, displayName: row.display_name } : null;
  }

  async findAgentInstallation(personId, installationId, clientId, requiredScope = null) {
    const now = new Date().toISOString();
    const row = await this.database
      .prepare(
        `SELECT installation.id, certificate.scopes_json
         FROM agent_installations AS installation
         INNER JOIN agents AS agent ON agent.id = installation.agent_id
         INNER JOIN delegation_certificates AS certificate
           ON certificate.id = installation.delegation_certificate_id
         LEFT JOIN delegation_revocations AS revocation
           ON revocation.delegation_certificate_id = certificate.id
         INNER JOIN person_keys AS signer ON signer.id = certificate.person_key_id
         LEFT JOIN person_key_revocations AS key_revocation ON key_revocation.person_key_id = signer.id
         WHERE installation.id = ?
           AND installation.person_id = ?
           AND installation.client_id = ?
           AND installation.status = 'active'
           AND installation.revoked_at IS NULL
           AND agent.owner_person_id = installation.person_id
           AND agent.status = 'active'
           AND agent.revoked_at IS NULL
           AND certificate.owner_person_id = installation.person_id
           AND certificate.beneficiary_person_id = installation.person_id
           AND certificate.agent_id = installation.agent_id
           AND certificate.valid_from <= ?
           AND certificate.valid_until > ?
           AND revocation.id IS NULL
           AND COALESCE(key_revocation.revoked_at, signer.revoked_at) IS NULL`,
      )
      .bind(installationId, personId, clientId, now, now)
      .first();
    const scopes = row && parseStringArray(row.scopes_json);
    if (!row || !scopes || !delegationMeetsRequirement(scopes, requiredScope)) return null;
    return { id: row.id, delegationScopes: scopes };
  }

  async listEligibleAgents(personId, oauthScopes) {
    const now = new Date().toISOString();
    const result = await this.database
      .prepare(
        `SELECT agent.id AS agent_id, agent.label AS agent_label,
                certificate.id AS delegation_certificate_id,
                certificate.scopes_json, certificate.valid_until
         FROM agents AS agent
         INNER JOIN delegation_certificates AS certificate ON certificate.agent_id = agent.id
         INNER JOIN person_keys AS signer ON signer.id = certificate.person_key_id
         LEFT JOIN delegation_revocations AS revocation
           ON revocation.delegation_certificate_id = certificate.id
         LEFT JOIN person_key_revocations AS key_revocation ON key_revocation.person_key_id = signer.id
         WHERE agent.owner_person_id = ?
           AND agent.status = 'active'
           AND agent.revoked_at IS NULL
           AND certificate.owner_person_id = agent.owner_person_id
           AND certificate.beneficiary_person_id = agent.owner_person_id
           AND certificate.valid_from <= ?
           AND certificate.valid_until > ?
           AND revocation.id IS NULL
           AND COALESCE(key_revocation.revoked_at, signer.revoked_at) IS NULL
         ORDER BY agent.label ASC, certificate.valid_until ASC`,
      )
      .bind(personId, now, now)
      .all();

    return (result.results ?? [])
      .map((row) => ({
        agentId: row.agent_id,
        agentLabel: row.agent_label,
        delegationCertificateId: row.delegation_certificate_id,
        delegationScopes: parseStringArray(row.scopes_json),
        validUntil: row.valid_until,
      }))
      .filter((candidate) =>
        candidate.delegationScopes && delegationAllowsOAuthScopes(oauthScopes, candidate.delegationScopes),
      );
  }

  async ensureAgentInstallation({ personId, clientId, agentId, delegationCertificateId }) {
    const candidates = await this.listEligibleAgents(personId, []);
    const candidate = candidates.find(
      (value) =>
        value.agentId === agentId &&
        value.delegationCertificateId === delegationCertificateId,
    );
    if (!candidate) return null;

    const active = await this.database
      .prepare(
        `SELECT id
         FROM agent_installations
         WHERE person_id = ?
           AND agent_id = ?
           AND delegation_certificate_id = ?
           AND client_id = ?
           AND status = 'active'
           AND revoked_at IS NULL`,
      )
      .bind(personId, candidate.agentId, candidate.delegationCertificateId, clientId)
      .first();
    if (active) return { id: active.id, delegationScopes: candidate.delegationScopes };

    const installationId = `agent-installation:${crypto.randomUUID()}`;
    await this.database
      .prepare(
        `INSERT INTO agent_installations (
          id, person_id, agent_id, delegation_certificate_id, client_id, label
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING`,
      )
      .bind(
        installationId,
        personId,
        candidate.agentId,
        candidate.delegationCertificateId,
        clientId,
        `${candidate.agentLabel} · MCP`,
      )
      .run();

    // A concurrent approval may have created the one permitted active row.
    // Return that row rather than creating a second connection or reviving a
    // revoked installation.
    const row = await this.database
      .prepare(
        `SELECT id
         FROM agent_installations
         WHERE person_id = ?
           AND agent_id = ?
           AND delegation_certificate_id = ?
           AND client_id = ?
           AND status = 'active'
           AND revoked_at IS NULL`,
      )
      .bind(personId, candidate.agentId, candidate.delegationCertificateId, clientId)
      .first();
    return row ? { id: row.id, delegationScopes: candidate.delegationScopes } : null;
  }

  async createConsentChallenge(record) {
    const id = `oauth-consent:${crypto.randomUUID()}`;
    await this.database
      .prepare(
        `INSERT INTO oauth_consent_challenges (
          id, person_id, client_id, redirect_uri, resource, scopes_json,
          code_challenge, state, csrf_token_hash, issued_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        record.personId,
        record.clientId,
        record.redirectUri,
        record.resource,
        JSON.stringify(record.scopes),
        record.codeChallenge,
        record.state,
        record.csrfTokenHash,
        record.issuedAt,
        record.expiresAt,
      )
      .run();
    return { id };
  }

  async consumeConsentChallenge({ id, personId, csrfTokenHash, consumedAt }) {
    const row = await this.database
      .prepare(
        `SELECT client_id, redirect_uri, resource, scopes_json, code_challenge, state, expires_at
         FROM oauth_consent_challenges
         WHERE id = ?
           AND person_id = ?
           AND csrf_token_hash = ?
           AND consumed_at IS NULL
           AND expires_at > ?`,
      )
      .bind(id, personId, csrfTokenHash, consumedAt)
      .first();
    if (!row) return null;

    const changed = await this.database
      .prepare(
        `UPDATE oauth_consent_challenges
         SET consumed_at = ?
         WHERE id = ?
           AND person_id = ?
           AND csrf_token_hash = ?
           AND consumed_at IS NULL
           AND expires_at > ?`,
      )
      .bind(consumedAt, id, personId, csrfTokenHash, consumedAt)
      .run();
    if (changed.meta.changes !== 1) return null;

    const scopes = parseStringArray(row.scopes_json);
    if (!scopes) return null;
    return {
      clientId: row.client_id,
      redirectUri: row.redirect_uri,
      resource: row.resource,
      scopes,
      codeChallenge: row.code_challenge,
      state: row.state,
      expiresAt: row.expires_at,
    };
  }

  async issueAuthorizationCode(record) {
    await this.database
      .prepare(
        `INSERT INTO oauth_authorization_codes (
          code_hash, client_id, redirect_uri, resource, person_id,
          agent_installation_id, scopes_json, code_challenge, issued_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.codeHash,
        record.clientId,
        record.redirectUri,
        record.resource,
        record.personId,
        record.agentInstallationId,
        JSON.stringify(record.scopes),
        record.codeChallenge,
        record.issuedAt,
        record.expiresAt,
      )
      .run();
  }

  async consumeAuthorizationCode(codeHash, now) {
    const row = await this.database
      .prepare(
        `SELECT code_hash, client_id, redirect_uri, resource, person_id,
                agent_installation_id, scopes_json, code_challenge, expires_at
         FROM oauth_authorization_codes
         WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
      )
      .bind(codeHash, now)
      .first();
    if (!row) return null;
    const changed = await this.database
      .prepare(
        "UPDATE oauth_authorization_codes SET consumed_at = ? WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?",
      )
      .bind(now, codeHash, now)
      .run();
    if (changed.meta.changes !== 1) return null;
    const scopes = parseStringArray(row.scopes_json);
    return scopes
      ? {
          clientId: row.client_id,
          redirectUri: row.redirect_uri,
          resource: row.resource,
          personId: row.person_id,
          agentInstallationId: row.agent_installation_id,
          scopes,
          codeChallenge: row.code_challenge,
          expiresAt: row.expires_at,
        }
      : null;
  }

  async issueTokenPair(record) {
    await this.database.batch([
      this.database
        .prepare(
          `INSERT INTO oauth_access_tokens (
            token_hash, client_id, resource, person_id, agent_installation_id,
            scopes_json, issued_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          record.accessTokenHash,
          record.clientId,
          record.resource,
          record.personId,
          record.agentInstallationId,
          JSON.stringify(record.scopes),
          record.issuedAt,
          record.accessExpiresAt,
        ),
      this.database
        .prepare(
          `INSERT INTO oauth_refresh_tokens (
            token_hash, client_id, resource, person_id, agent_installation_id,
            scopes_json, issued_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          record.refreshTokenHash,
          record.clientId,
          record.resource,
          record.personId,
          record.agentInstallationId,
          JSON.stringify(record.scopes),
          record.issuedAt,
          record.refreshExpiresAt,
        ),
    ]);
  }

  async findAccessToken(tokenHash, resource, now) {
    const row = await this.database
      .prepare(
        `SELECT token.client_id, token.resource, token.person_id,
                token.agent_installation_id, token.scopes_json, token.expires_at,
                certificate.scopes_json AS certificate_scopes_json,
                CASE WHEN installation.status = 'active'
                       AND installation.revoked_at IS NULL
                       AND agent.owner_person_id = installation.person_id
                       AND agent.status = 'active'
                       AND agent.revoked_at IS NULL
                       AND certificate.owner_person_id = installation.person_id
                       AND certificate.beneficiary_person_id = installation.person_id
                       AND certificate.agent_id = installation.agent_id
                       AND certificate.valid_from <= ?
                       AND certificate.valid_until > ?
                       AND revocation.id IS NULL
                       AND COALESCE(key_revocation.revoked_at, signer.revoked_at) IS NULL
                     THEN 1 ELSE 0 END AS installation_active
         FROM oauth_access_tokens AS token
         INNER JOIN agent_installations AS installation
           ON installation.id = token.agent_installation_id
         INNER JOIN agents AS agent ON agent.id = installation.agent_id
         INNER JOIN delegation_certificates AS certificate
           ON certificate.id = installation.delegation_certificate_id
         LEFT JOIN delegation_revocations AS revocation
           ON revocation.delegation_certificate_id = certificate.id
         INNER JOIN person_keys AS signer ON signer.id = certificate.person_key_id
         LEFT JOIN person_key_revocations AS key_revocation ON key_revocation.person_key_id = signer.id
         WHERE token.token_hash = ?
           AND token.resource = ?
           AND token.expires_at > ?
           AND token.revoked_at IS NULL`,
      )
      .bind(now, now, tokenHash, resource, now)
      .first();
    const scopes = row && parseStringArray(row.scopes_json);
    const certificateScopes = row && parseStringArray(row.certificate_scopes_json);
    return row && scopes
      ? {
          clientId: row.client_id,
          resource: row.resource,
          personId: row.person_id,
          agentInstallationId: row.agent_installation_id,
          scopes,
          expiresAt: row.expires_at,
          installationActive: row.installation_active === 1 &&
            delegationAllowsOAuthScopes(scopes, certificateScopes ?? []),
        }
      : null;
  }

  async consumeRefreshToken(tokenHash, now) {
    const row = await this.database
      .prepare(
        `SELECT token_hash, client_id, resource, person_id, agent_installation_id,
                scopes_json, expires_at
         FROM oauth_refresh_tokens
         WHERE token_hash = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
      )
      .bind(tokenHash, now)
      .first();
    if (!row) return null;
    const changed = await this.database
      .prepare(
        "UPDATE oauth_refresh_tokens SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?",
      )
      .bind(now, tokenHash, now)
      .run();
    if (changed.meta.changes !== 1) return null;
    const scopes = parseStringArray(row.scopes_json);
    return scopes
      ? {
          clientId: row.client_id,
          resource: row.resource,
          personId: row.person_id,
          agentInstallationId: row.agent_installation_id,
          scopes,
          expiresAt: row.expires_at,
        }
      : null;
  }

  async registerClient(metadata) {
    const clientId = `pw_client:${await clientRegistrationFingerprint(metadata)}`;
    await this.database
      .prepare(
        `INSERT INTO oauth_clients (id, client_name, redirect_uris_json, token_endpoint_auth_method)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(clientId, metadata.clientName, JSON.stringify(metadata.redirectUris), metadata.tokenEndpointAuthMethod)
      .run();
    return {
      client_id: clientId,
      client_name: metadata.clientName,
      redirect_uris: metadata.redirectUris,
      token_endpoint_auth_method: metadata.tokenEndpointAuthMethod,
    };
  }
}

async function clientRegistrationFingerprint(metadata) {
  const payload = JSON.stringify({
    clientName: metadata.clientName,
    redirectUris: [...metadata.redirectUris].sort(),
    tokenEndpointAuthMethod: metadata.tokenEndpointAuthMethod,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseStringArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function delegationMeetsRequirement(scopes, requirement) {
  if (!requirement) return true;
  if (requirement === "review") return scopes.includes("review");
  if (requirement === "work") return scopes.includes("formalize") || scopes.includes("prove");
  return false;
}
