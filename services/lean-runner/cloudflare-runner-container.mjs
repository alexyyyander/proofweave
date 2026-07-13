import { Container } from "@cloudflare/containers";
import { cloudflareLeanContainerPolicy } from "./cloudflare-container-policy.mjs";

/**
 * Deployment-side Container declaration. This class intentionally provides no
 * HTTP endpoint and receives no credentials. A future execution method may be
 * added only with a pinned image and a verified, streaming bundle-transfer
 * protocol from the trusted Runner Worker.
 */
export class LeanRunnerContainer extends Container {
  enableInternet = cloudflareLeanContainerPolicy.enableInternet;
  sleepAfter = cloudflareLeanContainerPolicy.sleepAfter;
}
