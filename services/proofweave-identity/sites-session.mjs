const emailHeader = "oai-authenticated-user-email";
const appSessionCookie = "__Host-pw_session";

/**
 * Closed-alpha bridge for the existing Sites identity boundary. The caller
 * must run behind Sites; this module intentionally does not treat arbitrary
 * client-supplied headers as a public identity protocol.
 */
export function createSitesChatGPTSessionResolver({ store }) {
  return {
    async currentSession(request) {
      const token = readCookie(request.headers.get("cookie"), appSessionCookie);
      if (token) {
        const person = await store.findAppSessionPerson(await sha256(token));
        if (person) return { personId: person.id, displayName: person.displayName };
      }
      const email = request.headers.get(emailHeader)?.trim().toLowerCase();
      if (!email) return null;
      const person = await store.findChatGPTPerson(email);
      return person ? { personId: person.id, displayName: person.displayName } : null;
    },

    authorizationRequired(request) {
      const email = request.headers.get(emailHeader)?.trim();
      if (email) {
        return new Response(
          "Open the Proofweave workbench once to create your personal profile and delegation, then restart this connection.",
          { status: 403, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } },
        );
      }
      const url = new URL(request.url);
      const returnTo = `${url.pathname}${url.search}`;
      return Response.redirect(`${url.origin}/sign-in?return_to=${encodeURIComponent(returnTo)}`, 302);
    },
  };
}

function readCookie(header, name) {
  if (!header) return null;
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0 || pair.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
