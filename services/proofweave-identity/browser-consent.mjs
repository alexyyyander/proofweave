import { delegationRequirementSummary } from "./delegation-scope-policy.mjs";

const consentLifetimeSeconds = 5 * 60;
const consentCookieName = "pw_oauth_consent";

/**
 * D1-backed, no-JavaScript browser consent. A challenge captures the exact
 * OAuth request before rendering; the POST can therefore be single-use and
 * tied to both the authenticated Person and an HttpOnly CSRF cookie.
 */
export function createD1BrowserConsentResolver({ store, now = () => new Date() }) {
  return {
    async resolve({ authorization, client, personId }) {
      const csrfToken = randomSecret();
      const issuedAt = now();
      const challenge = await store.createConsentChallenge({
        personId,
        clientId: authorization.clientId,
        redirectUri: authorization.redirectUri,
        resource: authorization.resource,
        scopes: authorization.scopes,
        codeChallenge: authorization.codeChallenge,
        state: authorization.state,
        csrfTokenHash: await sha256(csrfToken),
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiry(issuedAt, consentLifetimeSeconds),
      });
      const agents = await store.listEligibleAgents(personId, authorization.scopes);
      return consentPage({
        agents,
        challengeId: challenge.id,
        clientName: client.clientName,
        csrfToken,
        requirements: delegationRequirementSummary(authorization.scopes),
        scopes: authorization.scopes,
      });
    },

    async complete({ request, personId }) {
      let form;
      try {
        form = await request.formData();
      } catch {
        return invalidConsent("The consent form could not be read.");
      }
      const challengeId = formString(form, "challenge_id");
      const csrfToken = formString(form, "csrf_token");
      const decision = formString(form, "decision");
      if (!challengeId || !csrfToken || (decision !== "approve" && decision !== "deny")) {
        return invalidConsent("The consent form is invalid or has expired.");
      }
      const cookieToken = readCookie(request.headers.get("cookie"), consentCookieName);
      if (!cookieToken || !sameValue(cookieToken, csrfToken)) {
        return invalidConsent("The consent form is invalid or has expired.");
      }

      const challenge = await store.consumeConsentChallenge({
        id: challengeId,
        personId,
        csrfTokenHash: await sha256(csrfToken),
        consumedAt: now().toISOString(),
      });
      if (!challenge) return invalidConsent("This authorization request has expired or was already used.");

      const authorization = {
        clientId: challenge.clientId,
        redirectUri: challenge.redirectUri,
        resource: challenge.resource,
        scopes: challenge.scopes,
        codeChallenge: challenge.codeChallenge,
        state: challenge.state,
      };
      if (decision === "deny") {
        return { authorization, decision: { approved: false } };
      }

      const selectedAgent = formString(form, "agent_choice");
      const [agentId, delegationCertificateId, extra] = selectedAgent?.split("::") ?? [];
      if (!agentId || !delegationCertificateId || extra !== undefined) {
        return invalidConsent("Choose an active delegated Agent before approving access.");
      }
      const eligibleAgents = await store.listEligibleAgents(personId, challenge.scopes);
      const eligible = eligibleAgents.some(
        (agent) =>
          agent.agentId === agentId &&
          agent.delegationCertificateId === delegationCertificateId,
      );
      if (!eligible) {
        return invalidConsent("The selected Agent is no longer eligible for these scopes.");
      }
      const installation = await store.ensureAgentInstallation({
        personId,
        clientId: challenge.clientId,
        agentId,
        delegationCertificateId,
      });
      if (!installation) return invalidConsent("The selected Agent installation is unavailable.");
      return {
        authorization,
        decision: {
          approved: true,
          agentInstallationId: installation.id,
          grantedScopes: challenge.scopes,
        },
      };
    },
  };
}

