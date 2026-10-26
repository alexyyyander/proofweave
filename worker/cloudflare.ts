import application from "./index";
import { handleSitesBridge } from "../services/auth/sites-login-bridge.mjs";
import { getAccountAuthRepository } from "../db/repositories/account-auth";
export { SitesBridgeTransaction } from "../services/auth/sites-login-bridge.mjs";
import {
  cloudflareValidationResponse,
  directCloudflareRequest,
} from "../services/hosting/cloudflare-boundary.mjs";

type ApplicationEnv = Parameters<typeof application.fetch>[1];
type Context = Parameters<typeof application.fetch>[2];
type DirectEnv = ApplicationEnv & {
  PROOFWEAVE_DEPLOYMENT_STAGE?: string;
  PROOFWEAVE_HOSTING_PLATFORM?: string;
};

const worker = {
  async fetch(request: Request, env: DirectEnv, ctx: Context): Promise<Response> {
    // Direct deployments never trust identity headers supplied by clients.
    const sanitized = directCloudflareRequest(request);
    const bridge = await handleSitesBridge(sanitized, env, { sessions: {
      async create(identity: { siteId: string; userId: string; email: string; displayName: string }) {
        const repository = getAccountAuthRepository();
        return repository.createSession(await repository.resolveSitesBridgeIdentity(identity));
      },
    } });
    if (bridge) return bridge;
    const validationResponse = cloudflareValidationResponse(sanitized, env);
    if (validationResponse) return validationResponse;
    const path = new URL(sanitized.url).pathname;
    if (path === "/signin-with-chatgpt" || path === "/signout-with-chatgpt") {
      return new Response(null, { status: 302, headers: {
        Location: "/sign-in", "Cache-Control": "no-store",
      } });
    }
    return application.fetch(sanitized, env, ctx);
  },
};

export default worker;
