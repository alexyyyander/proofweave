import "server-only";
import { env } from "cloudflare:workers";

export function googleAuthConfig(origin?: string) {
  const values = env as unknown as Record<string, string | undefined>;
  const clientId = values.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";
  const clientSecret = values.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "";
  const stateSecret = values.GOOGLE_OAUTH_STATE_SECRET ?? "";
  const configuredRedirect = values.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  const redirectUri = configuredRedirect || (origin ? `${origin}/auth/google/callback` : "");
  return {
    clientId,
    clientSecret,
    stateSecret,
    redirectUri,
    configured: Boolean(clientId && clientSecret && stateSecret.length >= 32),
  };
}