function consentPage({ agents, challengeId, clientName, csrfToken, requirements, scopes }) {
  const hasEligibleAgent = agents.length > 0;
  const requirementsText = requirements.length > 0
    ? `This connection needs an active ${requirements.join(" and ")} delegation.`
    : "This connection only reads public catalog data.";
  const agentOptions = agents.map((agent) => `
    <option value="${escapeHtml(agent.agentId)}::${escapeHtml(agent.delegationCertificateId)}">
      ${escapeHtml(agent.agentLabel)} · ${escapeHtml(agent.delegationScopes.join(", "))} · expires ${escapeHtml(agent.validUntil)}
    </option>`).join("");

  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize Proofweave connection</title>
<style>
  :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #11233f; background: #f7f5ef; }
  * { box-sizing: border-box; } body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 28px 18px; }
  main { width: min(100%, 670px); background: #fffdf8; border: 1px solid #d9d5ca; box-shadow: 0 18px 48px #17284318; padding: clamp(28px, 5vw, 52px); }
  .eyebrow { color: #59708e; font-size: 12px; font-weight: 750; letter-spacing: .1em; margin: 0 0 22px; text-transform: uppercase; }
  h1 { font-family: Georgia, serif; font-size: clamp(36px, 6vw, 54px); font-weight: 400; letter-spacing: -.045em; line-height: .98; margin: 0 0 22px; }
  p { color: #4a5d78; font-size: 16px; line-height: 1.65; } .client { color: #11233f; font-weight: 750; }
  .box { border-top: 1px solid #dfd9cd; border-bottom: 1px solid #dfd9cd; margin: 28px 0; padding: 22px 0; }
  h2 { font-size: 13px; letter-spacing: .08em; margin: 0 0 12px; text-transform: uppercase; } ul { margin: 0; padding-left: 20px; color: #334d71; line-height: 1.7; }
  label { display: block; font-size: 13px; font-weight: 750; margin: 24px 0 8px; } select { width: 100%; border: 1px solid #b8c0cb; border-radius: 2px; background: white; color: #102541; font: inherit; padding: 13px; }
  .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 32px; } button { border: 0; border-radius: 999px; cursor: pointer; font: inherit; font-weight: 750; padding: 13px 20px; }
  button[type="submit"] { background: #3157df; color: white; } button[type="submit"]:disabled { background: #94a0bb; cursor: not-allowed; } .deny { background: transparent; color: #314966; border: 1px solid #9eabbc; }
  .note { font-size: 13px; margin-top: 23px; } code { color: #28466d; font-size: .9em; }
</style></head><body><main>
  <p class="eyebrow">Proofweave · personal Agent authorization</p>
  <h1>Authorize this research connection?</h1>
  <p><span class="client">${escapeHtml(clientName)}</span> is requesting a scoped connection to your Proofweave research profile. Your Agent never receives your browser session or a copied API secret.</p>
  <section class="box"><h2>Requested access</h2><ul>${scopes.map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`).join("")}</ul></section>
  <p>${escapeHtml(requirementsText)}</p>
  <form method="post" action="/authorize">
    <input type="hidden" name="challenge_id" value="${escapeHtml(challengeId)}">
    <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}">
    ${hasEligibleAgent ? `<label for="agent_choice">Authorize as</label><select id="agent_choice" required name="agent_choice">${agentOptions}</select>` : `<p><strong>No active Agent can receive these scopes.</strong> Create or reactivate a matching delegation in the Proofweave workbench, then restart the connection.</p>`}
    <div class="actions"><button type="submit" name="decision" value="approve" ${hasEligibleAgent ? "" : "disabled"}>Authorize selected Agent</button><button class="deny" type="submit" name="decision" value="deny">Cancel</button></div>
  </form>
  ${hasEligibleAgent ? `<p class="note">Approval creates or reuses one revocable installation for this Agent and this MCP client. The connection stops working if the Agent, its signing key, or its delegation is revoked.</p>` : ""}
</main></body></html>`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": `${consentCookieName}=${csrfToken}; Max-Age=${consentLifetimeSeconds}; Path=/authorize; HttpOnly; Secure; SameSite=Lax`,
      "X-Frame-Options": "DENY",
    },
  });
}

function invalidConsent(message) {
  return Response.json(
    { error: "invalid_request", error_description: message },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}

function formString(form, key) {
  const value = form.get(key);
  return typeof value === "string" && value.length > 0 && value.length <= 2_048 ? value : null;
}

function readCookie(header, name) {
  if (!header) return null;
  for (const segment of header.split(";")) {
    const [key, ...values] = segment.trim().split("=");
    if (key === name) return values.join("=") || null;
  }
  return null;
}

function sameValue(left, right) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

function randomSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function expiry(now, seconds) {
  return new Date(now.getTime() + seconds * 1_000).toISOString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
