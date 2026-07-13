/** Cloudflare Worker entry point for the Proofweave web application. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  createD1SitesIdentityRuntime,
  SitesIdentityRuntimeConfigurationError,
} from "../services/proofweave-identity/sites-runtime.mjs";

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetFetcher;
  DB?: unknown;
  MCP_RESOURCE_URL?: string;
  OAUTH_ISSUER_URL?: string;
  OAUTH_CLIENT_REGISTRATION_ALLOWLIST_JSON?: string;
  IMAGES: {
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

    if (isOAuthPath(url.pathname)) {
      return fetchOAuthIdentity(request, env, url);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
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
  if (env.OAUTH_ISSUER_URL && env.OAUTH_ISSUER_URL !== url.origin) {
    return unavailableIdentity();
  }
  try {
    const identity = createD1SitesIdentityRuntime({
      database: env.DB,
      resource: env.MCP_RESOURCE_URL,
      issuer: url.origin,
      clientRegistrationAllowlistJson: env.OAUTH_CLIENT_REGISTRATION_ALLOWLIST_JSON,
    });
    return identity.fetch(request);
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
