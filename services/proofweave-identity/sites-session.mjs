const emailHeader = "oai-authenticated-user-email";

/**
 * Closed-alpha bridge for the existing Sites identity boundary. The caller
 * must run behind Sites; this module intentionally does not treat arbitrary
 * client-supplied headers as a public identity protocol.
 */
export function createSitesChatGPTSessionResolver({ store }) {
  return {
    async currentSession(request) {
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
      return Response.redirect(`${url.origin}/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`, 302);
    },
  };
}
