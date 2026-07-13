import { Container } from "@cloudflare/containers";
import { cloudflareLeanContainerPolicy } from "./cloudflare-container-policy.mjs";

/**
 * Deployment-side private Container declaration. The Worker obtains a unique
 * Durable Object instance per Run and is the only caller of fetch(). The
 * image starts the Node ingress server; this class locks it to the one Run
 * named by the first private request so it cannot become a shared executor.
 */
export class LeanRunnerContainer extends Container {
  enableInternet = cloudflareLeanContainerPolicy.enableInternet;
  sleepAfter = cloudflareLeanContainerPolicy.sleepAfter;
  defaultPort = cloudflareLeanContainerPolicy.port;
  requiredPorts = [cloudflareLeanContainerPolicy.port];
  pingEndpoint = cloudflareLeanContainerPolicy.pingEndpoint;
  entrypoint = cloudflareLeanContainerPolicy.entrypoint;
  envVars = { PROOFWEAVE_NETWORK_ISOLATED: "true" };
  activeRunId = null;

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/ready") return this.containerFetch(request);
    const runId = runIdFromPrivatePath(path);
    if (!runId) return new Response("Not found", { status: 404 });
    if (this.activeRunId && this.activeRunId !== runId) {
      return new Response("Container already bound to another Run", { status: 409 });
    }
    this.activeRunId = runId;
    return this.containerFetch(request);
  }
}

function runIdFromPrivatePath(path) {
  const match = /^\/v1\/runs\/([^/]+)\/workspace(?:\/artifacts\/(?:source-archive|source-patch|lake-manifest)|\/(?:finalize|execute|cancel|complete)|\/result\/(?:stdout|stderr))?$/.exec(path);
  if (!match) return null;
  try {
    const runId = decodeURIComponent(match[1]);
    return runId && !runId.includes("/") ? runId : null;
  } catch {
    return null;
  }
}
