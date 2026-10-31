import "server-only";
import { env } from "cloudflare:workers";
import { sitesLoginEnabled } from "../services/hosting/cloudflare-boundary.mjs";
import { receiverConfigured } from "../services/auth/sites-login-bridge.mjs";

export function hostingConfig() {
  return { sitesLoginEnabled: sitesLoginEnabled(env), sitesBridgeEnabled: receiverConfigured(env) };
}
