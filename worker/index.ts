/** Cloudflare Worker entry point for the Proofweave web application. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { handleSitesBridge } from "../services/auth/sites-login-bridge.mjs";
import {
  getOAuthD1,
  getOAuthRefreshRotationCapability,
  getOAuthOperationState,
} from "../db";
import {
  createD1SitesIdentityRuntime,
  SitesIdentityRuntimeConfigurationError,
} from "../services/proofweave-identity/sites-runtime.mjs";
import { canonicalPublicRedirect, resolveSitesOAuthAuthority } from "../services/proofweave-identity/sites-authority.mjs";

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetFetcher;
  MCP_RESOURCE_URL?: string;
  OAUTH_ISSUER_URL?: string;
  OAUTH_LEGACY_ISSUER_URL?: string;
  OAUTH_CLIENT_REGISTRATION_ALLOWLIST_JSON?: string;
  IMAGES?: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Preserve the original Sites identity boundary and same-origin native sign-in.
    if (url.pathname === "/login-bridge") {
      return (await handleSitesBridge(request, env))!;
    }

    if (isOAuthPath(url.pathname)) {
      return fetchOAuthIdentity(request, env, url);
    }

    const canonicalUrl = canonicalPublicRedirect(request, env);
    if (canonicalUrl) return Response.redirect(canonicalUrl, 308);

    const images = env.IMAGES;
    if (url.pathname === "/_vinext/image" && images) {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await images.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;

function isOAuthPath(pathname: string): boolean {
  return pathname === "/.well-known/oauth-authorization-server" ||
    pathname === "/authorize" ||
    pathname === "/token" ||
    pathname === "/register";
}

function fetchOAuthIdentity(request: Request, env: Env, url: URL): Promise<Response> | Response {
  const authority = resolveSitesOAuthAuthority(url, env);
  if (!authority) return unavailableIdentity();
  return fetchOAuthIdentityResponse(request, env, authority);
}

async function fetchOAuthIdentityResponse(
  request: Request,
  env: Env,
  authority: { resource: string; issuer: string },
): Promise<Response> {
  try {
    const operationState = getOAuthOperationState();
    const identity = createD1SitesIdentityRuntime({
      database: getOAuthD1(),
      operationMode: operationState.mode,
      refreshTokenRotator:
        operationState.mode === "read_only"
          ? getOAuthRefreshRotationCapability()
          : null,
      resource: authority.resource,
      issuer: authority.issuer,
      clientRegistrationAllowlistJson: env.OAUTH_CLIENT_REGISTRATION_ALLOWLIST_JSON,
    });
    return await identity.fetch(request);
  } catch (error) {
    if (error instanceof SitesIdentityRuntimeConfigurationError) return unavailableIdentity();
    return unavailableIdentity();
  }
}

function unavailableIdentity(): Response {
  return Response.json(
    {
      error: "temporarily_unavailable",
      error_description: "Proofweave browser authorization is not configured for this deployment.",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
