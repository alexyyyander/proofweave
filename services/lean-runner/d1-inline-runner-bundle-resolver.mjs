import { D1InlineArtifactBucket } from "../artifacts/d1-inline-artifact-store.mjs";
import { D1R2RunnerBundleResolver } from "./d1-r2-runner-bundle-resolver.mjs";

/** Resolve bounded, content-addressed alpha evidence from D1 without R2. */
export class D1InlineRunnerBundleResolver extends D1R2RunnerBundleResolver {
  constructor({ database } = {}) {
    super({ database, bucket: new D1InlineArtifactBucket(database) });
  }
}
